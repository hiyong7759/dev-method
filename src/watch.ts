/**
 * @spec watch 바뀜 지켜보기(트리거)
 * @why 화면 데이터·터미널 정리·알림·메신저 점검을 2.5초·3초·5초·60초마다 돌리면 아무것도 안 바뀐 동안에도 계산이 계속 돈다(요청 #107). 일은 상태가 바뀌는 순간에만 하려고, 바뀌는 곳(폴더)을 파일 시스템 알림으로 지켜보고 바뀌었다고 알려 준다.
 * @contract 종류: requests(.spec/requests), outbox(.spec/outbox*), spec(.spec의 나머지 기록), src(소스 폴더), tool(도구 소스), git(HEAD·브랜치 기록), sessions(~/.claude/sessions). 같은 종류의 연속된 바뀜은 짧게 모아 한 번만 알린다(타이머는 바뀜이 있을 때 한 번만 건다). 알림이 빠질 수 있으니 부르는 쪽은 시작할 때 한 번 직접 일을 해 둔다. 서버가 쓰는 로그·잠금·읽은 자리 파일은 알리지 않는다(자기가 쓴 것으로 다시 돌지 않게).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectRoot, specDir } from './project.js';
import { SRC_DIR } from './paths.js';

/** 무엇이 바뀌었는지의 종류(요청 기록·보낼 글 상자·그 밖의 .spec·소스·도구 소스·git·세션) */
export type TriggerKind = 'requests' | 'outbox' | 'spec' | 'src' | 'tool' | 'git' | 'sessions';

/** 알리지 않는 .spec 아래 파일: 서버·명령이 일하며 쓰는 로그·잠금·읽은 자리·터미널 기록 */
const QUIET = /(^|\/)(locks|outbox-text|comment-shots)(\/|$)|\.log$|(^|\/)notify-|ttyd-pids|\.tmp$/;
/** 소스 폴더에서 알리지 않는 곳 */
const SRC_SKIP = /(^|\/)(node_modules|dist|build|\.[^/]+)(\/|$)/;

const GAP_MS = 150;

/** 알림이 올 때 호출될 함수를 걸고, 지켜보기를 멈추는 함수를 돌려준다 */
export function watchTriggers(scanRoot: string, fn: (kind: TriggerKind) => void, opts: { kinds?: TriggerKind[] } = {}): () => void {
  const root = projectRoot(scanRoot);
  const want = (k: TriggerKind): boolean => !opts.kinds || opts.kinds.includes(k);
  const closers: (() => void)[] = [];
  const timers = new Map<TriggerKind, NodeJS.Timeout>();
  const fire = (k: TriggerKind): void => {
    if (!want(k) || timers.has(k)) return;
    timers.set(k, setTimeout(() => { timers.delete(k); try { fn(k); } catch { /* 한 곳의 실패가 지켜보기를 멈추지 않게 */ } }, GAP_MS));
  };
  const on = (dir: string, recursive: boolean, kindsOf: (rel: string) => TriggerKind[]): void => {
    try {
      const w = fs.watch(dir, { recursive, persistent: false }, (_ev, name) => { for (const k of kindsOf(String(name ?? '').split(path.sep).join('/'))) fire(k); });
      w.on('error', () => { /* 폴더가 사라지는 등은 시작·재연결 때의 새 계산이 메운다 */ });
      closers.push(() => w.close());
    } catch { /* 지켜볼 수 없는 폴더(없음)는 건너뛴다 */ }
  };
  on(specDir(scanRoot), true, (rel) => {
    if (QUIET.test(rel)) return [];
    if (rel.startsWith('requests')) return ['requests'];
    if (rel.startsWith('outbox')) return ['outbox'];
    return ['spec'];
  });
  // 소스 폴더가 곧 도구 소스인 경우(이 저장소 자신)는 한 번만 지켜보고 두 종류로 알린다
  const same = path.resolve(SRC_DIR) === path.resolve(scanRoot);
  on(scanRoot, true, (rel) => (SRC_SKIP.test(rel) ? [] : same ? ['src', 'tool'] : ['src']));
  if (!same) on(SRC_DIR, true, (rel) => (SRC_SKIP.test(rel) ? [] : ['tool']));
  const git = path.join(root, '.git');
  on(git, false, (rel) => (rel === 'HEAD' || rel === 'packed-refs' ? ['git'] : []));
  on(path.join(git, 'refs'), true, () => ['git']);
  on(path.join(os.homedir(), '.claude', 'sessions'), false, () => ['sessions']);
  return () => { for (const c of closers) c(); for (const t of timers.values()) clearTimeout(t); timers.clear(); };
}

/** 주어진 종류의 다음 바뀜까지 기다린다. 지켜보기를 먼저 걸고 나서 지금 상태를 확인하면 그 사이의 바뀜을 놓치지 않는다. 마감 타이머는 한 번만 건다(반복이 아니다). 안 기다리게 되면 cancel로 거둔다 */
export function nextChange(scanRoot: string, kinds: TriggerKind[], timeoutMs: number): { done: Promise<TriggerKind | 'timeout'>; cancel: () => void } {
  let cancel = (): void => undefined;
  const done = new Promise<TriggerKind | 'timeout'>((ok) => {
    let stop = (): void => undefined;
    const end = setTimeout(() => { stop(); ok('timeout'); }, Math.max(0, timeoutMs));
    stop = watchTriggers(scanRoot, (k) => { clearTimeout(end); stop(); ok(k); }, { kinds });
    cancel = () => { clearTimeout(end); stop(); ok('timeout'); };
  });
  return { done, cancel };
}
