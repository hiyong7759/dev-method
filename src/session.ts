/**
 * @spec owner-session 요청 담당 세션 만들기와 비용 기록
 * @why 요청을 시작하면 그 요청 하나만 맡는 세션이 있어야 설계를 쓰고 사용자 결정에 이어서 일할 수 있다. 사람이 세션을 따로 열지 않아도 되게 서버·명령이 세션을 새로 만들고, 만들거나 깨울 때마다 든 비용을 요청별로 남겨 얼마나 드는지 본다.
 * @contract 프로젝트 설정 `wake: true`일 때만 세션을 만든다(호출마다 비용이 들기 때문). 새 세션은 `claude -p 글 --session-id 새번호`로 만들고 .spec/sessions.json에 요청 번호와 함께 바로 적는다. 요청 하나에 담당이 이미 있으면 새로 만들지 않는다. claude는 결과를 JSON으로 받아(`--output-format json`) 토큰과 비용을 .spec/session-costs.json에 적는다. 도구 호출은 기다리지 않고 따로 떨어져 돌며(서버·명령이 먼저 끝나도 계속), 결과는 .spec/wake.log에 남긴다. 어떤 경우에도 시작·결정 자체를 실패시키지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { loadRequests, noteSessionStarted, STAGE_LABEL, STEP } from './request.js';
import { projectRoot, specDir } from './project.js';
import type { Request, SessionCost } from './types.js';

/** 사람 없이 쓸 수 있게 미리 허락하는 도구: 문서·소스 읽기와 고치기, 설계서 보기 명령, 검사, 그리고 그 일의 커밋. 위험한 git 명령은 저장소의 차단 훅이 막는다 */
export const ALLOWED = ['Read', 'Edit', 'Write', 'Bash(node:*)', 'Bash(npm:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)'];

/** 담당 세션이 모두 쓰는 모델(소넷 보통). 비용과 품질을 한 가지로 맞추려고 한 곳에서 정한다 */
const MODEL = 'sonnet';

/** 이만큼 쉬면 프롬프트 캐시가 식어 이어 부를 때 대화 전체를 비싸게 다시 읽는다. 이때만 압축해서 줄인다 */
const CACHE_COLD_MS = 60 * 60 * 1000;
/** 대화 기록이 이만큼 커도 압축한다(캐시가 따뜻해도 매 턴 읽는 양이 크다) */
const BIG_BYTES = 500 * 1024;

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
    `claude -p ${st.prompt} ${st.args} --model ${MODEL} --allowedTools ${allowed} --output-format json > "${base}-${i}.json" 2>> "$LOG"`,
    `rc=$?; echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) #${id} ${sid} ${st.kind === 'start' ? '시작' : '깨움'} 단계 ${i + 1}/${steps.length} 끝남 종료코드=$rc" >> "$LOG"`,
    `node "$SPEC" cost --src "$SRC" --id ${id} --sid ${sid} --kind ${st.kind} --file "${base}-${i}.json" >> "$LOG" 2>&1`,
  ].join('; '));
  // 세션을 부르는 일은 한 번에 하나씩 차례로 한다. 앞 호출이 데운 캐시를 다음 호출이 쓰게 해 비용을 아낀다(잠금은 30분이 지나면 낡은 것으로 보고 푼다)
  const lock = `LOCK="$ROOT/.spec/wake-out/lock"; until mkdir "$LOCK" 2>/dev/null; do if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; fi; sleep 1; done; trap 'rmdir "$LOCK" 2>/dev/null' EXIT`;
  spawn('sh', ['-c', `${lock}; ${lines.join('; ')}`], {
    cwd: root, detached: true, stdio: 'ignore',
    env: { ...process.env, MSG: msg, SPEC: SPEC_MJS, SRC: src, LOG: logFile(root), ROOT: root },
  }).unref();
}

/** 요청 내용을 글에 직접 넣는다. 세션이 요청 파일을 읽느라 쓰는 턴(턴마다 기본 맥락을 다시 읽어 비용이 든다)을 없앤다 */
function briefOf(req: Request | undefined): string {
  if (!req) return '';
  const events = req.events.slice(-4).map((e) => `- ${e.at.slice(5, 16).replace('T', ' ')} ${e.by === 'user' ? '사용자' : '에이전트'}: ${e.note}${e.quote ? ` (사용자가 한 말: "${e.quote}")` : ''}`).join('\n');
  return `\n[요청 내용 — 아래에 넣었으니 요청 파일을 따로 읽지 않아도 됩니다]\n원문: ${req.origin.text.slice(0, 600)}\n상태: ${STAGE_LABEL[req.stage]} · ${STEP[`${req.stage}:${req.step}`]?.label ?? req.step}\n최근 기록:\n${events}\n`;
}

/** 설계 파일 모양(세션이 규칙 문서를 찾아 읽지 않아도 되게 줄여서 넣는다) */
const DESIGN_SHAPE = '설계 파일(JSON) 모양: understanding(짧은 한 줄 요약), points[{area 영역, title 바뀌는 것, text 설명}], changes[{info, kind add|remove|change|link, field, note}], screens[{screen, after 시안 그림, note, counts, highlights, isNew}]. 이미 있는 화면은 먼저 `request shot --id 번호 --screen 화면 --url 운영 화면 주소`로 현행을 찍어 둔다(손으로 올린 그림은 경고가 붙는다). 설계서 보기에 없는 새 화면은 isNew: true. 정보도 화면도 안 바뀌면 `request design --id 번호 --none true`. "이렇게 처리하겠습니다"(approach)는 설계 없음에서 항목이 하나뿐인 짧은 설명에만 쓰고, 항목이 둘 이상이면 설계 없음이어도 points 표로 적는다.';

/** 새 담당 세션이 받는 글: 담당 등록 → 설계 올리고 승인 대기에서 멈춤. 사용자가 이미 결정한 상태(decided)면 그 일만 하게 한다 */
function newOwnerMessage(scanRoot: string, root: string, req: Request | undefined, id: number, decided: string): string {
  const src = path.relative(root, scanRoot) || '.';
  const intro = `[요청 #${id} 담당] 당신은 요청 #${id} "${req?.title ?? ''}"의 담당 세션입니다. 이 요청 하나만 합니다.`;
  const register = `\`node ${SPEC_MJS} request agent --id ${id} --name "요청 #${id} 담당" --src ${src}\`로 담당을 등록하세요.`;
  if (decided) return `${intro} 사용자가 결정했습니다(${decided}). ${register}${briefOf(req)}\n사용자가 결정한 그 일만 하고 끝나면 멈추세요. 다른 일을 시작하지 마세요. 더 알아야 하면 .spec/requests/${id}.json을 읽으세요.`;
  return `${intro} 1) ${register} 2) 아래 요청 내용을 읽고 설계를 써서 \`request design --id ${id}\`로 올린 뒤(화면이 바뀌면 현행·시안 그림과 함께) 사용자 승인 대기에서 멈추세요. 승인 전에는 구현하지 않고, 다른 요청은 건드리지 않습니다.${briefOf(req)}\n${DESIGN_SHAPE} 더 알아야 하면 \`node ${SPEC_MJS} todo --src ${src}\`나 .spec/requests/${id}.json을 읽으세요.`;
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
      unregisterOwners(root, id);
      fs.appendFileSync(log, `${new Date().toISOString()} #${id} 담당을 정한 적 없는 옛 기록이라 걷어 내고 새로 만듦\n`);
    }
    const sid = crypto.randomUUID();
    const msg = newOwnerMessage(scanRoot, root, req, id, why === 'decision' ? decided || '결정' : '');
    registerOwner(root, sid, id);
    fs.appendFileSync(log, `${new Date().toISOString()} #${id} ${sid} 담당 세션을 새로 만듦(${why === 'start' ? '시작' : '결정'})\n`);
    noteSessionStarted(scanRoot, id, sid);
    launch(root, scanRoot, id, sid, msg, [{ args: `--session-id ${sid} --name "요청 #${id} 담당"`, prompt: '"$MSG"', kind: 'start' }]);
    return sid;
  } catch { return null; /* 시작·결정은 세션 만들기 실패와 상관없이 성공해야 한다 */ }
}

/** 닫힌 담당 세션을 깨운다. 오래 쉬어 캐시가 식었거나 대화 기록이 클 때만 먼저 압축하고, 그렇지 않으면 바로 결정된 일만 하라고 보낸다 */
export function resumeOwner(scanRoot: string, id: number, sid: string, decided: string, state: { idleMs: number; bytes: number }): void {
  const root = projectRoot(scanRoot);
  const req = loadRequests(scanRoot).find((r) => r.id === id);
  const src = path.relative(root, scanRoot) || '.';
  const msg = `[spec-view] 요청 #${id}${req ? ` "${req.title}"` : ''}에 사용자가 결정했습니다(${decided}).${briefOf(req)}\n사용자가 결정한 그 일만 하고, 끝나면 멈추세요. 다른 일을 시작하지 마세요. 더 알아야 하면 .spec/requests/${id}.json과 \`node ${SPEC_MJS} todo --src ${src}\`로 지금 할 일을 확인하세요.`;
  const why = state.idleMs >= CACHE_COLD_MS ? '1시간 넘게 쉬어 캐시가 식음' : state.bytes >= BIG_BYTES ? '대화 기록이 커서' : '';
  const steps: Step[] = [{ args: `--resume ${sid}`, prompt: '"$MSG"', kind: 'wake' }];
  if (why) steps.unshift({ args: `--resume ${sid}`, prompt: '"/compact"', kind: 'wake' });
  fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} ${sid} ${why ? `압축하고 지시함(${why})` : '압축 없이 바로 지시함'}\n`);
  launch(root, scanRoot, id, sid, msg, steps);
}
