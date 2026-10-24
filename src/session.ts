/**
 * @spec owner-session 요청 담당 세션 만들기와 비용 기록
 * @why 요청을 시작하면 그 요청 하나만 맡는 세션이 있어야 설계를 쓰고 사용자 결정에 이어서 일할 수 있다. 사람이 세션을 따로 열지 않아도 되게 서버·명령이 세션을 새로 만들고, 만들거나 깨울 때마다 든 비용을 요청별로 남겨 얼마나 드는지 본다.
 * @contract 프로젝트 설정 `wake: true`일 때만 세션을 만든다(호출마다 비용이 들기 때문). 새 세션은 `claude -p 글 --session-id 새번호`로 만들고 .spec/sessions.json에 요청 번호와 함께 바로 적는다. 요청 하나에 담당이 이미 있으면 새로 만들지 않는다. claude는 결과를 JSON으로 받아(`--output-format json`) 토큰과 비용을 .spec/session-costs.json에 적는다. 도구 호출은 기다리지 않고 따로 떨어져 돌며(서버·명령이 먼저 끝나도 계속), 결과는 .spec/wake.log에 남긴다. 어떤 경우에도 시작·결정 자체를 실패시키지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { loadRequests, noteSessionStarted } from './request.js';
import { projectRoot, specDir } from './project.js';
import type { SessionCost } from './types.js';

/** 사람 없이 쓸 수 있게 미리 허락하는 도구: 문서·소스 읽기와 고치기, 설계서 보기 명령, 검사, 그리고 그 일의 커밋. 위험한 git 명령은 저장소의 차단 훅이 막는다 */
export const ALLOWED = ['Read', 'Edit', 'Write', 'Bash(node:*)', 'Bash(npm:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)'];

/** 이 도구의 입구 파일(다른 프로젝트에서도 같은 도구를 부른다) */
const SPEC_MJS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'spec-view', 'spec.mjs');

/** 비용 기록 파일 */
const costFile = (scanRoot: string): string => path.join(specDir(scanRoot), 'session-costs.json');
/** 세션 기록 파일 */
const sessionsFile = (root: string): string => path.join(root, '.spec', 'sessions.json');
/** 로그 파일 */
const logFile = (root: string): string => path.join(root, '.spec', 'wake.log');

/** 비용 기록 전체 */
export function loadCosts(scanRoot: string): SessionCost[] {
  try { return JSON.parse(fs.readFileSync(costFile(scanRoot), 'utf8')) as SessionCost[]; } catch { return []; }
}

/** 비용 한 줄을 덧붙인다 */
export function recordCost(scanRoot: string, c: SessionCost): void {
  const all = loadCosts(scanRoot);
  all.push(c);
  fs.mkdirSync(specDir(scanRoot), { recursive: true });
  fs.writeFileSync(costFile(scanRoot), JSON.stringify(all, null, 2) + '\n');
}

/** claude가 `--output-format json`으로 돌려준 글에서 토큰과 비용을 읽는다. 읽을 수 없으면 null */
export function parseUsage(text: string): { inputTokens: number; outputTokens: number; usd: number } | null {
  try {
    const j = JSON.parse(text.trim().split('\n').filter(Boolean).pop() ?? '') as { total_cost_usd?: number; usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number } };
    if (typeof j.total_cost_usd !== 'number') return null;
    const u = j.usage ?? {};
    return { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, usd: j.total_cost_usd };
  } catch { return null; }
}

/** 요청 하나에 쓴 비용 합계와 횟수 */
export function costOf(scanRoot: string, id: number): { start: number; wake: number; inputTokens: number; outputTokens: number; usd: number } {
  const mine = loadCosts(scanRoot).filter((c) => c.request === id);
  return {
    start: mine.filter((c) => c.kind === 'start').length, wake: mine.filter((c) => c.kind === 'wake').length,
    inputTokens: mine.reduce((n, c) => n + c.inputTokens, 0), outputTokens: mine.reduce((n, c) => n + c.outputTokens, 0), usd: mine.reduce((n, c) => n + c.usd, 0),
  };
}

/** 요청 id의 담당 세션 번호들 */
export function ownersOf(root: string, id: number): string[] {
  try {
    const sessions = JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')) as Record<string, { request: number }>;
    return Object.entries(sessions).filter(([, v]) => v.request === id).map(([sid]) => sid);
  } catch { return []; }
}

/** 세션이 어느 요청의 담당인지 적는다(훅이 적는 것과 같은 모양) */
function registerOwner(root: string, sid: string, id: number): void {
  let all: Record<string, { request: number; seen: string }> = {};
  try { all = JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')); } catch { /* 처음이면 새로 */ }
  all[sid] = { request: id, seen: '' };
  fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
  fs.writeFileSync(sessionsFile(root), JSON.stringify(all, null, 2) + '\n');
}

/** 한 번 부르는 claude 한 줄: 결과를 파일로 받고 끝나면 비용 기록 명령을 부른다. 앞 단계가 실패해도 다음 단계는 간다 */
export interface Step {
  /** claude에 줄 인자들(앞쪽, 글은 $MSG로 따로 줌) */
  args: string;
  /** 글을 줄지(-p "$MSG") 아니면 명령(-p "/compact")을 줄지 */
  prompt: string;
  /** 비용 기록에 적을 종류 */
  kind: 'start' | 'wake';
}

/** 떨어져 도는 셸을 띄워 단계들을 차례로 한다. 서버·명령은 기다리지 않는다 */
function launch(root: string, scanRoot: string, id: number, sid: string, msg: string, steps: Step[]): void {
  const src = path.relative(root, scanRoot) || '.';
  const allowed = ALLOWED.map((a) => `'${a}'`).join(' ');
  const dir = path.join(root, '.spec', 'wake-out');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${Date.now()}-${id}-${sid.slice(0, 8)}`);
  const lines = steps.map((st, i) => [
    `claude -p ${st.prompt} ${st.args} --allowedTools ${allowed} --output-format json > "${base}-${i}.json" 2>> "$LOG"`,
    `rc=$?; echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) #${id} ${sid} ${st.kind === 'start' ? '시작' : '깨움'} 단계 ${i + 1}/${steps.length} 끝남 종료코드=$rc" >> "$LOG"`,
    `node "$SPEC" cost --src "$SRC" --id ${id} --sid ${sid} --kind ${st.kind} --file "${base}-${i}.json" >> "$LOG" 2>&1`,
  ].join('; '));
  spawn('sh', ['-c', lines.join('; ')], {
    cwd: root, detached: true, stdio: 'ignore',
    env: { ...process.env, MSG: msg, SPEC: SPEC_MJS, SRC: src, LOG: logFile(root) },
  }).unref();
}

/** 새 담당 세션이 받는 글: 담당 등록 → 읽기 → 설계 올리고 승인 대기에서 멈춤. 사용자가 이미 결정한 상태(decided)면 그 일만 하게 한다 */
function newOwnerMessage(scanRoot: string, root: string, id: number, title: string, decided: string): string {
  const src = path.relative(root, scanRoot) || '.';
  const intro = `[spec-view] 당신은 요청 #${id} "${title}"의 담당 세션입니다. 이 요청 하나만 합니다.`;
  const register = `\`node ${SPEC_MJS} request agent --id ${id} --name "요청 #${id} 담당" --src ${src}\`로 담당을 등록하세요.`;
  if (decided) return `${intro} 사용자가 결정했습니다(${decided}). ${register} 그 뒤 .spec/requests/${id}.json의 마지막 사용자 기록을 읽고, 사용자가 결정한 그 일만 하고 끝나면 멈추세요. 다른 일을 시작하지 마세요.`;
  return `${intro} 1) ${register} 2) .spec/requests/${id}.json의 원문과 \`node ${SPEC_MJS} todo --src ${src}\`를 읽으세요. 3) 설계를 써서 \`request design --id ${id}\`로 올리고(화면이 바뀌면 현행·시안 그림과 함께), 사용자 승인 대기에서 멈추세요. 승인 전에는 구현하지 않고, 다른 요청은 건드리지 않습니다.`;
}

/** 요청의 담당 세션을 새로 만든다. 만든 세션 번호를 돌려준다(설정이 꺼져 있거나 이미 담당이 있으면 null) */
export function startOwner(scanRoot: string, id: number, why: 'start' | 'decision', decided = ''): string | null {
  try {
    const root = projectRoot(scanRoot);
    if (!readConfig(root).wake) return null;
    const log = logFile(root);
    if (ownersOf(root, id).length) { fs.appendFileSync(log, `${new Date().toISOString()} #${id} 담당 세션이 이미 있어 새로 만들지 않음\n`); return null; }
    const req = loadRequests(scanRoot).find((r) => r.id === id);
    const sid = crypto.randomUUID();
    const msg = newOwnerMessage(scanRoot, root, id, req?.title ?? '', why === 'decision' ? decided || '결정' : '');
    registerOwner(root, sid, id);
    fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 담당 세션을 새로 만듦(${why === 'start' ? '시작' : '결정'})\n`);
    noteSessionStarted(scanRoot, id, sid);
    launch(root, scanRoot, id, sid, msg, [{ args: `--session-id ${sid}`, prompt: '"$MSG"', kind: 'start' }]);
    return sid;
  } catch { return null; /* 시작·결정은 세션 만들기 실패와 상관없이 성공해야 한다 */ }
}

/** 닫힌 담당 세션을 깨운다: 압축하고 이어서 결정된 일만 하라고 보낸다 */
export function resumeOwner(scanRoot: string, id: number, sid: string, decided: string): void {
  const root = projectRoot(scanRoot);
  const req = loadRequests(scanRoot).find((r) => r.id === id);
  const src = path.relative(root, scanRoot) || '.';
  const msg = `[spec-view] 요청 #${id}${req ? ` "${req.title}"` : ''}에 사용자가 결정했습니다(${decided}). .spec/requests/${id}.json의 마지막 사용자 기록을 읽고, \`node ${SPEC_MJS} todo --src ${src}\`로 지금 할 일을 확인하세요. 사용자가 결정한 그 일만 하고, 끝나면 멈추세요. 다른 일을 시작하지 마세요.`;
  launch(root, scanRoot, id, sid, msg, [
    { args: `--resume ${sid}`, prompt: '"/compact"', kind: 'wake' },
    { args: `--resume ${sid}`, prompt: '"$MSG"', kind: 'wake' },
  ]);
}
