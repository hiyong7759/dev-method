/**
 * @spec owner-session 요청 담당 세션 만들기와 비용 기록
 * @why 요청을 시작하면 그 요청 하나만 맡는 세션이 있어야 설계를 쓰고 사용자 결정에 이어서 일할 수 있다. 사람이 세션을 따로 열지 않아도 되게 서버·명령이 세션을 새로 만들고, 만들거나 깨울 때마다 든 비용을 요청별로 남겨 얼마나 드는지 본다.
 * @contract 프로젝트 설정 `wake: true`일 때만 세션을 만든다(호출마다 비용이 들기 때문). 시작은 줄 없이 바로, 깨움은 같은 세션끼리 차례로·서로 다른 세션은 3개까지 동시에 돈다. 담당 등록 전의 "시작 중" 세션(30분 안)은 옛 기록으로 걷어 내지 않고, 10분 넘게 소식이 없으면 retryStalledStarts가 한 번 다시 시작한다.새 세션은 `claude -p 글 --session-id 새번호`로 만들고 .spec/sessions.json에 요청 번호와 함께 바로 적는다. 요청 하나에 담당이 이미 있으면 새로 만들지 않는다. claude는 결과를 JSON으로 받아(`--output-format json`) 토큰과 비용을 .spec/session-costs.json에 적는다. 도구 호출은 기다리지 않고 따로 떨어져 돌며(서버·명령이 먼저 끝나도 계속), 결과는 .spec/wake.log에 남긴다. 어떤 경우에도 시작·결정 자체를 실패시키지 않는다. 담당 세션에는 node를 입구 파일(spec.mjs)로만 허용하고, 읽기 금지 경로(.spec/local.json, .env*)와 비밀 파일 이름이 든 명령을 막는 훅을 함께 건다. 새 담당·깨움 글에는 '그 일'의 끝(구현은 테스트 요청까지)과 막힘·질문을 남기는 명령, 쓰면 막히는 명령을 적는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { brandOf } from './brand.js';
import { kst } from './kst.js';
import { loadRequests, noteSessionFailed, noteSessionStarted, STAGE_LABEL, STEP } from './request.js';
import { projectRoot, specDir } from './project.js';
import { STALL_AFTER_MIN } from './delivery.js';
import type { Request, SessionCost } from './types.js';

/** 이 도구의 입구 파일(다른 프로젝트에서도 같은 도구를 부른다) */
const SPEC_MJS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'spec-view', 'spec.mjs');

/** 사람 없이 쓸 수 있게 미리 허락하는 도구: 문서·소스 읽기와 고치기, 설계서 보기 명령(node는 입구 파일만 — 임의 스크립트로 읽기 금지 파일을 읽지 못하게), 검사, 시안을 찍는 ego-browser(없으면 사람 없는 세션이 승인을 기다리다 막힌다), 그리고 그 일의 커밋. 위험한 git 명령은 저장소의 차단 훅이 막는다 */
export const ALLOWED = ['Read', 'Edit', 'Write', `Bash(node ${SPEC_MJS}:*)`, 'Bash(npm:*)', 'Bash(ego-browser:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)'];

/** 담당 세션이 읽지 못하게 막는 파일(비밀 값이 든다). Read 도구만 막으므로 명령으로 읽는 길은 허용 목록(node는 입구 파일만)과 hooks/claude-block-secret-read.sh가 막는다 */
export const READ_BANNED = ['Read(.spec/local.json)', 'Read(**/.spec/local.json)', 'Read(.env*)', 'Read(**/.env*)'];

/** 담당 세션이 모두 쓰는 모델(소넷 보통). 비용과 품질을 한 가지로 맞추려고 한 곳에서 정한다 */
const MODEL = 'sonnet';

/** 이만큼 쉬면 프롬프트 캐시가 식어 이어 부를 때 대화 전체를 비싸게 다시 읽는다. 이때만 압축해서 줄인다 */
const CACHE_COLD_MS = 60 * 60 * 1000;
/** 대화 기록이 이만큼 커도 압축한다(캐시가 따뜻해도 매 턴 읽는 양이 크다) */
const BIG_BYTES = 500 * 1024;

/** 서로 다른 세션의 깨움을 동시에 돌릴 수 있는 수 */
const WAKE_SLOTS = 3;

/** 세션 기록 파일 위치: ~/.claude/projects/<실제 프로젝트 경로에서 글자·숫자 아닌 것을 -로 바꾼 이름>/<세션>.jsonl */
export function transcriptOf(root: string, sid: string): string {
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* 없으면 그대로 */ }
  return path.join(os.homedir(), '.claude', 'projects', real.replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`);
}

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

/** 이 세션이 지금 어딘가(VS Code, 터미널)에 살아 있다면 일하는 중(busy)인지 기다리는 중(idle)인지. `claude agents --json`이 알려 준다. 살아 있지 않거나 알아낼 수 없으면 null(그래야 결정이 전달된다) */
export function aliveStatus(sid: string): 'busy' | 'idle' | null {
  try {
    const run = spawnSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 15000 });
    if (run.status !== 0) return null;
    const hit = (JSON.parse(run.stdout) as { sessionId?: string; status?: string }[]).find((a) => a.sessionId === sid);
    return hit ? (hit.status === 'busy' ? 'busy' : 'idle') : null;
  } catch { return null; }
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
/** 시작한 뒤 담당 등록이 이만큼 없고 기록도 안 늘면 빠진 것으로 보고 다시 시작한다 */
const STALLED_MS = 10 * 60 * 1000;

/** 요청 id에 서버가 만들어 아직 시작 중인 담당 세션이 있는지 */
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
  let all: Record<string, { request: number; seen: string; starting?: string; retried?: boolean }> = {};
  try { all = JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')); } catch { /* 처음이면 새로 */ }
  // starting: 이 서버가 만든 시각. 담당 등록이 끝나기 전의 세션을 옛 기록으로 오해해 걷어 내지 않는 근거다
  all[sid] = { request: id, seen: '', starting: new Date().toISOString() };
  fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
  fs.writeFileSync(sessionsFile(root), JSON.stringify(all, null, 2) + '\n');
}

/** 담당 세션의 명령에 비밀 파일 이름이 들어 있으면 막는 훅 */
const SECRET_HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'claude-block-secret-read.sh');

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
  const kind = steps[0].kind;
  const src = path.relative(root, scanRoot) || '.';
  const allowed = ALLOWED.map((a) => `'${a}'`).join(' ');
  const banned = READ_BANNED.map((a) => `'${a}'`).join(' ');
  const hookCfg = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `bash ${SECRET_HOOK}` }] }] } });
  const dir = path.join(root, '.spec', 'wake-out');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${Date.now()}-${id}-${sid.slice(0, 8)}`);
  const lines = steps.map((st, i) => [
    `claude -p ${st.prompt} ${st.args} --model ${MODEL} --allowedTools ${allowed} --disallowedTools ${banned} --settings '${hookCfg}' --output-format json > "${base}-${i}.json" 2>> "$LOG"`,
    `rc=$?; echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) #${id} ${sid} ${st.kind === 'start' ? '시작' : '깨움'} 단계 ${i + 1}/${steps.length} 끝남 종료코드=$rc" >> "$LOG"`,
    `node "$SPEC" cost --src "$SRC" --id ${id} --sid ${sid} --kind ${st.kind} --file "${base}-${i}.json" >> "$LOG" 2>&1`,
  ].join('; '));
  // 새 세션 시작은 줄을 서지 않고 바로 한다(이어 쓸 캐시가 없고, 줄에 밀리면 시작이 몇 분 늦어 빠진 것처럼 보인다).
  // 깨움은 ① 같은 세션에는 한 번에 하나씩(앞 호출이 데운 캐시를 다음 호출이 쓰게 해 비용을 아끼고, 같은 대화에 둘이 끼어들지 않게) ② 전체로는 동시에 WAKE_SLOTS개까지만 한다(여러 건을 한꺼번에 승인해도 한 줄로 밀리지 않게). 잠금은 30분이 지나면 낡은 것으로 보고 푼다
  const lock = kind === 'start' ? '' : [
    'D="$ROOT/.spec/wake-out"',
    'stale() { if [ -n "$(find "$1" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$1" 2>/dev/null; fi; }',
    `SL="$D/s-${sid}"; until mkdir "$SL" 2>/dev/null; do stale "$SL"; sleep 1; done`,
    `got=; while [ -z "$got" ]; do n=0; while [ $n -lt ${WAKE_SLOTS} ]; do if mkdir "$D/slot$n" 2>/dev/null; then got=$n; break; fi; stale "$D/slot$n"; n=$((n+1)); done; if [ -z "$got" ]; then sleep 1; fi; done`,
    `trap 'rmdir "$SL" "$D/slot$got" 2>/dev/null' EXIT`,
  ].join('; ');
  // 모든 단계가 끝나면 끝남 표시 파일을 만든다(서버를 갈아 띄우기 전에 끝나지 않은 깨움을 알아보는 근거)
  const child = spawn('sh', ['-c', `${lock ? `${lock}; ` : ''}${lines.join('; ')}; : > "${base}.done"`], {
    cwd: root, detached: true, stdio: 'ignore',
    env: { ...process.env, MSG: msg, SPEC: SPEC_MJS, SRC: src, LOG: logFile(root), ROOT: root },
  });
  child.unref();
  addJob(root, { request: id, session: sid, sentAt: new Date().toISOString(), pid: child.pid ?? 0, doneFile: `${base}.done`, msg, steps });
}

/** 끝나지 않은 깨움 기록(.spec/wake-jobs.json) 한 건: 어느 요청·세션에 어떤 글을 보냈고, 그 일이 끝났는지는 끝남 표시 파일이 있는지로 안다 */
export interface WakeJob {
  /** 어느 요청의 일인지(끊긴 깨움을 이어 보낼 때 같은 요청으로 보낸다) */
  request: number;
  /** 글을 받은 담당 세션 번호 */
  session: string;
  /** 보낸 시각 */
  sentAt: string;
  /** 글을 보내는 셸의 프로세스 번호. 끝남 표시가 없는데 이 프로세스도 없으면 끊긴 것이다 */
  pid: number;
  /** 모든 단계가 끝나면 셸이 만드는 표시 파일. 있으면 끝난 깨움이다 */
  doneFile: string;
  /** 보낸 글. 끊겼을 때 같은 글로 다시 보낸다 */
  msg: string;
  /** 부른 claude 단계들(압축 → 지시). 끊겼을 때 같은 단계로 다시 한다 */
  steps: Step[];
}
const jobsFile = (root: string): string => path.join(root, '.spec', 'wake-jobs.json');
function readJobs(root: string): WakeJob[] {
  try { return JSON.parse(fs.readFileSync(jobsFile(root), 'utf8')) as WakeJob[]; } catch { return []; }
}
/** 기록에 한 건을 더한다. 이미 끝난 것과 같은 요청·세션의 옛 기록은 걷어 낸다 */
function addJob(root: string, job: WakeJob): void {
  try {
    const keep = readJobs(root).filter((j) => !fs.existsSync(j.doneFile) && !(j.request === job.request && j.session === job.session));
    fs.writeFileSync(jobsFile(root), JSON.stringify([...keep, job], null, 2) + '\n');
  } catch { /* 기록 실패가 깨움을 막지 않는다 */ }
}
/** 그 번호의 프로세스가 아직 있나 */
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return pid > 0; } catch { return false; } };
/** 지금 진행 중인 깨움(끝남 표시가 없고 프로세스가 살아 있는 것) */
export function runningJobs(root: string): WakeJob[] { return readJobs(root).filter((j) => !fs.existsSync(j.doneFile) && alive(j.pid)); }
/** 서버를 갈아 띄우다 끊긴 깨움(끝남 표시가 없는데 프로세스가 없는 것)을 같은 글로 다시 보낸다. 다시 보낸 요청 번호들을 돌려준다 */
export function resumeBrokenJobs(scanRoot: string): number[] {
  const done: number[] = [];
  try {
    const root = projectRoot(scanRoot);
    for (const j of readJobs(root)) {
      if (fs.existsSync(j.doneFile) || alive(j.pid)) continue;
      // 이미 대화가 만들어졌다면 --session-id가 아니라 --resume으로 이어 쓴다
      let exists = false;
      try { fs.statSync(transcriptOf(root, j.session)); exists = true; } catch { /* 대화가 아직 없음 */ }
      const steps = j.steps.map((st) => ({ ...st, args: exists ? st.args.replace('--session-id', '--resume') : st.args }));
      fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${j.request} ${j.session} 서버를 다시 띄우다 끊긴 깨움을 같은 글로 이어 보냄\n`);
      launch(root, scanRoot, j.request, j.session, j.msg, steps);
      done.push(j.request);
    }
  } catch { /* 점검이 실패해도 서버는 계속 돈다 */ }
  return done;
}

/** 요청 내용을 글에 직접 넣는다. 세션이 요청 파일을 읽느라 쓰는 턴(턴마다 기본 맥락을 다시 읽어 비용이 든다)을 없앤다 */
function briefOf(req: Request | undefined): string {
  if (!req) return '';
  const events = req.events.slice(-4).map((e) => `- ${kst(e.at)} ${e.by === 'user' ? '사용자' : '에이전트'}: ${e.note}${e.quote ? ` (사용자가 한 말: "${e.quote}")` : ''}`).join('\n');
  return `\n[요청 내용 — 아래에 넣었으니 요청 파일을 따로 읽지 않아도 됩니다]\n원문: ${req.origin.text.slice(0, 600)}\n상태: ${STAGE_LABEL[req.stage]} · ${STEP[`${req.stage}:${req.step}`]?.label ?? req.step}\n최근 기록:\n${events}\n`;
}

/** 담당 세션이 막히지 않고 끝까지 하게 하는 지시: 검사 방법, 쓰지 말 명령, 막힘·질문을 남기는 명령. 새 담당 글과 깨움 글에 모두 넣는다 */
function guideOf(id: number, src: string): string {
  return `타입 검사는 \`npm run typecheck\`로 합니다. npx tsc, bash install.sh, 시험 폴더의 .git/hooks, 다른 폴더로 cd한 뒤의 git은 허용 목록 밖이라 막히니 쓰지 마세요. .spec/local.json과 .env*는 읽지 마세요. 허용 목록 밖이라 막히면 검증 없이 끝내지 말고 \`node ${SPEC_MJS} request blocked --id ${id} --note "막힌 명령과 이유" --src ${src}\`로 사실을 남기세요. 사용자에게 허락·결정을 물어야 하면 대화에만 묻지 말고 \`node ${SPEC_MJS} request ask --id ${id} --text "질문" --src ${src}\`도 부르세요(요청 상태와 내 차례 화면에 보입니다).`;
}

/** "그 일"의 끝: 어디까지 하고 멈추는지 */
const THAT_JOB = '사용자가 결정한 그 일만 하고(승인이면 구현·커밋과 `request impl`·`finish`·`request test`로 테스트 요청을 올리는 데까지, 설계 반려·변경이면 설계를 고쳐 `request design`으로 다시 올리는 데까지, 테스트 문제면 고쳐 `request test`를 다시 올리는 데까지), 끝나면 멈추세요. 다른 일을 시작하지 마세요.';

/** 설계 파일 모양(세션이 규칙 문서를 찾아 읽지 않아도 되게 줄여서 넣는다) */
const DESIGN_SHAPE = '설계 파일(JSON) 모양: understanding(짧은 한 줄 요약), files[{path, why}](이 설계가 건드릴 파일과 이유. 필수이고 "설계 없음"에도 필요하며, 승인 뒤 구현 커밋은 이 파일 안에서만 할 수 있다), points[{area 영역, title 바뀌는 것, text 설명}], changes[{info, kind add|remove|change|link, field, note}], screens[{screen, after 시안 그림, note, counts, highlights, isNew}]. 이미 있는 화면은 먼저 `request shot --id 번호 --screen 화면 --url 운영 화면 주소`로 현행을 찍어 둔다(손으로 올린 그림은 경고가 붙는다). 설계서 보기에 없는 새 화면은 isNew: true. 정보도 화면도 안 바뀌면 `request design --id 번호 --none true`. "이렇게 처리하겠습니다"(approach)는 설계 없음에서 항목이 하나뿐인 짧은 설명에만 쓰고, 항목이 둘 이상이면 설계 없음이어도 points 표로 적는다.';

/** 담당 세션 이름: 여러 프로젝트를 함께 쓸 때 헷갈리지 않게 프로젝트 이름을 앞에 붙인다 */
const ownerName = (root: string, id: number): string => `${brandOf(root).name} #${id} 담당`;

/** 새 담당 세션이 받는 글: 담당 등록 → 설계 올리고 승인 대기에서 멈춤. 사용자가 이미 결정한 상태(decided)면 그 일만 하게 한다 */
function newOwnerMessage(scanRoot: string, root: string, req: Request | undefined, id: number, decided: string): string {
  const src = path.relative(root, scanRoot) || '.';
  const pn = brandOf(root).name;
  const intro = `[${pn} 요청 #${id} 담당] 당신은 ${pn} 프로젝트의 요청 #${id} "${req?.title ?? ''}"의 담당 세션입니다. 이 요청 하나만 합니다. 사용자에게 하는 보고에서는 요청 번호 앞에 프로젝트 이름을 붙이고(예: ${pn} 요청 #${id}), 파일로 보내는 캡처 이름 앞에도 붙입니다.`;
  const register = `\`node ${SPEC_MJS} request agent --id ${id} --name "${ownerName(root, id)}" --src ${src}\`로 담당을 등록하세요.`;
  if (decided) return `${intro} 사용자가 결정했습니다(${decided}). ${register}${briefOf(req)}\n${THAT_JOB} ${guideOf(id, src)} 더 알아야 하면 .spec/requests/${id}.json을 읽으세요.`;
  return `${intro} 1) ${register} 2) 아래 요청 내용을 읽고 설계를 써서 \`request design --id ${id}\`로 올린 뒤(화면이 바뀌면 현행·시안 그림과 함께) 사용자 승인 대기에서 멈추세요. 승인 전에는 구현하지 않고, 다른 요청은 건드리지 않습니다.${briefOf(req)}\n${DESIGN_SHAPE} ${guideOf(id, src)} 더 알아야 하면 \`node ${SPEC_MJS} todo --src ${src}\`나 .spec/requests/${id}.json을 읽으세요.`;
}

/** 요청의 담당 세션을 새로 만든다. 만든 세션 번호를 돌려준다(설정이 꺼져 있거나 이미 담당이 있으면 null) */
export function startOwner(scanRoot: string, id: number, why: 'start' | 'decision', decided = ''): string | null {
  try {
    const root = projectRoot(scanRoot);
    if (!readConfig(root).wake) return null;
    const log = logFile(root);
    const req = loadRequests(scanRoot).find((r) => r.id === id);
    if (ownersOf(root, id).length) {
      // 담당을 정한 적 없는(request agent를 안 부른) 요청의 옛 담당 기록은 요청을 접수한 세션이 남긴 것이라 담당이 아니다
      if (req?.agent.name) { fs.appendFileSync(log, `${new Date().toISOString()} #${id} 담당 세션이 이미 있어 새로 만들지 않음\n`); return null; }
      // 방금 만든 세션이 아직 담당을 등록하지 못한 것(시작 중)이면 옛 기록이 아니다. 걷어 내고 새로 만들면 담당이 둘이 된다
      if (hasStarting(root, id)) { fs.appendFileSync(log, `${new Date().toISOString()} #${id} 담당 세션이 시작 중이라 새로 만들지 않음\n`); return null; }
      unregisterOwners(root, id);
      fs.appendFileSync(log, `${new Date().toISOString()} #${id} 담당을 정한 적 없는 옛 기록이라 걷어 내고 새로 만듦\n`);
    }
    const sid = crypto.randomUUID();
    const msg = newOwnerMessage(scanRoot, root, req, id, why === 'decision' ? decided || '결정' : '');
    registerOwner(root, sid, id);
    fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 담당 세션을 새로 만듦(${why === 'start' ? '시작' : '결정'})\n`);
    noteSessionStarted(scanRoot, id, sid);
    launch(root, scanRoot, id, sid, msg, [{ args: `--session-id ${sid} --name "${ownerName(root, id)}"`, prompt: '"$MSG"', kind: 'start' }]);
    return sid;
  } catch { return null; /* 시작·결정은 세션 만들기 실패와 상관없이 성공해야 한다 */ }
}

/** 닫힌 담당 세션을 깨운다. 오래 쉬어 캐시가 식었거나 대화 기록이 클 때만 먼저 압축하고, 그렇지 않으면 바로 결정된 일만 하라고 보낸다 */
export function resumeOwner(scanRoot: string, id: number, sid: string, decided: string, state: { idleMs: number; bytes: number }, stalled = false): void {
  const root = projectRoot(scanRoot);
  const req = loadRequests(scanRoot).find((r) => r.id === id);
  const src = path.relative(root, scanRoot) || '.';
  const head = stalled
    ? `[spec-view] ${brandOf(root).name} 요청 #${id}${req ? ` "${req.title}"` : ''}에 사용자가 결정(${decided})한 뒤 ${STALL_AFTER_MIN}분 넘게 다음 단계 기록이 없어 다시 알립니다. 구현·커밋을 마쳤다면 \`request impl\`·\`finish\`·\`request test\`까지 올리고 멈추세요. 막혔거나 사용자에게 물을 것이 있으면 아래 명령으로 남기세요.`
    : `[spec-view] ${brandOf(root).name} 요청 #${id}${req ? ` "${req.title}"` : ''}에 사용자가 결정했습니다(${decided}).`;
  const msg = `${head}${briefOf(req)}\n${stalled ? '' : `${THAT_JOB} `}${guideOf(id, src)} 더 알아야 하면 .spec/requests/${id}.json과 \`node ${SPEC_MJS} todo --src ${src}\`로 지금 할 일을 확인하세요.`;
  const why = state.idleMs >= CACHE_COLD_MS ? '1시간 넘게 쉬어 캐시가 식음' : state.bytes >= BIG_BYTES ? '대화 기록이 커서' : '';
  const steps: Step[] = [{ args: `--resume ${sid}`, prompt: '"$MSG"', kind: 'wake' }];
  if (why) steps.unshift({ args: `--resume ${sid}`, prompt: '"/compact"', kind: 'wake' });
  fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} ${sid} ${why ? `압축하고 지시함(${why})` : '압축 없이 바로 지시함'}\n`);
  launch(root, scanRoot, id, sid, msg, steps);
}

/** 서버가 1분마다 부른다: 시작했는데 담당 등록이 STALLED_MS 넘게 없고 세션 기록도 늘지 않는 요청을 한 번 다시 시작한다. 그래도 안 되면 진행 기록에 실패로 남겨 사용자가 알게 한다 */
export function retryStalledStarts(scanRoot: string): number[] {
  const done: number[] = [];
  try {
    const root = projectRoot(scanRoot);
    if (!readConfig(root).wake) return done;
    const all = JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')) as Record<string, { request: number; seen: string; starting?: string; retried?: boolean; failed?: boolean }>;
    const reqs = loadRequests(scanRoot);
    for (const [sid, v] of Object.entries(all)) {
      if (!v.starting || v.failed) continue;
      const req = reqs.find((r) => r.id === v.request);
      if (!req || req.agent.name || req.stage !== 'design') continue;
      const age = Date.now() - Date.parse(v.starting);
      let quiet = Infinity, exists = false;
      try { quiet = Date.now() - fs.statSync(transcriptOf(root, sid)).mtimeMs; exists = true; } catch { /* 기록이 없으면 아직 시작도 못 한 것 */ }
      if (age < STALLED_MS * (v.retried ? 2 : 1) || quiet < STALLED_MS) continue;
      const log = logFile(root);
      if (v.retried) {
        v.failed = true;
        noteSessionFailed(scanRoot, v.request, sid);
        fs.appendFileSync(log, `${new Date().toISOString()} #${v.request} ${sid} 다시 시작했는데도 담당 등록이 없어 실패로 남김\n`);
      } else {
        v.retried = true;
        const msg = newOwnerMessage(scanRoot, root, req, v.request, '');
        fs.appendFileSync(log, `${new Date().toISOString()} #${v.request} ${sid} 시작이 끝나지 않아 같은 세션으로 다시 시작함\n`);
        launch(root, scanRoot, v.request, sid, msg, [{ args: `${exists ? '--resume' : '--session-id'} ${sid} --name "${ownerName(root, v.request)}"`, prompt: '"$MSG"', kind: 'start' }]);
      }
      done.push(v.request);
    }
    if (done.length) fs.writeFileSync(sessionsFile(root), JSON.stringify(all, null, 2) + '\n');
  } catch { /* 점검이 실패해도 서버는 계속 돈다 */ }
  return done;
}
