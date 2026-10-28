/**
 * @spec reviewer 별도 점검 세션 띄우기
 * @why 개발한 담당이 스스로 만든 것을 스스로 확인하면 보이고 싶은 것만 보게 된다. 테스트를 올리면 담당이 아닌 새 세션이 코드 리뷰·시험·화면 단계를 대신 확인하고, 사용자에게는 사람이 직접 봐야만 판단되는 것만 가게 한다.
 * @contract 점검 세션을 띄우는 곳은 이 파일의 reviewerUp 하나이고, claude를 실행하는 줄은 outbox.ts의 launchReviewer에만 있다(서버가 claude를 실행하는 곳을 한 파일에 모으는 규칙). 요청마다 잠금(review-<번호>) 아래에서 이미 점검 세션이 돌고 있으면 띄우지 않는다. 설정 review와 wake가 둘 다 켜져 있을 때만 띄운다(테스트용 서버·시험에서는 띄우지 않는다). 점검 세션은 소스를 고치지 못하고(session.ts의 허용·금지 도구), 결과는 `request review-report`로 보고한다. 점검 세션이 안 뜨거나 오래 소식이 없는 것은 request.ts의 markStalledReviews가 점검 안 됨으로 바꾼다.
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { readConfig } from './config.js';
import { agentsList, launchReviewer } from './outbox.js';
import { loadRequests } from './request.js';
import { logFile, reviewerMessage, reviewerName, SPEC_MJS } from './session.js';
import { newHolder, tryLock, unlock } from './lock.js';
import { projectRoot } from './project.js';
import { worktreeRefOf } from './worktree.js';

/** 점검 세션을 띄운 결과: 이미 돌고 있음, 띄움, 다른 프로세스가 띄우는 중, 지금은 안 띄움(점검 꺼짐 등), 실패 */
export type ReviewerUp = 'running' | 'launched' | 'busy' | 'skipped' | 'failed';

/** 이 요청의 점검 세션을 띄운다(점검 중 단계일 때만). 한 요청에 한 점검 세션만 돈다 */
export function reviewerUp(scanRoot: string, id: number): ReviewerUp {
  const root = projectRoot(scanRoot);
  const cfg = readConfig(root);
  if (!cfg.review || !cfg.wake || process.env.SPEC_TEST_DIR) return 'skipped';
  const req = loadRequests(scanRoot).find((r) => r.id === id);
  if (!req || req.stage !== 'test' || req.step !== 'review') return 'skipped';
  const holder = newHolder();
  if (!tryLock(scanRoot, `review-${id}`, 120_000, holder)) return 'busy';
  try {
    const name = reviewerName(root, id);
    const list = agentsList();
    if (!list) return 'skipped';
    if (list.some((a) => a.name === name && a.status !== 'stopped')) return 'running';
    // 점검은 담당이 고친 코드가 있는 곳(요청 작업 폴더)에서 한다. 워크트리를 안 쓰는 요청이면 main 작업 폴더다
    const cwd = worktreeRefOf(root, id)?.path ?? root;
    const status = launchReviewer(cwd, name, reviewerMessage(scanRoot, root, id));
    fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} 점검 세션 ${name} claude --bg 종료코드=${status}\n`);
    if (status !== 0) return 'failed';
    return 'launched';
  } catch (e) {
    try { fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} 점검 세션 띄우기 오류: ${(e as Error).message}\n`); } catch { /* 기록 실패는 무시 */ }
    return 'failed';
  } finally { unlock(scanRoot, `review-${id}`, holder); }
}

/** 점검을 시작해야 할 때(테스트를 올린 직후·다시 점검) 서버나 명령이 부른다: 따로 도는 프로세스로 점검 세션을 띄워 요청 처리를 막지 않는다. 꺼져 있거나 시험용이면 하지 않는다 */
export function kickReviewer(scanRoot: string, id: number): void {
  try {
    const cfg = readConfig(projectRoot(scanRoot));
    if (process.env.SPEC_TEST_DIR || process.env.SPEC_NO_KICK || !cfg.review || !cfg.wake) return;
    spawn(process.execPath, [SPEC_MJS, 'request', 'review-up', '--id', String(id), '--src', scanRoot], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 못 해도 1분 점검이 점검 안 됨으로 알린다 */ }
}
