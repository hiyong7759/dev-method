/**
 * @spec outbox 담당 세션에 보낼 글 상자(메신저가 가져가 보낸다)
 * @why 결정·시작을 담당 세션에 알리는 일을 서버가 헤드리스(claude -p)로 하면 열려 있는 세션 창에는 사용자 메시지처럼 들어가지 않고 따로 도는 복사본이 생겨 결정이 사라진다. 그래서 서버는 보낼 글과 받을 세션만 이 상자에 적고, 작은 모델의 메신저 세션이 SendMessage로 열린 창에 보낸다. 서버는 어떤 프로세스도 띄우지 않는다.
 * @contract 상자는 이 컴퓨터에만 두는 .spec/outbox.json(줄 목록)이고 글 본문은 .spec/outbox-text/<줄 번호>.txt에 둔다. 줄 하나 = 요청 하나의 마지막 결정(또는 시작) 한 건이며, 같은 요청의 대기 중인 옛 줄은 새 줄이 대신한다. 상태는 pending(대기)·sent(보냄)·failed(못 보냄, 이유 있음)이다. 설정 `wake: true`일 때만 줄을 적는다(꺼져 있으면 전달 기록만 열어 두고, 열린 세션에는 inbox 훅이 알린다). 완료·취소된 요청의 결정은 줄을 만들지 않는다. 담당이 없으면 session.ts가 새 번호를 정하고, 메신저는 ① 열린 창이면 SendMessage ② 아니고 대화가 있으면 `claude --bg --resume` ③ 대화가 없으면 `claude --bg --session-id` 순서로 시도한다. 어느 길도 안 되면 헤드리스로 넘어가지 않고 이유와 함께 failed로 남기며(화면에 '전달 안 됨 · 이유'), 사용자가 다시 보내기를 누르면 대기로 돌아간다. 메신저는 `request outbox wait`로 줄이 생길 때까지 토큰 없이 기다리고, `show`로 한 줄을 받아, `done`·`fail`로 결과를 적는다. 적기가 실패해도 사용자 결정은 그대로 성공한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from './config.js';
import { isStart, lastDecision, markDelivered, markRequeued, markUndelivered, openDelivery } from './delivery.js';
import type { Via } from './delivery.js';
import { loadRequests } from './request.js';
import { launchArgs, logFile, newOwnerMessage, decisionMessage, ownerName, ownersOf, prepareOwner, transcriptOf } from './session.js';
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
  /** 열린 창에 SendMessage로 보낼 때 쓰는 이름 */
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

/** 메신저가 한 줄을 보낼 때 필요한 것: 받을 이름, 글 파일, 열린 창이 안 될 때 쓸 `claude --bg` 명령(대화가 있으면 이어 띄우고 없으면 새로 만든다) */
export function showRow(scanRoot: string, seq: number): { row: OutboxRow; textFile: string; conversationExists: boolean; sendTo: string; bgCommand: string; bgVia: Via } {
  const row = loadOutbox(scanRoot).find((r) => r.seq === seq);
  if (!row) throw new Error(`상자에 줄 ${seq}이 없다`);
  const root = projectRoot(scanRoot);
  const tf = textFile(scanRoot, seq);
  let exists = false;
  try { fs.statSync(transcriptOf(root, row.session)); exists = true; } catch { /* 대화가 아직 없음 */ }
  const base = exists ? `claude --bg --resume ${row.session}` : `claude --bg --session-id ${row.session} --name ${q(ownerName(root, row.request))}`;
  const bgCommand = `${base} ${launchArgs().map(q).join(' ')} "$(cat ${q(tf)})"`;
  return { row, textFile: tf, conversationExists: exists, sendTo: row.to, bgCommand, bgVia: exists ? 'bg-resume' : 'bg-new' };
}

/** 대기 줄이 생길 때까지(최대 timeoutMs) 기다렸다가 대기 줄 번호들을 돌려준다. 기다리는 동안 토큰을 쓰지 않는다(메신저가 Monitor로 부른다) */
export async function waitPending(scanRoot: string, timeoutMs = 10 * 60_000): Promise<number[]> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const now = pendingRows(scanRoot).map((r) => r.seq);
    if (now.length || Date.now() >= end) return now;
    await new Promise((ok) => setTimeout(ok, 2000));
  }
}
