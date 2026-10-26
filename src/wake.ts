/**
 * @spec wake-session 쉬는 담당 세션 깨우기
 * @why 사용자가 설계서 보기에서 승인·반려하면 그 요청을 맡은 에이전트 세션이 알아야 일이 이어진다. 열려 있는 세션은 inbox 훅이 다음에 움직일 때 알려 주지만, 닫혀 있는 세션은 아무도 안 깨우면 영영 멈춘다. 그래서 서버가 결정 순간에 닫힌 세션만 깨운다.
 * @contract 프로젝트 설정 `wake: true`일 때만 동작한다(호출마다 비용이 들기 때문에 기본은 꺼짐). 담당 세션은 .spec/sessions.json에서 찾고, `claude agents --json`으로 보아 지금 일하는 중(busy)인 세션이면 건드리지 않고 훅에 맡긴다. 기다리는 중이거나 살아 있지 않은 세션(열어 둔 세션, 일을 마치고 쉬는 세션 포함)에는 session.ts가 (1시간 넘게 쉬어 캐시가 식었거나 대화 기록이 클 때만 먼저 압축하고) 이어서 "사용자가 결정한 그 일만 하고 끝나면 멈추라"는 글을 같은 세션에 보낸다(압축이 실패해도 글은 보낸다). 담당 세션이 한 번도 없었으면 새로 만들어 그 일을 맡긴다(시작 때 만든 것과 같은 길). 결과는 .spec/wake.log에 남기고, 서버는 기다리지 않는다. 어떤 경우에도 사용자 결정 자체를 실패시키지 않는다. 결정을 반영하고도 테스트 요청 없이 멈춘 세션은 nudgeStalled가 쉬고 있을 때 결정마다 한 번만 다시 깨운다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from './config.js';
import { loadRequests } from './request.js';
import { projectRoot } from './project.js';
import { aliveStatus, ownersOf, resumeOwner, startOwner, transcriptOf } from './session.js';
import { dueForResend, dueForStall, lastDecision, markSent, markStallSent, openDelivery } from './delivery.js';

/** 사용자 결정 직후 부른다. 깨우거나 새로 만든 세션 번호들을 돌려준다(없으면 빈 목록). force면 일하는 중인 세션에도 글을 보낸다(결정이 전달되지 않았을 때 다시 보내는 용도) */
export function wakeOwner(scanRoot: string, id: number, force = false): string[] {
  const woken: string[] = [];
  try {
    const root = projectRoot(scanRoot);
    const req = loadRequests(scanRoot).find((r) => r.id === id);
    // 전달 기록은 보내는 장치(wake)가 꺼져 있어도 만든다: 그때는 훅이 읽을 때까지 '훅 대기'로 보인다
    openDelivery(scanRoot, req);
    if (!readConfig(root).wake) return woken;
    // 완료·취소된 요청은 더 할 일이 없으니 깨우지 않는다(깨우면 일 없이 비용만 든다). 완료로 닫는 승인은 애초에 전달 기록도 만들지 않는다(delivery.ts)
    if (req && (req.stage === 'done' || req.stage === 'cancelled')) return woken;
    const last = req?.events[req.events.length - 1];
    const decided = last?.note ?? '';
    const log = path.join(root, '.spec', 'wake.log');
    const owners = ownersOf(root, id);
    if (!owners.length) {
      const sid = startOwner(scanRoot, id, 'decision', decided);
      if (sid) { woken.push(sid); markSent(scanRoot, id, 'wake', force); }
      return woken;
    }
    for (const sid of owners) {
      // 세션이 지금 일하는 중(busy)이면 같은 대화에 서버가 끼어들지 않는다. 곧 도구를 쓰므로 훅이 그때 전달한다. 기다리는 중(idle)이거나 살아 있지 않으면(열어 둔 세션, 일을 마치고 쉬는 세션, 오래된 세션) 똑같이 글을 보내 이어서 하게 한다. 기다리는 세션은 말을 걸거나 도구를 쓰는 일이 없어 훅이 움직일 수 없기 때문이다
      if (!force && aliveStatus(sid) === 'busy') { fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 일하는 중이라 훅에 맡김\n`); markSent(scanRoot, id, 'hook'); continue; }
      let idleMs = Infinity, bytes = 0;
      try { const st = fs.statSync(transcriptOf(root, sid)); idleMs = Date.now() - st.mtimeMs; bytes = st.size; } catch { /* 기록이 없으면 처음부터 읽는 것 */ }
      resumeOwner(scanRoot, id, sid, decided, { idleMs, bytes });
      fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 깨움\n`);
      woken.push(sid);
      markSent(scanRoot, id, 'wake', force);
    }
  } catch { /* 사용자 결정은 깨우기 실패와 상관없이 성공해야 한다 */ }
  return woken;
}

/** 서버가 1분마다 부른다: 보낸 지 5분이 지나도 읽히지 않은 결정을 다시 보낸다(최대 2번, 일하는 중인 세션에도). 실패해도 서버는 계속 돈다 */
export function resendUnread(scanRoot: string): number[] {
  try {
    const ids = dueForResend(scanRoot, loadRequests(scanRoot));
    for (const id of ids) wakeOwner(scanRoot, id, true);
    return ids;
  } catch { return []; }
}

/** 서버가 1분마다 부른다: 결정을 반영(기록)한 담당 세션이 다음 단계(테스트 요청 등) 없이 멈췄으면 쉬고 있을 때 한 번만 다시 깨운다(결정마다 최대 1번). 일하는 중인 세션은 건드리지 않고 다음 점검에서 다시 본다. 그래도 그대로면 화면이 '멈춘 듯함'을 보인다(delivery.ts) */
export function nudgeStalled(scanRoot: string): number[] {
  const done: number[] = [];
  try {
    const root = projectRoot(scanRoot);
    if (!readConfig(root).wake) return done;
    const reqs = loadRequests(scanRoot);
    for (const id of dueForStall(scanRoot, reqs)) {
      const owners = ownersOf(root, id);
      if (!owners.length) continue;
      const decided = lastDecision(reqs.find((r) => r.id === id)!)?.note ?? '결정';
      const log = path.join(root, '.spec', 'wake.log');
      for (const sid of owners) {
        if (aliveStatus(sid) === 'busy') { fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 멈춘 듯하지만 일하는 중이라 다음 점검에서 다시 봄\n`); continue; }
        let idleMs = Infinity, bytes = 0;
        try { const st = fs.statSync(transcriptOf(root, sid)); idleMs = Date.now() - st.mtimeMs; bytes = st.size; } catch { /* 기록이 없으면 처음부터 읽는 것 */ }
        resumeOwner(scanRoot, id, sid, decided, { idleMs, bytes }, true);
        fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 결정 반영 뒤 멈춘 듯해 한 번 더 깨움\n`);
        markStallSent(scanRoot, id);
        done.push(id);
      }
    }
  } catch { /* 점검이 실패해도 서버는 계속 돈다 */ }
  return done;
}
