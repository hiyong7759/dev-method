/**
 * @spec precommit 커밋 때 경고 0 확인
 * @why 필수 메타정보가 비었거나 끊긴 참조가 있는 채로 커밋되지 않게, 경고 0을 말이 아니라 커밋 때 기계가 확인한다.
 * @basis 프로젝트의 .spec/config.json의 src를 읽는다. 설정이 없으면 이 프로젝트는 대상이 아니라 통과한다. 우회가 필요하면 git commit --no-verify를 쓰고, 쓰면 이유를 커밋 메시지에 남긴다.
 * @contract 메타정보(extract), 정보 존재 이유(analyze-ts), 이동 선언(nav)을 차례로 검사한다. 하나라도 경고가 있으면 커밋을 막는다(종료 코드 1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LAUNCHER } from './paths.js';
import { configFile, readConfig } from './config.js';
import { parseArgs } from './cli.js';

/** 명령: precommit [프로젝트 루트] */
export async function main(argv: string[]): Promise<number | undefined> {
  const root = path.resolve(parseArgs(argv).pos[0] || '.');
  if (!fs.existsSync(configFile(root))) return 0;
  const src = path.resolve(root, readConfig(root).src || 'src');
  let bad = false;
  for (const script of ['extract', 'analyze-ts', 'nav']) {
    const r = spawnSync(process.execPath, [LAUNCHER, script, script === 'extract' ? src : root, ...(script === 'nav' ? ['--src', src] : []), '--check'], { encoding: 'utf8' });
    if (r.status !== 0) {
      bad = true;
      console.error(`[spec-view] ${script} 경고:`);
      const lines = r.stdout.split('\n').filter((l) => l.startsWith('경고')).slice(0, 10);
      // 경고 줄이 없는데 실패했다면 도구 자체 오류다 (tsconfig 없음 등) — 내용을 그대로 보인다
      console.error(lines.length ? lines.join('\n') : (r.stderr || r.stdout).trim().split('\n').slice(0, 8).join('\n'));
    }
  }
  if (bad) { console.error('[spec-view] 경고를 0으로 만든 뒤 커밋한다 (메타정보 채우기: spec-view 스킬 rules/meta.md)'); return 1; }
  return 0;
}
