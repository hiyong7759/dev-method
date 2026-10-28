/**
 * @spec owner-session 요청 담당 세션 찾기와 보낼 글 만들기
 * @why 요청을 시작하거나 사용자가 결정하면 그 요청 하나만 맡는 담당 세션에 일을 알려야 한다. 어떤 경우에도 claude -p(헤드리스)로 보내지 않으므로, 서버는 보낼 글과 받을 세션만 정해 outbox.ts에 적고 실제로 보내는 일은 메신저 세션이 한다. 이 파일은 그 글과 세션 번호를 만든다.
 * @contract 담당 세션은 .spec/sessions.json(세션 번호 → 요청 번호)에서 찾는다. 담당이 없으면 새 세션 번호를 미리 정해 담당으로 적고(시작 중으로 표시), 서버(outbox.ts의 ownerUp, 요청당 잠금 아래 한 곳)가 `claude --bg --session-id`로 그 번호의 대화형 백그라운드 세션을 만든다. 요청 하나에 담당이 이미 있으면 새로 만들지 않는다. 담당 등록 전의 "시작 중" 세션(30분 안)은 옛 기록으로 걷어 내지 않는다. 새 세션·이어 띄우는 세션에는 node를 입구 파일(spec.mjs)로만 허용하고, 읽기 금지 경로와 비밀 파일 이름이 든 명령을 막는 훅, 그리고 담당에게는 요청 번호 환경(SPEC_OWNER_REQUEST·SPEC_OWNER_SCAN)과 원본이 아니면 워크트리·브랜치·커밋·요청 상태 변경을 막는 훅을 함께 건다(launchArgs, 판단은 owner-check.ts). 담당 기록에는 서버가 만든 원본 표시(origin)와 번호를 맞추는 중 표시(rebinding)가 남는다. 글에는 '그 일'의 끝(구현은 테스트 요청까지)과 막힘·질문을 남기는 명령, 쓰면 막히는 명령, 받았음을 알리는 `request ack` 명령을 적는다. 지난 비용 기록(.spec/session-costs.json)은 읽기만 하고 새로 적지 않는다(헤드리스 결과에서 읽던 값이라 이제 얻을 수 없다).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { brandOf } from './brand.js';
import { readConfig } from './config.js';
import { kst } from './kst.js';
import { loadRequests, noteSessionStarted, STAGE_LABEL, STEP } from './request.js';
import { projectRoot, specDir } from './project.js';
import { isStart, STALL_AFTER_MIN } from './delivery.js';
import type { Request, SessionCost } from './types.js';

/** 이 도구의 입구 파일(다른 프로젝트에서도 같은 도구를 부른다) */
export const SPEC_MJS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'spec-view', 'spec.mjs');

/** 사람 없이 쓸 수 있게 미리 허락하는 도구: 문서·소스 읽기와 고치기, 설계서 보기 명령(node는 입구 파일만 — 임의 스크립트로 읽기 금지 파일을 읽지 못하게), 검사, 시안을 찍는 ego-browser(없으면 사람 없는 세션이 승인을 기다리다 막힌다), 그리고 그 일의 커밋. 위험한 git 명령은 저장소의 차단 훅이 막는다 */
export const ALLOWED = ['Read', 'Edit', 'Write', `Bash(node ${SPEC_MJS}:*)`, 'Bash(npm:*)', 'Bash(ego-browser:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)'];

/** 담당 세션이 읽지 못하게 막는 파일(비밀 값이 든다). Read 도구만 막으므로 명령으로 읽는 길은 허용 목록(node는 입구 파일만)과 hooks/claude-block-secret-read.sh가 막는다 */
export const READ_BANNED = ['Read(.spec/local.json)', 'Read(**/.spec/local.json)', 'Read(.env*)', 'Read(**/.env*)'];

/** 담당 세션이 모두 쓰는 모델(소넷 보통). 비용과 품질을 한 가지로 맞추려고 한 곳에서 정한다 */
const MODEL = 'sonnet';

/** 세션 기록 파일 위치. 담당이 워크트리에 들어가면 Claude Code가 기록을 다른 프로젝트 폴더로 옮기므로 폴더 이름을 추측하지 않고 실제 위치를 찾는다: ① ~/.claude/jobs/<번호8>/state.json의 linkScanPath(세션이 지금 쓰는 파일) ② ~/.claude/projects 아래 모든 폴더의 <번호>.jsonl ③ 없으면 프로젝트 폴더 이름으로 짐작한 자리(아직 대화가 없는 새 세션) */
export function transcriptOf(root: string, sid: string): string {
  const home = os.homedir();
  try {
    const p = (JSON.parse(fs.readFileSync(path.join(home, '.claude', 'jobs', sid.slice(0, 8), 'state.json'), 'utf8')) as { linkScanPath?: string }).linkScanPath;
    if (p && path.basename(p) === `${sid}.jsonl` && fs.existsSync(p)) return p;
  } catch { /* 작업 정보가 없다 */ }
  const projects = path.join(home, '.claude', 'projects');
  try {
    for (const d of fs.readdirSync(projects)) { const f = path.join(projects, d, `${sid}.jsonl`); if (fs.existsSync(f)) return f; }
  } catch { /* 프로젝트 폴더가 없다 */ }
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* 없으면 그대로 */ }
  return path.join(projects, real.replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`);
}

/** 이 안에 세션 기록이 바뀌었으면 일하는 중으로 본다 */
const WORKING_MS = 2 * 60 * 1000;

/** 요청 담당 세션의 활동: 세션 기록의 마지막 변경 시각으로 "일하는 중"인지와 마지막 활동 시각을 안다(실행 중인 프로세스를 부르지 않는다). 기록이 없으면 null */
export function activityOf(root: string, id: number, now = Date.now()): { working: boolean; lastActiveAt: string } | null {
  let last = 0;
  for (const sid of ownersOf(root, id)) {
    try { last = Math.max(last, fs.statSync(transcriptOf(root, sid)).mtimeMs); } catch { /* 아직 대화가 없음 */ }
  }
  return last ? { working: now - last < WORKING_MS, lastActiveAt: new Date(last).toISOString() } : null;
}

/** 비용 기록 파일 */
const costFile = (scanRoot: string): string => path.join(specDir(scanRoot), 'session-costs.json');
/** 세션 기록 파일 */
const sessionsFile = (root: string): string => path.join(root, '.spec', 'sessions.json');
/** 로그 파일 */
export const logFile = (root: string): string => path.join(root, '.spec', 'wake.log');

/** 비용 기록 전체(지난 헤드리스 기록. 새로 적지는 않는다) */
export function loadCosts(scanRoot: string): SessionCost[] {
  try { return JSON.parse(fs.readFileSync(costFile(scanRoot), 'utf8')) as SessionCost[]; } catch { return []; }
}

/** 비용 한 줄을 덧붙인다(cost 명령용) */
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

/** 시작한 지 이 안이면 아직 시작 중인 세션으로 본다 */
const STARTING_MS = 30 * 60 * 1000;

/** 요청 id에 서버가 정해 아직 시작 중인 담당 세션이 있는지 */
function hasStarting(root: string, id: number): boolean {
  try {
    const all = JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')) as Record<string, { request: number; starting?: string }>;
    return Object.values(all).some((v) => v.request === id && v.starting && Date.now() - Date.parse(v.starting) < STARTING_MS);
  } catch { return false; }
}

/** 요청의 담당 기록을 모두 지운다(담당을 정한 적 없는 세션이 담당으로 남은 옛 기록을 걷어 낼 때) */
function unregisterOwners(root: string, id: number): void {
  try {
    const all = JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')) as Record<string, { request: number }>;
    for (const sid of Object.keys(all)) if (all[sid].request === id) delete all[sid];
    fs.writeFileSync(sessionsFile(root), JSON.stringify(all, null, 2) + '\n');
  } catch { /* 기록이 없으면 지울 것도 없다 */ }
}

/** 세션이 어느 요청의 담당인지 적는다(훅이 적는 것과 같은 모양) */
function registerOwner(root: string, sid: string, id: number): void {
  let all: Record<string, OwnerEntry> = {};
  try { all = JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')); } catch { /* 처음이면 새로 */ }
  // starting: 이 서버가 정한 시각. 담당 등록이 끝나기 전의 세션을 옛 기록으로 오해해 걷어 내지 않는 근거다. origin: 서버가 만든 원본 담당 표시(owner-check가 "내가 원본인가"를 가리는 기준)
  all[sid] = { request: id, seen: '', starting: new Date().toISOString(), origin: true };
  fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
  fs.writeFileSync(sessionsFile(root), JSON.stringify(all, null, 2) + '\n');
}

/** 담당 번호를 바꾼다. `claude --bg`는 미리 정한 세션 번호를 그대로 쓰지 않고 자기 번호를 붙이므로, 만든 뒤 실제 번호로 갈아 끼운다(그대로 두면 같은 요청에 담당이 둘로 남고, 이어 띄울 때 대화를 못 찾아 새 세션이 생긴다). 훅이 이미 실제 번호를 적었으면 옛 번호만 지운다 */
export function rebindOwner(root: string, oldSid: string, newSid: string): void {
  if (oldSid === newSid) return;
  try {
    const all = JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')) as Record<string, OwnerEntry>;
    if (!all[oldSid]) return;
    const moved = { ...all[oldSid] };
    delete moved.rebinding;
    all[newSid] = all[newSid] ? { ...all[newSid], origin: moved.origin ?? all[newSid].origin } : moved;
    delete all[oldSid];
    fs.writeFileSync(sessionsFile(root), JSON.stringify(all, null, 2) + '\n');
    fs.appendFileSync(logFile(root), `${new Date().toISOString()} 담당 번호를 ${oldSid} → ${newSid}로 바꿈(claude --bg가 붙인 실제 번호)\n`);
  } catch { /* 기록이 없으면 바꿀 것도 없다 */ }
}

/** 담당 기록의 한 칸. origin: 서버가 만든 원본 담당, rebinding: claude --bg가 실제 번호를 붙이는 중이라 번호를 맞추기 전이라는 시각(owner-check가 이 사이에는 "맞추는 중"으로 본다) */
export interface OwnerEntry {
  /** 이 세션이 맡은 요청 번호 */
  request: number;
  /** 사용자 기록을 어디까지 알렸나(마지막으로 본 기록 시각) */
  seen: string;
  /** 서버가 번호를 정해 아직 시작 중인 시각(등록 전 세션을 옛 기록으로 오해하지 않는 근거) */
  starting?: string;
  /** 서버가 만든 원본 담당 표시(owner-check가 "내가 원본인가"를 가리는 기준) */
  origin?: boolean;
  /** claude --bg가 실제 번호를 붙이는 중인 시각(번호를 맞추기 전까지 원본을 복사본으로 오판하지 않게) */
  rebinding?: string;
}

/** 담당 기록 전체 */
export function loadOwners(root: string): Record<string, OwnerEntry> {
  try { return JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')) as Record<string, OwnerEntry>; } catch { return {}; }
}
function saveOwners(root: string, all: Record<string, OwnerEntry>): void {
  fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
  fs.writeFileSync(sessionsFile(root), JSON.stringify(all, null, 2) + '\n');
}

/** 담당을 띄우기 직전에 "번호를 맞추는 중"으로 적고, 맞춘 뒤(rebindOwner)나 실패했을 때(false) 해제한다 */
export function markRebinding(root: string, sid: string, on: boolean): void {
  const all = loadOwners(root);
  if (!all[sid]) return;
  if (on) all[sid].rebinding = new Date().toISOString(); else delete all[sid].rebinding;
  saveOwners(root, all);
}

/** 수동 지정: 요청의 원본 담당을 이 세션 하나로 정한다(어긋났을 때 사용자·메인이 푼다). 그 요청의 다른 담당 기록은 지운다. 지운 번호들을 돌려준다 */
export function adoptOwner(root: string, id: number, sid: string): string[] {
  const all = loadOwners(root);
  const removed = Object.keys(all).filter((k) => all[k].request === id && k !== sid);
  for (const k of removed) delete all[k];
  all[sid] = { ...(all[sid] ?? { seen: new Date().toISOString() }), request: id, origin: true };
  delete all[sid].rebinding;
  saveOwners(root, all);
  fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} 원본 담당을 ${sid}로 수동 지정(지운 기록: ${removed.join(', ') || '없음'})\n`);
  return removed;
}

/** 담당 세션의 명령에 비밀 파일 이름이 들어 있으면 막는 훅 */
const SECRET_HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'claude-block-secret-read.sh');
/** 원본이 아닌 담당의 워크트리·브랜치·커밋·상태 변경을 막는 훅 */
const OWNER_HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'claude-block-nonowner.sh');

/** 메신저가 `claude --bg`로 세션을 만들거나 이어 띄울 때 붙이는 인자(글은 뺀 것). 허용·금지 도구와 비밀 읽기 차단 훅을 그대로 걸고, 설정에 autoCompact가 있으면 세션이 스스로 압축하게 한다(메시지로 보낸 /compact는 실행되지 않고 헤드리스는 쓰지 않으므로, 컨텍스트가 커지는 것은 세션 안의 자동 압축으로 막는다) */
export function launchArgs(root?: string, requestId?: number, scanRoot?: string): string[] {
  // 담당 세션에는 요청 번호·설계서 소스 폴더를 환경으로 넘기고, 원본이 아니면 워크트리·브랜치·커밋·요청 상태 변경을 막는 훅을 건다(owner-check)
  const owner = requestId && scanRoot;
  const hookCfg = JSON.stringify({
    ...(owner ? { env: { SPEC_OWNER_REQUEST: String(requestId), SPEC_OWNER_SCAN: scanRoot } } : {}),
    hooks: { PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: `bash ${SECRET_HOOK}` }] },
      ...(owner ? [{ matcher: 'Bash|EnterWorktree', hooks: [{ type: 'command', command: `bash ${OWNER_HOOK}` }] }] : []),
    ] },
  });
  const ac = root ? readConfig(root).autoCompact : undefined;
  // claude는 10만~100만 토큰만 받는다. 범위 밖이면 옵션을 빼서 세션이 뜨지 않는 일이 없게 한다
  const compact = ac && ac >= 100_000 && ac <= 1_000_000 ? ['--autocompact', String(Math.round(ac))] : [];
  return ['--model', MODEL, ...compact, '--allowedTools', ...ALLOWED, '--disallowedTools', ...READ_BANNED, '--settings', hookCfg];
}

/** 요청 내용을 글에 직접 넣는다. 세션이 요청 파일을 읽느라 쓰는 턴(턴마다 기본 맥락을 다시 읽어 비용이 든다)을 없앤다 */
function briefOf(req: Request | undefined): string {
  if (!req) return '';
  const events = req.events.slice(-4).map((e) => `- ${kst(e.at)} ${e.by === 'user' ? '사용자' : '에이전트'}: ${e.note}${e.quote ? ` (사용자가 한 말: "${e.quote}")` : ''}`).join('\n');
  return `\n[요청 내용 — 아래에 넣었으니 요청 파일을 따로 읽지 않아도 됩니다]\n원문: ${req.origin.text.slice(0, 600)}\n상태: ${STAGE_LABEL[req.stage]} · ${STEP[`${req.stage}:${req.step}`]?.label ?? req.step}\n최근 기록:\n${events}\n`;
}

/** 담당 세션이 막히지 않고 끝까지 하게 하는 지시: 검사 방법, 쓰지 말 명령, 막힘·질문을 남기는 명령, 받았음을 알리는 명령. 새 담당 글과 결정 글에 모두 넣는다 */
function guideOf(id: number, src: string): string {
  return `타입 검사는 \`npm run typecheck\`로 합니다. npx tsc, bash install.sh, 시험 폴더의 .git/hooks, 다른 폴더로 cd한 뒤의 git은 허용 목록 밖이라 막히니 쓰지 마세요. 비밀 값이 든 파일(.spec 아래 local 설정과 환경 변수 파일)은 읽지 마세요. 허용 목록 밖이라 막히면 검증 없이 끝내지 말고 \`node ${SPEC_MJS} request blocked --id ${id} --note "막힌 명령과 이유" --src ${src}\`로 사실을 남기세요. 사용자에게 허락·결정을 물어야 하면 대화에만 묻지 말고 \`node ${SPEC_MJS} request ask --id ${id} --text "질문" --src ${src}\`도 부르세요(요청 상태와 내 차례 화면에 보입니다). 이 글을 받았으면 일을 시작하기 전에 먼저 \`node ${SPEC_MJS} request whoami --id ${id} --src ${src}\`로 내가 이 요청의 원본 담당인지 확인하세요(복사본이라고 나오면 아무 일도 하지 말고 멈추세요). 원본이면 \`node ${SPEC_MJS} request ack --id ${id} --src ${src}\`를 한 번 부르세요(사용자 화면의 "읽음"은 이 명령으로만 찍힙니다).`;
}

/** "그 일"의 끝: 어디까지 하고 멈추는지 */
const THAT_JOB = '사용자가 결정한 그 일만 하고(승인이면 구현·커밋과 `request impl`·`finish`·`request test`로 테스트 요청을 올리는 데까지, 설계 반려·변경이면 설계를 고쳐 `request design`으로 다시 올리는 데까지, 테스트 문제면 고쳐 `request test`를 다시 올리는 데까지), 끝나면 멈추세요. 다른 일을 시작하지 마세요.';

/** 설계 파일 모양(세션이 규칙 문서를 찾아 읽지 않아도 되게 줄여서 넣는다) */
const DESIGN_SHAPE = '설계 파일(JSON) 모양: understanding(짧은 한 줄 요약), files[{path, why}](이 설계가 건드릴 파일과 이유. 필수이고 "설계 없음"에도 필요하며, 승인 뒤 구현 커밋은 이 파일 안에서만 할 수 있다), points[{area 영역, title 바뀌는 것, text 설명}], changes[{info, kind add|remove|change|link, field, note}], screens[{screen, after 시안 그림, note, counts, highlights, isNew}]. 이미 있는 화면은 먼저 `request shot --id 번호 --screen 화면 --url 운영 화면 주소`로 현행을 찍어 둔다(손으로 올린 그림은 경고가 붙는다). 설계서 보기에 없는 새 화면은 isNew: true. 정보도 화면도 안 바뀌면 `request design --id 번호 --none true`. "이렇게 처리하겠습니다"(approach)는 설계 없음에서 항목이 하나뿐인 짧은 설명에만 쓰고, 항목이 둘 이상이면 설계 없음이어도 points 표로 적는다.';

/** 담당 세션 이름: 여러 프로젝트를 함께 쓸 때 헷갈리지 않게 프로젝트 이름을 앞에 붙인다 */
export const ownerName = (root: string, id: number): string => `${brandOf(root).name} #${id} 담당`;

/** 새 담당 세션이 받는 글: 담당 등록 → 설계 올리고 승인 대기에서 멈춤. 사용자가 이미 결정한 상태(decided)면 그 일만 하게 한다 */
export function newOwnerMessage(scanRoot: string, root: string, req: Request | undefined, id: number, decided: string): string {
  const src = path.relative(root, scanRoot) || '.';
  const pn = brandOf(root).name;
  const intro = `[${pn} 요청 #${id} 담당] 당신은 ${pn} 프로젝트의 요청 #${id} "${req?.title ?? ''}"의 담당 세션입니다. 이 요청 하나만 합니다. 사용자에게 하는 보고에서는 요청 번호 앞에 프로젝트 이름을 붙이고(예: ${pn} 요청 #${id}), 파일로 보내는 캡처 이름 앞에도 붙입니다.`;
  const register = `\`node ${SPEC_MJS} request agent --id ${id} --name "${ownerName(root, id)}" --src ${src}\`로 담당을 등록하세요.`;
  if (decided) return `${intro} 사용자가 결정했습니다(${decided}). ${register}${briefOf(req)}\n${THAT_JOB} ${guideOf(id, src)} 더 알아야 하면 .spec/requests/${id}.json을 읽으세요.`;
  return `${intro} 1) ${register} 2) 아래 요청 내용을 읽고 설계를 써서 \`request design --id ${id}\`로 올린 뒤(화면이 바뀌면 현행·시안 그림과 함께) 사용자 승인 대기에서 멈추세요. 승인 전에는 구현하지 않고, 다른 요청은 건드리지 않습니다.${briefOf(req)}\n${DESIGN_SHAPE} ${guideOf(id, src)} 더 알아야 하면 \`node ${SPEC_MJS} todo --src ${src}\`나 .spec/requests/${id}.json을 읽으세요.`;
}

/** 이미 있는 담당 세션이 받는 결정 글. stalled면 결정을 반영한 뒤 멈춘 세션을 다시 알리는 글 */
export function decisionMessage(scanRoot: string, id: number, decided: string, stalled = false): string {
  const root = projectRoot(scanRoot);
  const req = loadRequests(scanRoot).find((r) => r.id === id);
  const src = path.relative(root, scanRoot) || '.';
  const head = stalled && req && isStart(req)
    ? `[spec-view] ${brandOf(root).name} 요청 #${id}${req ? ` "${req.title}"` : ''}을 시작했는데 담당을 맡은 뒤 ${STALL_AFTER_MIN}분 넘게 설계가 올라오지 않아 다시 알립니다. 요청 내용을 읽고 설계를 써서 \`request design --id ${id}\`로 올리고 승인 대기에서 멈추세요.`
    : stalled
    ? `[spec-view] ${brandOf(root).name} 요청 #${id}${req ? ` "${req.title}"` : ''}에 사용자가 결정(${decided})한 뒤 ${STALL_AFTER_MIN}분 넘게 다음 단계 기록이 없어 다시 알립니다. 구현·커밋을 마쳤다면 \`request impl\`·\`finish\`·\`request test\`까지 올리고 멈추세요.`
    : `[spec-view] ${brandOf(root).name} 요청 #${id}${req ? ` "${req.title}"` : ''}에 사용자가 결정했습니다(${decided}).`;
  return `${head}${briefOf(req)}\n${stalled ? '' : `${THAT_JOB} `}${guideOf(id, src)} 더 알아야 하면 .spec/requests/${id}.json과 \`node ${SPEC_MJS} todo --src ${src}\`로 지금 할 일을 확인하세요.`;
}

/** 요청의 담당 세션을 정한다. 이미 있으면 그 번호(created=false), 없으면 새 번호를 담당으로 적고 돌려준다(created=true, 실제 세션은 메신저가 만든다). 담당을 정한 적 없는 옛 기록은 걷어 내고 새로 정하며, 시작 중인 것이 있으면 새로 정하지 않는다 */
export function prepareOwner(scanRoot: string, id: number): { sid: string; created: boolean } {
  const root = projectRoot(scanRoot);
  const log = logFile(root);
  const req = loadRequests(scanRoot).find((r) => r.id === id);
  const all = loadOwners(root);
  const owners = ownersOf(root, id).sort((a, b) => Number(!!all[b]?.origin) - Number(!!all[a]?.origin));
  if (owners.length) {
    // 담당을 정한 적 없는(request agent를 안 부른) 요청의 옛 담당 기록은 요청을 접수한 세션이 남긴 것이라 담당이 아니다
    if (req?.agent.name || hasStarting(root, id)) return { sid: owners[0], created: false };
    unregisterOwners(root, id);
    fs.appendFileSync(log, `${new Date().toISOString()} #${id} 담당을 정한 적 없는 옛 기록이라 걷어 내고 새로 정함\n`);
  }
  const sid = crypto.randomUUID();
  registerOwner(root, sid, id);
  noteSessionStarted(scanRoot, id, sid);
  fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 담당 세션 번호를 새로 정함(메신저가 만든다)\n`);
  return { sid, created: true };
}
