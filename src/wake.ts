/**
 * @spec wake-session 쉬는 담당 세션 깨우기
 * @why 사용자가 설계서 보기에서 승인·반려하면 그 요청을 맡은 에이전트 세션이 알아야 일이 이어진다. 열려 있는 세션은 inbox 훅이 다음에 움직일 때 알려 주지만, 닫혀 있는 세션은 아무도 안 깨우면 영영 멈춘다. 그래서 서버가 결정 순간에 닫힌 세션만 깨운다.
 * @contract 프로젝트 설정 `wake: true`일 때만 동작한다(호출마다 비용이 들기 때문에 기본은 꺼짐). 담당 세션은 .spec/sessions.json에서 찾고, 세션 기록 파일이 최근 10분 안에 바뀌었으면 열려 있는 것으로 보고 건드리지 않는다. 깨울 때는 먼저 `claude -p "/compact" --resume 세션`으로 압축하고, 이어서 "문서를 읽고 이어서 해" 메시지를 같은 세션에 보낸다(압축만으로는 세션이 움직이지 않는다). 결과는 .spec/wake.log에 남기고, 서버는 기다리지 않는다. 어떤 경우에도 사용자 결정 자체를 실패시키지 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig } from './config.js';
import { loadRequests } from './request.js';
import { projectRoot } from './status.js';

/** 이 시간 안에 세션 기록이 바뀌었으면 열려 있는 세션으로 본다 */
const OPEN_MS = 10 * 60 * 1000;
/** 깨운 세션이 사람 없이 쓸 수 있게 미리 허락하는 도구(문서·소스 읽기와 고치기, 설계서 보기 명령, 검사). 커밋은 일부러 뺐다 */
const ALLOWED = ['Read', 'Edit', 'Write', 'Bash(node:*)', 'Bash(npm:*)'];

/** 세션 기록 파일 위치: ~/.claude/projects/<실제 프로젝트 경로에서 글자·숫자 아닌 것을 -로 바꾼 이름>/<세션>.jsonl */
function transcriptOf(root: string, sid: string): string {
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* 없으면 그대로 */ }
  return path.join(os.homedir(), '.claude', 'projects', real.replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`);
}

/** 요청 id의 담당 세션 번호들 */
function ownersOf(root: string, id: number): string[] {
  try {
    const sessions = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'sessions.json'), 'utf8')) as Record<string, { request: number }>;
    return Object.entries(sessions).filter(([, v]) => v.request === id).map(([sid]) => sid);
  } catch { return []; }
}

/** 사용자 결정 직후 부른다. 깨운 세션 번호들을 돌려준다(없으면 빈 목록) */
export function wakeOwner(scanRoot: string, id: number): string[] {
  const woken: string[] = [];
  try {
    const root = projectRoot(scanRoot);
    if (!readConfig(root).wake) return woken;
    const req = loadRequests(scanRoot).find((r) => r.id === id);
    const last = req?.events[req.events.length - 1];
    const log = path.join(root, '.spec', 'wake.log');
    for (const sid of ownersOf(root, id)) {
      let idleMs = Infinity;
      try { idleMs = Date.now() - fs.statSync(transcriptOf(root, sid)).mtimeMs; } catch { /* 기록이 없으면 닫힌 것 */ }
      if (idleMs < OPEN_MS) { fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 열려 있어 훅에 맡김\n`); continue; }
      const msg = `[spec-view] 요청 #${id}${req ? ` "${req.title}"` : ''}에 사용자가 결정했습니다(${last?.note ?? ''}). .spec/todo.md와 .spec/requests/${id}.json을 읽고, 마지막 사용자 기록에 따라 이어서 하세요.`;
      const out = fs.openSync(log, 'a');
      const allowed = ALLOWED.map((a) => `'${a}'`).join(' ');
      const script = `claude -p "/compact" --resume ${sid} && claude -p "$MSG" --resume ${sid} --allowedTools ${allowed}`;
      spawn('sh', ['-c', script], { cwd: root, env: { ...process.env, MSG: msg }, detached: true, stdio: ['ignore', out, out] }).unref();
      fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 깨움\n`);
      woken.push(sid);
    }
  } catch { /* 사용자 결정은 깨우기 실패와 상관없이 성공해야 한다 */ }
  return woken;
}
