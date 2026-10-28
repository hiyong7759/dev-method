/**
 * @spec file-lock 파일 잠금과 살아 있다는 표시
 * @why 메신저·서버·담당 확인이 동시에 같은 일(줄 가져가기, 담당 띄우기, 메신저 띄우기)을 하면 둘 다 성공해 담당이 복사된다. 만든 쪽만 성공하는 잠금 파일 하나로 "한 번에 하나만"을 기계가 보장한다.
 * @contract 잠금은 .spec/locks/<이름> 파일을 "이미 있으면 실패"로 만드는 것이다(만든 한 쪽만 성공). 잠금 파일의 수정 시각이 곧 "살아 있다" 표시이고, 잡은 쪽이 beat로 갱신한다. 마지막 갱신이 staleMs보다 오래되면 잡은 쪽이 죽은 것으로 보고 다음 시도가 풀어 가져간다. 던지지 않는다(못 잡으면 false).
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './project.js';

const lockFile = (scanRoot: string, name: string): string => path.join(specDir(scanRoot), 'locks', name);

/** 잠금을 잡는다. 잡으면 true, 이미 살아 있는 다른 쪽이 잡고 있으면 false. 오래 갱신이 없던 잠금은 풀고 다시 시도한다 */
export function tryLock(scanRoot: string, name: string, staleMs: number, holder = String(process.pid)): boolean {
  const f = lockFile(scanRoot, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(f, holder, { flag: 'wx' }); return true; } catch { /* 이미 있다 */ }
    try {
      if (Date.now() - fs.statSync(f).mtimeMs <= staleMs) return false;
      fs.rmSync(f, { force: true });
    } catch { /* 그 사이 풀렸다. 다시 시도 */ }
  }
  return false;
}

/** 잠금을 푼다 */
export function unlock(scanRoot: string, name: string): void { try { fs.rmSync(lockFile(scanRoot, name), { force: true }); } catch { /* 이미 없다 */ } }

/** 살아 있다는 표시를 갱신한다(잠금을 잡은 쪽이 부른다) */
export function beat(scanRoot: string, name: string): boolean {
  try { const now = new Date(); fs.utimesSync(lockFile(scanRoot, name), now, now); return true; } catch { return false; }
}

/** 잡은 쪽 이름(없으면 null) */
export function holderOf(scanRoot: string, name: string): string | null {
  try { return fs.readFileSync(lockFile(scanRoot, name), 'utf8'); } catch { return null; }
}

/** 잠금을 잡고 일을 한 뒤 푼다. 짧은 읽고-쓰기 구간용이라 최대 waitMs 동안 다시 시도하고, 그래도 못 잡으면 null */
export function withLock<T>(scanRoot: string, name: string, fn: () => T, opts: { staleMs?: number; waitMs?: number } = {}): T | null {
  const end = Date.now() + (opts.waitMs ?? 3000);
  for (;;) {
    if (tryLock(scanRoot, name, opts.staleMs ?? 10_000)) {
      try { return fn(); } finally { unlock(scanRoot, name); }
    }
    if (Date.now() >= end) return null;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
