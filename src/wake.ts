/**
 * @spec wake-session 쉬는 담당 세션 깨우기
 * @why 사용자가 설계서 보기에서 승인·반려하면 그 요청을 맡은 에이전트 세션이 알아야 일이 이어진다. 열려 있는 세션은 inbox 훅이 다음에 움직일 때 알려 주지만, 닫혀 있는 세션은 아무도 안 깨우면 영영 멈춘다. 그래서 서버가 결정 순간에 닫힌 세션만 깨운다.
 * @contract 프로젝트 설정 `wake: true`일 때만 동작한다(호출마다 비용이 들기 때문에 기본은 꺼짐). 담당 세션은 .spec/sessions.json에서 찾고, 세션 기록 파일이 최근 10분 안에 바뀌었으면 열려 있는 것으로 보고 건드리지 않는다. 닫혀 있으면 session.ts가 (1시간 넘게 쉬어 캐시가 식었거나 대화 기록이 클 때만 먼저 압축하고) 이어서 "사용자가 결정한 그 일만 하고 끝나면 멈추라"는 글을 같은 세션에 보낸다(압축이 실패해도 글은 보낸다). 담당 세션이 한 번도 없었으면 새로 만들어 그 일을 맡긴다(시작 때 만든 것과 같은 길). 결과는 .spec/wake.log에 남기고, 서버는 기다리지 않는다. 어떤 경우에도 사용자 결정 자체를 실패시키지 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig } from './config.js';
import { loadRequests } from './request.js';
import { projectRoot } from './project.js';
import { ownersOf, resumeOwner, startOwner } from './session.js';

/** 이 시간 안에 세션 기록이 바뀌었으면 열려 있는 세션으로 본다 */
const OPEN_MS = 10 * 60 * 1000;

/** 세션 기록 파일 위치: ~/.claude/projects/<실제 프로젝트 경로에서 글자·숫자 아닌 것을 -로 바꾼 이름>/<세션>.jsonl */
function transcriptOf(root: string, sid: string): string {
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* 없으면 그대로 */ }
  return path.join(os.homedir(), '.claude', 'projects', real.replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`);
}

/** 사용자 결정 직후 부른다. 깨우거나 새로 만든 세션 번호들을 돌려준다(없으면 빈 목록) */
export function wakeOwner(scanRoot: string, id: number): string[] {
  const woken: string[] = [];
  try {
    const root = projectRoot(scanRoot);
    if (!readConfig(root).wake) return woken;
    const req = loadRequests(scanRoot).find((r) => r.id === id);
    const last = req?.events[req.events.length - 1];
    const decided = last?.note ?? '';
    const log = path.join(root, '.spec', 'wake.log');
    const owners = ownersOf(root, id);
    if (!owners.length) {
      const sid = startOwner(scanRoot, id, 'decision', decided);
      if (sid) woken.push(sid);
      return woken;
    }
    for (const sid of owners) {
      let idleMs = Infinity, bytes = 0;
      try { const st = fs.statSync(transcriptOf(root, sid)); idleMs = Date.now() - st.mtimeMs; bytes = st.size; } catch { /* 기록이 없으면 닫힌 것 */ }
      if (idleMs < OPEN_MS) { fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 열려 있어 훅에 맡김\n`); continue; }
      resumeOwner(scanRoot, id, sid, decided, { idleMs, bytes });
      fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 깨움\n`);
      woken.push(sid);
    }
  } catch { /* 사용자 결정은 깨우기 실패와 상관없이 성공해야 한다 */ }
  return woken;
}
