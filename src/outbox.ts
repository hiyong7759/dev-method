/**
 * @spec outbox 담당 세션에 보낼 글 상자(메신저가 가져가 보낸다)
 * @why 결정·시작을 담당 세션에 알리는 일을 서버가 헤드리스(claude -p)로 하면 열려 있는 세션 창에는 사용자 메시지처럼 들어가지 않고 따로 도는 복사본이 생겨 결정이 사라진다. 그래서 서버는 보낼 글과 받을 세션만 이 상자에 적고, 작은 모델의 메신저 세션이 SendMessage로 열린 창에 보낸다. 서버는 어떤 프로세스도 띄우지 않는다.
 * @contract 상자는 이 컴퓨터에만 두는 .spec/outbox.json(줄 목록)이고 글 본문은 .spec/outbox-text/<줄 번호>.txt에 둔다. 읽고 고쳐 쓰는 구간은 잠금(.spec/locks/outbox-file)으로 한 번에 하나만 한다. 줄 하나 = 요청 하나의 마지막 결정(또는 시작) 한 건이며, 같은 요청의 대기 중인 옛 줄은 새 줄이 대신한다. 상태는 pending(대기)·taking(메신저가 가져감)·sent(보냄)·failed(못 보냄, 이유 있음)이다. 줄을 적으면 ready: false이고, 서버가 담당을 확인(ownerUp)해 돌고 있으면 ready: true로 바꾼 뒤에야 메신저가 가져갈 수 있다. 담당이 안 떠 있으면 서버가 ownerUp 한 곳에서 요청당 잠금 아래 `claude --bg`로 띄워 대기 줄의 글을 처음 글로 넘기고 줄을 보냄으로 적는다(메신저는 담당을 띄우지 않는다). 메신저는 `outbox take`로 줄을 가져간다: 줄당 잠금 파일을 먼저 만든 한 쪽만 성공하고, 가져간 동안 `outbox beat`로 살아 있다고 표시하며, 90초 넘게 표시가 없으면 대기로 돌아간다. 설정 `wake: true`일 때만 줄을 적는다(꺼져 있으면 전달 기록만 열어 두고, 열린 세션에는 inbox 훅이 알린다). 완료·취소된 요청의 결정은 줄을 만들지 않는다. 담당이 없으면 session.ts가 새 번호를 정한다. 어느 길도 안 되면 헤드리스로 넘어가지 않고 이유와 함께 failed로 남기며(화면에 '전달 안 됨 · 이유'), 사용자가 다시 보내기를 누르면 대기로 돌아간다. `claude --bg`는 미리 정한 세션 번호를 쓰지 않고 자기 번호를 붙이므로, 띄우는 동안 담당 기록에 '맞추는 중'을 적고 ownerUp이 만든 뒤 실제 번호로 담당 기록(rebindOwner)과 줄을 바꾼다. 메신저가 꺼져 있으면 줄이 영영 대기에 머무르므로 서버(serve.ts)가 ensureMessenger로 메신저를 살려 둔다(없으면 잠금 아래 `claude --bg`로 띄우고 60초는 띄우는 중으로 본다. 쉬는 중인데 가져갈 줄이 있으면 `--resume`으로 깨운다). 서버가 claude를 실행하는 곳은 메신저 기동·담당 띄우기(ownerUp)·읽기 전용 `claude agents --json`뿐이고(멈춤은 reconcile.ts), 담당을 띄우는 길은 ownerUp 하나뿐이다.
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
import { launchArgs, loadOwners, logFile, markRebinding, newOwnerMessage, decisionMessage, ownerName, ownersOf, prepareOwner, rebindOwner, reviewerArgs, SPEC_MJS, transcriptOf } from './session.js';
import { beat, newHolder, tryLock, unlock, withLock } from './lock.js';
import { projectRoot, specDir } from './project.js';
import { nextChange } from './watch.js';
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
  /** 담당 이름(참고용). 열린 창의 이름은 세션마다 따로 붙으므로 보낼 때 세션 번호로 다시 찾는다(runningOwner) */
  to: string;
  /** 적은 시각 */
  at: string;
  /** 메신저가 어디까지 했나: 대기(아직 안 가져감)·보냄·못 보냄 */
  state: 'pending' | 'taking' | 'sent' | 'failed';
  /** 서버(도구)가 받을 담당이 돌고 있음을 확인했나. false면 메신저가 가져가지 못한다(담당 띄우기는 서버가 한다). 없으면(옛 줄) 확인된 것으로 본다 */
  ready?: boolean;
  /** state가 taking일 때 가져간 메신저 세션 번호 */
  takenBy?: string;
  /** 가져간 메신저가 마지막으로 "살아 있다"고 표시한 시각 */
  beatAt?: string;
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
/** 상자를 잠근 채 읽고 고쳐 쓴다(두 프로세스가 서로의 변경을 덮어쓰지 않게). fn이 돌려준 값을 그대로 돌려준다 */
function mutate<T>(scanRoot: string, fn: (rows: OutboxRow[]) => T): T {
  const out = withLock(scanRoot, 'outbox-file', () => { const rows = loadOutbox(scanRoot); const r = fn(rows); save(scanRoot, rows); return { r }; }, { staleMs: 10_000, waitMs: 5000 });
  if (!out) throw new Error('상자를 잠그지 못했다(다른 쪽이 쓰는 중)');
  return out.r;
}

/** 가져간 메신저가 이 안에 "살아 있다" 표시를 안 하면 죽은 것으로 보고 줄을 대기로 돌린다 */
export const TAKE_BEAT_MS = 90_000;
/** 가져간 줄 중 표시가 끊긴 것을 대기로 돌린다(돌린 줄 수를 돌려준다) */
export function releaseStale(scanRoot: string, now = Date.now()): number {
  try {
    if (!loadOutbox(scanRoot).some((r) => r.state === 'taking' && now - Date.parse(r.beatAt ?? r.at) > TAKE_BEAT_MS)) return 0;
    return mutate(scanRoot, (rows) => {
      let n = 0;
      for (const r of rows) if (r.state === 'taking' && now - Date.parse(r.beatAt ?? r.at) > TAKE_BEAT_MS) { r.state = 'pending'; delete r.takenBy; delete r.beatAt; n++; }
      return n;
    });
  } catch { return 0; }
}

/** 메신저가 가져갈 수 있는 줄들: 대기이고 받을 담당이 돌고 있음을 서버가 확인한 것 */
export const pendingRows = (scanRoot: string): OutboxRow[] => { releaseStale(scanRoot); return loadOutbox(scanRoot).filter((r) => r.state === 'pending' && r.ready !== false); };

/** 줄 하나를 가져간다. 줄당 잠금 파일을 먼저 만든 한 쪽만 성공하고, 늦은 쪽·이미 가져간 줄·받는 담당이 아직 확인 안 된 줄은 이유와 함께 실패한다 */
export function takeRow(scanRoot: string, seq: number, by: string): { ok: boolean; reason?: string } {
  releaseStale(scanRoot);
  if (!tryLock(scanRoot, `take-${seq}`, TAKE_BEAT_MS, by)) return { ok: false, reason: '이미 다른 메신저가 가져갔다' };
  try {
    const got = mutate(scanRoot, (rows) => {
      const row = rows.find((r) => r.seq === seq);
      if (!row) return '상자에 그 줄이 없다';
      if (row.state !== 'pending') return `이미 ${row.state === 'taking' ? '가져간' : row.state === 'sent' ? '보낸' : '처리한'} 줄이다`;
      if (row.ready === false) return '받을 담당이 아직 확인되지 않았다(서버가 담당을 확인하는 중)';
      row.state = 'taking'; row.takenBy = by; row.beatAt = new Date().toISOString();
      return null;
    });
    if (got) { unlock(scanRoot, `take-${seq}`); return { ok: false, reason: got }; }
    return { ok: true };
  } catch (e) { unlock(scanRoot, `take-${seq}`); return { ok: false, reason: (e as Error).message }; }
}

/** 가져간 메신저가 "살아 있다"를 표시한다(주기적으로 부른다). 내가 가져간 줄이 아니면 false */
export function beatRow(scanRoot: string, seq: number, by: string): boolean {
  try {
    const ok = mutate(scanRoot, (rows) => { const row = rows.find((r) => r.seq === seq); if (!row || row.state !== 'taking' || row.takenBy !== by) return false; row.beatAt = new Date().toISOString(); return true; });
    if (ok) beat(scanRoot, `take-${seq}`);
    return ok;
  } catch { return false; }
}

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
    // 받을 담당이 돌고 있는지는 서버(ownerUp)가 확인한다. 확인 전(ready: false)에는 메신저가 가져가지 못한다
    const row = mutate(scanRoot, (rows) => {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].request === id && rows[i].state === 'pending') rows.splice(i, 1);
      const seq = Math.max(0, ...rows.map((r) => r.seq)) + 1;
      const made: OutboxRow = { seq, request: id, kind: k, session: sid, to: req.agent.name || ownerName(root, id), at: new Date().toISOString(), state: 'pending', ready: false };
      fs.mkdirSync(path.dirname(textFile(scanRoot, seq)), { recursive: true });
      fs.writeFileSync(textFile(scanRoot, seq), text);
      rows.push(made);
      return made;
    });
    fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} ${sid} 상자에 적음(줄 ${row.seq}, ${k === 'start' ? '시작' : '결정'}) — 서버가 담당을 확인한 뒤 메신저가 보낸다\n`);
    kickOwnerUp(scanRoot, id);
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
    unlock(scanRoot, `take-${last.seq}`);
    const again = mutate(scanRoot, (all) => { const row = all.find((r) => r.seq === last.seq); if (!row) return null; row.state = 'pending'; row.ready = false; delete row.reason; delete row.via; delete row.takenBy; delete row.beatAt; return row; });
    if (again) kickOwnerUp(scanRoot, id);
    return again;
  } catch { return null; }
}

/** 메신저가 보냈다고 알린다 */
export function doneRow(scanRoot: string, seq: number, via: Via): OutboxRow {
  const row = mutate(scanRoot, (rows) => {
    const r = rows.find((x) => x.seq === seq);
    if (!r) throw new Error(`상자에 줄 ${seq}이 없다`);
    r.state = 'sent'; r.via = via; delete r.reason; delete r.takenBy; delete r.beatAt;
    return { ...r };
  });
  unlock(scanRoot, `take-${seq}`);
  markDelivered(scanRoot, row.request, via);
  return row;
}

/** 메신저가 못 보냈다고 이유와 함께 알린다 */
export function failRow(scanRoot: string, seq: number, reason: string): OutboxRow {
  const row = mutate(scanRoot, (rows) => {
    const r = rows.find((x) => x.seq === seq);
    if (!r) throw new Error(`상자에 줄 ${seq}이 없다`);
    r.state = 'failed'; r.reason = reason; delete r.takenBy; delete r.beatAt;
    return { ...r };
  });
  unlock(scanRoot, `take-${seq}`);
  markUndelivered(scanRoot, row.request, reason);
  return row;
}


/** `claude agents --json`이 알려 주는 지금 살아 있는 세션 한 건(읽기만 하는 조회) */
export interface AgentInfo {
  /** 짧은 세션 번호 */
  id?: string;
  /** 전체 세션 번호(담당 기록과 맞춘다) */
  sessionId?: string;
  /** 세션 이름(SendMessage가 알아듣는 이름) */
  name?: string;
  /** 세션 종류 */
  kind?: string;
  /** 일하는 중·쉬는 중·권한 확인 중 같은 상태 */
  status?: string;
  /** 시작한 때(ms) */
  startedAt?: number;
}
/** 지금 살아 있는 세션 목록. 알 수 없으면 null(없다는 뜻이 아니다) */
export function agentsList(): AgentInfo[] | null {
  try {
    const run = spawnSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 15000 });
    return run.status === 0 ? (JSON.parse(run.stdout) as AgentInfo[]) : null;
  } catch { return null; }
}

/** 지금 떠 있는 요청 담당의 세션 번호와 이름. 원본 표시가 있는 담당 기록(없는 옛 요청은 기록에 있는 모두)만 센다. 떠 있지 않으면 null, 세션 목록을 못 읽으면 undefined */
export function runningOwner(root: string, id: number, list: AgentInfo[] | null = agentsList()): AgentInfo | null | undefined {
  if (!list) return undefined;
  const mine = Object.entries(loadOwners(root)).filter(([, v]) => v.request === id);
  const sids = (mine.some(([, v]) => v.origin) ? mine.filter(([, v]) => v.origin) : mine).map(([k]) => k);
  return list.find((a) => a.sessionId && sids.includes(a.sessionId)) ?? null;
}

/** 메신저가 한 줄을 보낼 때 필요한 것: 받을 이름(서버가 확인한, 지금 돌고 있는 원본 담당의 이름)과 글 파일. 이름이 null이면 받을 담당이 안 떠 있다는 뜻이니 보내지 말고 fail로 알린다(담당을 띄우는 일은 서버가 한다) */
export function showRow(scanRoot: string, seq: number): { row: OutboxRow; textFile: string; sendTo: string | null } {
  const row = loadOutbox(scanRoot).find((r) => r.seq === seq);
  if (!row) throw new Error(`상자에 줄 ${seq}이 없다`);
  const root = projectRoot(scanRoot);
  return { row, textFile: textFile(scanRoot, seq), sendTo: runningOwner(root, row.request)?.name ?? null };
}

/** 서버가 담당을 띄우는 단 하나의 길. 요청당 잠금을 잡고, 잠근 채로 담당 기록과 떠 있는 세션을 다시 읽어 ① 돌고 있으면 띄우지 않고 그 요청의 대기 줄을 "보낼 수 있음"으로 바꾸며 ② 안 떠 있을 때만 `claude --bg`로(대화가 있으면 이어서) 띄워 대기 줄의 글을 처음 글로 넘긴다. 번호를 맞추는 동안은 담당 기록에 '맞추는 중'을 적어, 새 담당이 whoami로 자신을 확인할 때 짧게 기다리게 한다 */
export function ownerUp(scanRoot: string, id: number): 'running' | 'launched' | 'busy' | 'skipped' | 'failed' {
  const root = projectRoot(scanRoot);
  const holder = newHolder();
  if (!tryLock(scanRoot, `owner-${id}`, 90_000, holder)) return 'busy';
  try {
    const row = [...loadOutbox(scanRoot)].reverse().find((r) => r.request === id && r.state === 'pending' && r.ready === false);
    if (!row) return 'skipped';
    const list = agentsList();
    if (!list) return 'skipped';
    const running = runningOwner(root, id, list);
    if (running) {
      mutate(scanRoot, (rows) => { for (const r of rows) if (r.request === id && r.state === 'pending') r.ready = true; });
      fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} 담당이 이미 돌고 있어(${running.sessionId}) 새로 띄우지 않고 글만 보내도록 함\n`);
      try { afterEnqueue?.(); } catch { /* 메신저 확인이 실패해도 줄은 보낼 수 있게 바뀌었다 */ }
      return 'running';
    }
    // 안 떠 있다: 이 한 곳에서만 띄운다. 번호는 서버가 정한 원본(prepareOwner가 적은 것)을 쓴다
    const sid = row.session;
    let exists = false;
    try { fs.statSync(transcriptOf(root, sid)); exists = true; } catch { /* 대화가 아직 없음 */ }
    const head = exists ? ['--bg', '--resume', sid] : ['--bg', '--session-id', sid, '--name', ownerName(root, id)];
    // 백그라운드로 만든 세션(~/.claude/jobs에 기록이 있음)은 허용 도구 등 옵션을 이미 저장하고 있다. `--resume`에 옵션을 또 붙이면 이어받지 않고 복사본이 생기므로 옵션 없이 부른다. 그 밖의 세션과 새 세션에는 옵션을 건다
    const savedJob = exists && fs.existsSync(path.join(os.homedir(), '.claude', 'jobs', sid.slice(0, 8)));
    const startedAt = Date.now();
    markRebinding(root, sid, true);
    beat(scanRoot, `owner-${id}`);
    const run = spawnSync('claude', [...head, ...(savedJob ? [] : launchArgs(root, id, scanRoot)), fs.readFileSync(textFile(scanRoot, row.seq), 'utf8')], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} ${sid} claude --bg ${exists ? '--resume' : '--session-id'} 종료코드=${run.status}\n`);
    // claude --bg는 미리 정한 번호를 쓰지 않고 자기 번호를 붙인다. 출력의 짧은 번호(없으면 이 호출 뒤에 시작한 같은 이름의 백그라운드 세션)로 실제 번호를 찾아 담당 기록과 줄을 맞춘다
    const short = /backgrounded\s*·\s*([0-9a-f]+)/.exec(`${run.stdout ?? ''}\n${run.stderr ?? ''}`)?.[1];
    let real: string | undefined;
    for (let i = 0; run.status === 0 && !real && i < 20; i++) {
      if (i) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      beat(scanRoot, `owner-${id}`);
      const now = agentsList() ?? [];
      real = short ? now.find((a) => a.id === short || a.sessionId?.startsWith(short))?.sessionId
        : now.filter((a) => a.kind === 'background' && a.name === ownerName(root, id) && (a.startedAt ?? 0) >= startedAt - 2000).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]?.sessionId;
    }
    if (real && real !== sid) {
      rebindOwner(root, sid, real);
      mutate(scanRoot, (rows) => { for (const r of rows) if (r.session === sid) r.session = real as string; });
    } else if (real) markRebinding(root, sid, false);
    // 실제 번호를 못 찾았으면 '맞추는 중' 표시를 그대로 둔다(3분 뒤 저절로 풀린다). 지우면 곧 시작할 진짜 원본이 whoami에서 복사본으로 판정된다. 그 사이 담당이 whoami를 부르면 owner-check가 떠 있는 같은 이름 세션이 하나뿐일 때 스스로 맞춘다
    fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} claude --bg 출력 번호=${short ?? '못 읽음'} 실제 세션=${real ?? '목록에 없음'}\n`);
    if (run.status === 0) { doneRow(scanRoot, row.seq, exists ? 'bg-resume' : 'bg-new'); return 'launched'; }
    failRow(scanRoot, row.seq, `claude --bg 실패(종료코드 ${run.status}): ${(run.stderr || run.stdout || run.error?.message || '').trim().slice(0, 200)}`);
    return 'failed';
  } catch (e) {
    fs.appendFileSync(logFile(root), `${new Date().toISOString()} #${id} 담당 띄우기 오류: ${(e as Error).message}\n`);
    return 'failed';
  } finally { unlock(scanRoot, `owner-${id}`, holder); }
}

/** 별도 점검 세션을 `claude --bg`로 띄운다(reviewer.ts의 reviewerUp이 잠금 아래에서 부른다). claude를 실행하는 곳을 한 파일에 모으려고 여기에 둔다. 종료 코드를 돌려준다 */
export function launchReviewer(cwd: string, name: string, message: string): number | null {
  const head = ['--bg', '--name', name];
  return spawnSync('claude', [...head, ...reviewerArgs(), message], { cwd, encoding: 'utf8', timeout: 60_000 }).status;
}

/** 서버(또는 request 명령)가 줄을 적은 직후, 담당 확인·띄우기를 따로 도는 프로세스로 시킨다(서버 요청 처리를 막지 않으려고. 일은 ownerUp 한 곳에서 잠금 아래 한다). 꺼져 있거나 시험용이면 하지 않는다 */
export function kickOwnerUp(scanRoot: string, id: number): void {
  try {
    if (process.env.SPEC_TEST_DIR || process.env.SPEC_NO_KICK || !readConfig(projectRoot(scanRoot)).wake) return;
    spawn(process.execPath, [SPEC_MJS, 'request', 'owner-up', '--id', String(id), '--src', scanRoot], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 못 해도 1분 점검이 다시 시킨다 */ }
}

/** 담당 확인이 안 된 대기 줄이 20초를 채우기까지 남은 시간(ms). 이미 채운 줄이 있으면 0, 그런 줄이 없으면 null — 사건 하나짜리 타이머를 걸 때 쓴다 */
export function nextKickIn(scanRoot: string, now = Date.now()): number | null {
  const ats = loadOutbox(scanRoot).filter((r) => r.state === 'pending' && r.ready === false).map((r) => Date.parse(r.at) + 20_000 - now);
  return ats.length ? Math.max(0, Math.min(...ats)) : null;
}

/** 담당 확인이 안 된 채 20초 넘게 남은 대기 줄이 있으면 다시 시킨다(대기 줄이 적힌 뒤 20초 타이머가 부른다) */
export function kickWaiting(scanRoot: string, now = Date.now()): number {
  const waiting = loadOutbox(scanRoot).filter((r) => r.state === 'pending' && r.ready === false && now - Date.parse(r.at) > 20_000);
  for (const id of new Set(waiting.map((r) => r.request))) kickOwnerUp(scanRoot, id);
  return waiting.length;
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
    const mine = list.filter((a) => a.name === name && a.kind === 'background').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))[0];
    const src = path.relative(root, scanRoot) || '.';
    const first = `${SPEC_MJS.replace(/spec\.mjs$/, 'messenger.md')}를 읽고 그대로 따르세요. SPEC=${SPEC_MJS} (이 절대경로를 그대로 쓰세요), SRC=${src}, 작업 폴더 ${root}.`;
    const run = (args: string[]): void => { spawn('claude', args, { cwd: root, detached: true, stdio: 'ignore' }).unref(); };
    if (!mine) {
      // 띄운 직후 60초는 '띄우는 중'이라 목록에 아직 안 보여도 또 띄우지 않는다(잠금 파일을 먼저 만든 한 쪽만 띄운다)
      if (!tryLock(scanRoot, 'messenger-start', 60_000)) return 'ok';
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
    // 2초마다 다시 보지 않고, 줄이 적히는 순간(outbox 바뀜)에 깨어난다. 지켜보기를 먼저 걸고 확인해 그 사이의 바뀜을 놓치지 않는다
    const w = nextChange(scanRoot, ['outbox'], end - Date.now());
    const now = pendingRows(scanRoot).map((r) => r.seq);
    if (now.length || Date.now() >= end) { w.cancel(); return now; }
    await w.done;
  }
}
