/**
 * @spec outbox 담당 세션에 보낼 글 상자(메신저가 가져가 보낸다)
 * @why 결정·시작을 담당 세션에 알리는 일을 서버가 헤드리스(claude -p)로 하면 열려 있는 세션 창에는 사용자 메시지처럼 들어가지 않고 따로 도는 복사본이 생겨 결정이 사라진다. 그래서 서버는 보낼 글과 받을 세션만 이 상자에 적고, 작은 모델의 메신저 세션이 SendMessage로 열린 창에 보낸다. 서버는 어떤 프로세스도 띄우지 않는다.
 * @contract 상자는 이 컴퓨터에만 두는 .spec/outbox.json(줄 목록)이고 글 본문은 .spec/outbox-text/<줄 번호>.txt에 둔다. 줄 하나 = 요청 하나의 마지막 결정(또는 시작) 한 건이며, 같은 요청의 대기 중인 옛 줄은 새 줄이 대신한다. 상태는 pending(대기)·sent(보냄)·failed(못 보냄, 이유 있음)이다. 설정 `wake: true`일 때만 줄을 적는다(꺼져 있으면 전달 기록만 열어 두고, 열린 세션에는 inbox 훅이 알린다). 완료·취소된 요청의 결정은 줄을 만들지 않는다. 담당이 없으면 session.ts가 새 번호를 정하고, 메신저는 ① 열린 창이면 SendMessage ② 아니고 대화가 있으면 `claude --bg --resume` ③ 대화가 없으면 `claude --bg --session-id` 순서로 시도한다. 어느 길도 안 되면 헤드리스로 넘어가지 않고 이유와 함께 failed로 남기며(화면에 '전달 안 됨 · 이유'), 사용자가 다시 보내기를 누르면 대기로 돌아간다. 메신저는 `request outbox wait`로 줄이 생길 때까지 토큰 없이 기다리고, `show`로 한 줄을 받아, `done`·`fail`로 결과를 적는다. 적기가 실패해도 사용자 결정은 그대로 성공한다. `claude --bg`는 미리 정한 세션 번호를 쓰지 않고 자기 번호를 붙이므로 launchRow가 만든 뒤 실제 번호로 담당 기록(rebindOwner)과 줄을 바꾼다. 메신저가 꺼져 있으면 줄이 영영 대기에 머무르므로 서버(serve.ts)가 ensureMessenger로 메신저를 살려 둔다(없으면 `claude --bg`로 띄우고, 쉬는 중인데 대기 줄이 있으면 `--resume`으로 깨운다). 서버가 claude를 실행하는 곳은 이 메신저 기동과 읽기 전용 `claude agents --json`뿐이고, 담당 세션에 글을 보내는 launchRow는 메신저(`outbox launch`)만 부른다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { readConfig } from './config.js';
import { isStart, lastDecision, markDelivered, markRequeued, markUndelivered, openDelivery } from './delivery.js';
import type { Via } from './delivery.js';
import { loadRequests } from './request.js';
import { brandOf } from './brand.js';
import { launchArgs, logFile, newOwnerMessage, decisionMessage, ownerName, ownersOf, prepareOwner, rebindOwner, SPEC_MJS, transcriptOf } from './session.js';
import { projectRoot, specDir } from './project.js';
import type { Request } from './types.js';

/** 상자의 한 줄 */
export interface OutboxRow {
  /** 줄 번호(늘어나기만 한다) */
  seq: number;
  /** 어느 요청의 일인지 */
  request: number;
  /** 시작 글인지 결정 글인지 */
  kind: 'start' | 'decision';
  /** 받을 담당 세션 번호 */
  session: string;
  /** 담당 이름(참고용). 열린 창의 이름은 세션마다 따로 붙으므로 보낼 때 세션 번호로 다시 찾는다(openNameOf) */
  to: string;
  /** 적은 시각 */
  at: string;
  /** 메신저가 어디까지 했나: 대기(아직 안 가져감)·보냄·못 보냄 */
  state: 'pending' | 'sent' | 'failed';
  /** failed일 때 이유 */
  reason?: string;
  /** 보낸 길 */
  via?: Via;
}

const file = (scanRoot: string): string => path.join(specDir(scanRoot), 'outbox.json');
const textFile = (scanRoot: string, seq: number): string => path.join(specDir(scanRoot), 'outbox-text', `${seq}.txt`);

/** 상자 전체 */
export function loadOutbox(scanRoot: string): OutboxRow[] {
  try { return JSON.parse(fs.readFileSync(file(scanRoot), 'utf8')) as OutboxRow[]; } catch { return []; }
}
function save(scanRoot: string, rows: OutboxRow[]): void {
  fs.mkdirSync(specDir(scanRoot), { recursive: true });
  fs.writeFileSync(file(scanRoot), JSON.stringify(rows, null, 2) + '\n');
}

/** 대기 중인 줄들 */
export const pendingRows = (scanRoot: string): OutboxRow[] => loadOutbox(scanRoot).filter((r) => r.state === 'pending');

/** 요청의 마지막 결정(또는 시작)을 상자에 적는다. 적은 줄을 돌려준다(꺼져 있거나 보낼 것이 없거나 실패하면 null). 전달 기록은 늘 먼저 연다 */
export function enqueueOutbox(scanRoot: string, id: number, kind?: OutboxRow['kind']): OutboxRow | null {
  try {
    const root = projectRoot(scanRoot);
    const req = loadRequests(scanRoot).find((r) => r.id === id);
    openDelivery(scanRoot, req);
    if (!req || !readConfig(root).wake) return null;
    // 완료·취소된 요청은 더 할 일이 없으니 보내지 않는다
    if (req.stage === 'done' || req.stage === 'cancelled') return null;
    const k = kind ?? (isStart(req) ? 'start' : 'decision');
    // 이미 담당을 등록해 일하는 중이면 시작 글은 읽은 것이라 보낼 일이 없다
    if (k === 'start' && req.agent.name && ownersOf(root, id).length) return null;
    const { sid } = prepareOwner(scanRoot, id);
    // 글에 적는 결정은 가장 최근 기록이다(순서 정하기처럼 결정 기록은 아니지만 알릴 일도 같은 길로 간다)
    const decided = req.events[req.events.length - 1]?.note ?? '결정';
    const text = k === 'start' ? newOwnerMessage(scanRoot, root, req, id, '') : decisionMessage(scanRoot, id, decided);
    const rows = loadOutbox(scanRoot).filter((r) => !(r.request === id && r.state === 'pending'));
    const seq = Math.max(0, ...loadOutbox(scanRoot).map((r) => r.seq)) + 1;
    const row: OutboxRow = { seq, request: id, kind: k, session: sid, to: req.agent.name || ownerName(root, id), at: new Date().toISOString(), state: 'pending' };
    fs.mkdirSync(path.dirname(textFile(scanRoot, seq)), { recursive: true });
    fs.writeFileSync(textFile(scanRoot, seq), text);
    save(scanRoot, [...rows, row]);
    fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} ${sid} 상자에 적음(줄 ${seq}, ${k === 'start' ? '시작' : '결정'}) — 메신저가 보낸다\n`);
    try { afterEnqueue?.(); } catch { /* 메신저 확인이 실패해도 줄은 적혔다 */ }
    return row;
  } catch { return null; /* 사용자 결정은 상자에 못 적어도 성공해야 한다 */ }
}

/** 다시 보내기: 마지막 줄을 대기로 돌린다(줄이 없으면 마지막 결정으로 새로 적는다). 돌린 줄을 돌려준다 */
export function requeueOutbox(scanRoot: string, id: number): OutboxRow | null {
  try {
    const rows = loadOutbox(scanRoot);
    const last = [...rows].reverse().find((r) => r.request === id);
    const req = loadRequests(scanRoot).find((r) => r.id === id) as Request | undefined;
    if (!last || !req || (lastDecision(req) && (last.kind === 'start') !== isStart(req))) return enqueueOutbox(scanRoot, id);
    markRequeued(scanRoot, id);
    last.state = 'pending'; delete last.reason; delete last.via;
    save(scanRoot, rows);
    return last;
  } catch { return null; }
}

/** 메신저가 보냈다고 알린다 */
export function doneRow(scanRoot: string, seq: number, via: Via): OutboxRow {
  const rows = loadOutbox(scanRoot), row = rows.find((r) => r.seq === seq);
  if (!row) throw new Error(`상자에 줄 ${seq}이 없다`);
  row.state = 'sent'; row.via = via; delete row.reason;
  save(scanRoot, rows);
  markDelivered(scanRoot, row.request, via);
  return row;
}

/** 메신저가 못 보냈다고 이유와 함께 알린다 */
export function failRow(scanRoot: string, seq: number, reason: string): OutboxRow {
  const rows = loadOutbox(scanRoot), row = rows.find((r) => r.seq === seq);
  if (!row) throw new Error(`상자에 줄 ${seq}이 없다`);
  row.state = 'failed'; row.reason = reason;
  save(scanRoot, rows);
  markUndelivered(scanRoot, row.request, reason);
  return row;
}

/** 셸에 그대로 쓸 수 있게 작은따옴표로 싼다 */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** `claude agents --json`이 알려 주는 지금 살아 있는 세션 한 건(읽기만 하는 조회) */
interface AgentInfo { id?: string; sessionId?: string; name?: string; kind?: string; status?: string; startedAt?: number }
/** 지금 살아 있는 세션 목록. 알 수 없으면 null(없다는 뜻이 아니다) */
function agentsList(): AgentInfo[] | null {
  try {
    const run = spawnSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 15000 });
    return run.status === 0 ? (JSON.parse(run.stdout) as AgentInfo[]) : null;
  } catch { return null; }
}

/** 이 세션이 지금 열려 있다면 SendMessage가 알아듣는 이름. 열려 있지 않거나 알 수 없으면 null */
export function openNameOf(sid: string): string | null {
  return agentsList()?.find((a) => a.sessionId === sid)?.name ?? null;
}

/** 메신저가 한 줄을 보낼 때 필요한 것: 받을 이름(열린 창이면 그 이름, 아니면 null), 글 파일, 열린 창이 안 될 때 쓸 `claude --bg` 명령(대화가 있으면 이어 띄우고 없으면 새로 만든다) */
export function showRow(scanRoot: string, seq: number): { row: OutboxRow; textFile: string; conversationExists: boolean; sendTo: string | null; bgCommand: string; bgVia: Via } {
  const row = loadOutbox(scanRoot).find((r) => r.seq === seq);
  if (!row) throw new Error(`상자에 줄 ${seq}이 없다`);
  const root = projectRoot(scanRoot);
  const tf = textFile(scanRoot, seq);
  let exists = false;
  try { fs.statSync(transcriptOf(root, row.session)); exists = true; } catch { /* 대화가 아직 없음 */ }
  const base = exists ? `claude --bg --resume ${row.session}` : `claude --bg --session-id ${row.session} --name ${q(ownerName(root, row.request))}`;
  const bgCommand = `${base} ${launchArgs().map(q).join(' ')} "$(cat ${q(tf)})"`;
  return { row, textFile: tf, conversationExists: exists, sendTo: openNameOf(row.session), bgCommand, bgVia: exists ? 'bg-resume' : 'bg-new' };
}

/** 메신저가 `outbox launch`로 부른다(서버는 부르지 않는다): 열린 창이 아닌 담당에게 `claude --bg`로 글을 보낸다. 대화가 있으면 이어 띄우고 없으면 새로 만든다. 셸을 거치지 않고 인자로 직접 실행하므로 메신저의 허용 목록(node 입구 파일만)으로 된다. 결과는 줄에 기록한다 */
export function launchRow(scanRoot: string, seq: number): OutboxRow {
  const { row, textFile: tf, conversationExists, bgVia } = showRow(scanRoot, seq);
  const root = projectRoot(scanRoot);
  const head = conversationExists ? ['--bg', '--resume', row.session] : ['--bg', '--session-id', row.session, '--name', ownerName(root, row.request)];
  // 백그라운드로 만든 세션(~/.claude/jobs에 기록이 있음)은 허용 도구 등 옵션을 이미 저장하고 있다. `--resume`에 옵션을 또 붙이면 이어받지 않고 복사본이 생기므로 옵션 없이 부른다. 그 밖의 세션(열어 두었다 닫은 세션)과 새 세션에는 옵션을 건다
  const savedJob = conversationExists && fs.existsSync(path.join(os.homedir(), '.claude', 'jobs', row.session.slice(0, 8)));
  const startedAt = Date.now();
  const run = spawnSync('claude', [...head, ...(savedJob ? [] : launchArgs()), fs.readFileSync(tf, 'utf8')], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${row.request} ${row.session} claude --bg ${conversationExists ? '--resume' : '--session-id'} 종료코드=${run.status}\n`);
  // claude --bg는 미리 정한 번호를 쓰지 않고 자기 번호를 붙인다. 출력의 짧은 번호로 실제 번호를 찾아 담당 기록과 줄을 맞춘다
  const short = /backgrounded\s*·\s*([0-9a-f]+)/.exec(`${run.stdout ?? ''}\n${run.stderr ?? ''}`)?.[1];
  // 방금 만든 세션은 목록에 바로 안 나올 수 있어 나타날 때까지 최대 10초 다시 본다
  // 출력에서 번호를 못 읽는 경우(메신저 안에서 돌릴 때가 그렇다)에는 담당 이름이고 이 호출 뒤에 시작한 백그라운드 세션을 찾는다
  let real: string | undefined;
  for (let i = 0; run.status === 0 && !real && i < 20; i++) {
    if (i) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    const list = agentsList() ?? [];
    real = short ? list.find((a) => a.id === short || a.sessionId?.startsWith(short))?.sessionId
      : list.filter((a) => a.kind === 'background' && a.name === ownerName(root, row.request) && (a.startedAt ?? 0) >= startedAt - 2000).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]?.sessionId;
  }
  if (run.status === 0) fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${row.request} claude --bg 출력 번호=${short ?? '못 읽음'} 실제 세션=${real ?? '목록에 없음'}\n`);
  if (real && real !== row.session) {
    rebindOwner(root, row.session, real);
    save(scanRoot, loadOutbox(scanRoot).map((r) => (r.session === row.session ? { ...r, session: real } : r)));
  }
  return run.status === 0 ? doneRow(scanRoot, seq, bgVia) : failRow(scanRoot, seq, `claude --bg 실패(종료코드 ${run.status}): ${(run.stderr || run.stdout || run.error?.message || '').trim().slice(0, 200)}`);
}

/** 메신저 세션의 이름. 프로젝트 이름을 앞에 붙여 여러 프로젝트를 함께 써도 헷갈리지 않게 한다 */
export const messengerName = (root: string): string => `${brandOf(root).name} 메신저`;

/** 이 안에 다시 확인하지 않는다(줄을 연달아 적어도 claude를 연달아 부르지 않게) */
const ENSURE_GAP_MS = 30_000;
let lastEnsure = 0;
/** 메신저 대화 기록이 이만큼 커지면 갈아 끼운다 */
const MESSENGER_MAX_BYTES = 400 * 1024;

/** 메신저가 살아 있게 한다(서버가 서버 시작·1분 점검·줄을 적은 직후에 부른다). 담당 세션에 글을 보내는 일이 아니라 메신저를 켜는 일이다. 메신저가 없으면 `claude --bg`로 띄우고, 쉬는 중인데 대기 줄이 있으면 `--resume`으로 깨우며, 일하는 중이거나 권한 확인 중이면 건드리지 않는다. 설정 wake가 꺼져 있거나 테스트용 서버면 아무것도 안 한다. 어떤 경우에도 던지지 않고 한 일을 돌려준다 */
export function ensureMessenger(scanRoot: string, now = Date.now()): 'started' | 'resumed' | 'recycled' | 'ok' | 'skipped' {
  try {
    const root = projectRoot(scanRoot);
    if (process.env.SPEC_TEST_DIR || !readConfig(root).wake || now - lastEnsure < ENSURE_GAP_MS) return 'skipped';
    lastEnsure = now;
    const list = agentsList();
    if (!list) { fs.appendFileSync(logFile(root), `${new Date().toISOString()} 메신저 확인 실패(claude agents --json을 못 읽음)\n`); return 'skipped'; }
    const name = messengerName(root);
    const mine = list.find((a) => a.name === name && a.kind === 'background');
    const src = path.relative(root, scanRoot) || '.';
    const first = `${SPEC_MJS.replace(/spec\.mjs$/, 'messenger.md')}를 읽고 그대로 따르세요. SPEC=${SPEC_MJS} (이 절대경로를 그대로 쓰세요), SRC=${src}, 작업 폴더 ${root}.`;
    const run = (args: string[]): void => { spawn('claude', args, { cwd: root, detached: true, stdio: 'ignore' }).unref(); };
    if (!mine) {
      run(['--bg', '--name', name, '--model', 'haiku', '--allowedTools', 'Read', `Bash(node ${SPEC_MJS}:*)`, 'Monitor', 'SendMessage', 'ToolSearch', '--', first]);
      fs.appendFileSync(logFile(root), `${new Date().toISOString()} 메신저가 없어 claude --bg로 띄움(${name})\n`);
      return 'started';
    }
    // 쉬는 중이고 가져갈 줄이 없는데 대화 기록이 너무 커졌으면 멈추고 새로 띄운다(모델은 /compact를 스스로 못 하므로, 컨텍스트가 커지지 않게 이렇게 갈아 끼운다)
    if (mine.status === 'idle' && mine.sessionId && !pendingRows(scanRoot).length) {
      let bytes = 0;
      try { bytes = fs.statSync(transcriptOf(root, mine.sessionId)).size; } catch { /* 기록이 없으면 작은 것 */ }
      if (bytes >= MESSENGER_MAX_BYTES && mine.id) {
        run(['stop', mine.id]);
        fs.appendFileSync(logFile(root), `${new Date().toISOString()} 메신저 대화 기록이 ${Math.round(bytes / 1024)}KB라 멈추고 새로 띄움\n`);
        setTimeout(() => { lastEnsure = 0; ensureMessenger(scanRoot, Date.now() + ENSURE_GAP_MS); }, 3000).unref();
        return 'recycled';
      }
    }
    // 쉬는 중(idle)이고 가져갈 줄이 있으면 깨운다. 일하는 중(busy)이거나 권한 확인 중(waiting)이면 건드리지 않는다
    if (mine.status === 'idle' && pendingRows(scanRoot).length && mine.sessionId) {
      run(['--bg', '--resume', mine.sessionId, `대기 줄이 있습니다. messenger.md대로 이어서 처리하세요. SPEC=${SPEC_MJS}, SRC=${src}`]);
      fs.appendFileSync(logFile(root), `${new Date().toISOString()} 메신저가 쉬는 중인데 대기 줄이 있어 claude --bg --resume으로 깨움\n`);
      return 'resumed';
    }
    return 'ok';
  } catch { return 'skipped'; }
}

/** 줄을 적은 직후 서버가 할 일을 꽂는 자리(serve.ts가 ensureMessenger를 건다). 시험에서는 비어 있다 */
let afterEnqueue: (() => void) | null = null;
export function setAfterEnqueue(fn: (() => void) | null): void { afterEnqueue = fn; }

/** 대기 줄이 생길 때까지(최대 timeoutMs) 기다렸다가 대기 줄 번호들을 돌려준다. 기다리는 동안 토큰을 쓰지 않는다(메신저가 Monitor로 부른다) */
export async function waitPending(scanRoot: string, timeoutMs = 10 * 60_000): Promise<number[]> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const now = pendingRows(scanRoot).map((r) => r.seq);
    if (now.length || Date.now() >= end) return now;
    await new Promise((ok) => setTimeout(ok, 2000));
  }
}
