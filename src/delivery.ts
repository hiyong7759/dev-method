/**
 * @spec decision-delivery 사용자 결정과 '시작'의 전달 기록
 * @why 승인·반려를 눌러도, 접수에서 시작을 눌러도 담당 세션이 읽었는지 알 길이 없어, 여러 요청을 번갈아 보다 보면 전달이 안 된 요청을 놓친다. 결정(그리고 설계 시작) 한 건마다 눌림·보냄·읽음·반영 시각을 한 기록에 적고, 화면의 이름표·상태 글·오른쪽 패널이 모두 이 기록 하나만 읽게 해서 서로 어긋나지 않게 한다.
 * @contract 기록은 이 컴퓨터에만 두는 .spec/deliveries.json(요청 번호 → 가장 최근 결정의 기록)이고 커밋하지 않는다. 눌림은 요청 파일의 사용자 결정 기록(설계 시작은 '시작함' 기록) 시각이다. 보냄은 메신저 세션이 SendMessage(또는 claude --bg)로 보냈다고 알린 때(markDelivered), 못 보냈으면 이유와 함께 '전달 안 됨'(markUndelivered)이다. 읽음은 받은 세션이 `request ack`로 응답한 때(markRead)뿐이다. 서버는 어떤 프로세스도 띄우거나 자동으로 다시 보내지 않는다(다시 보내기는 사용자가 누르면 outbox 줄을 대기로 되돌릴 뿐이다: markRequeued). 반영은 그 결정 뒤에 에이전트가 요청 파일에 남긴 첫 기록의 시각으로 계산한다. 뒤 칸이 찼으면 앞 칸도 찬 것으로 본다(반영 ⇒ 읽음 ⇒ 보냄). 결정을 반영한(시작은 읽은) 뒤에도 마지막 기록이 STALL_AFTER_MIN분 넘게 멈춰 있으면(담당이 아직 차례이고 막힘·질문 중이 아닐 때) 화면이 '멈춘 듯함'(stalled)을 보인다. 기록이 없는 옛 결정은 전달 상태를 만들지 않는다. 기록·계산이 실패해도 사용자 결정은 그대로 성공한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './project.js';
import { openNotes, STEP } from './request.js';
import type { Delivery, DeliveryState, Request } from './types.js';

/** 담당이 결정을 반영(기록)한 뒤 이만큼(분) 다음 단계 기록이 없으면 멈춘 것으로 본다 */
export const STALL_AFTER_MIN = 20;

/** 결정으로 보는 사용자 기록 종류 */
/** (테스트 승인은 요청을 완료로 닫아 이어서 할 일이 없으니 담당 세션에 전달할 결정이 아니다) */
const DECISIONS = new Set(['design-approved', 'design-rejected', 'test-problem', 'redesigned']);
/** 반영으로 치지 않는 에이전트 기록 종류(세션을 만들거나 이름을 정한 것은 결정을 읽은 일이 아니다) */
const NOT_APPLIED = new Set(['session-started', 'session-failed', 'agent', 'created', 'started']);

/** 보낸 길: 열린 창에 SendMessage / 닫힌 담당을 claude --bg --resume으로 이어 띄움 / 새 담당을 claude --bg로 만듦 */
export type Via = 'send' | 'bg-resume' | 'bg-new';

/** 저장되는 모양 */
interface Stored { decidedAt: string; sentAt?: string; readAt?: string; resent: number; via?: Via; failedAt?: string; reason?: string }
type Store = Record<string, Stored>;

const file = (scanRoot: string): string => path.join(specDir(scanRoot), 'deliveries.json');
function load(scanRoot: string): Store {
  try { return JSON.parse(fs.readFileSync(file(scanRoot), 'utf8')) as Store; } catch { return {}; }
}
function save(scanRoot: string, s: Store): void { fs.writeFileSync(file(scanRoot), JSON.stringify(s, null, 2) + '\n'); }

/** 요청의 가장 최근 결정 기록. 접수에서 시작한 '시작함'(에이전트가 남기는 기록)도 같은 전달 기록의 대상이다 */
export function lastDecision(r: Request): Request['events'][number] | undefined {
  return [...r.events].reverse().find((e) => (e.by === 'user' && DECISIONS.has(e.kind)) || e.kind === 'started');
}

/** 가장 최근 전달 대상이 설계 시작인가(결정과 글·읽음·반영의 기준이 다르다) */
export const isStart = (r: Request): boolean => lastDecision(r)?.kind === 'started';

/** 결정 순간에 기록을 만든다(이미 같은 결정의 기록이 있으면 그대로). 실패해도 던지지 않는다 */
export function openDelivery(scanRoot: string, r: Request | undefined): Stored | null {
  try {
    const d = r && lastDecision(r);
    if (!r || !d) return null;
    const s = load(scanRoot);
    if (s[r.id]?.decidedAt !== d.at) { s[r.id] = { decidedAt: d.at, resent: 0 }; save(scanRoot, s); }
    return s[r.id];
  } catch { return null; }
}

/** 담당이 받은 뒤 다음 단계(설계 제출·테스트 요청)를 안 올리고 멈춘 상태인지: received(결정은 반영, 시작은 읽음) 뒤 아직 에이전트 차례이고, 막힘·질문 중이 아니며, 마지막 기록이 STALL_AFTER_MIN분보다 오래됐다. 멈춘 지 몇 분인지(아니면 null)를 돌려준다 */
function stalledMin(r: Request, received: boolean, now: number): number | null {
  if (!received || STEP[`${r.stage}:${r.step}`]?.turn !== 'agent') return null;
  const notes = openNotes(r);
  if (notes.blocked || notes.asking) return null;
  const min = Math.floor((now - Date.parse(r.events[r.events.length - 1].at)) / 60000);
  return min >= STALL_AFTER_MIN ? min : null;
}

/** 메신저가 보냈음을 적는다(전달 안 됨 표시는 지운다) */
export function markDelivered(scanRoot: string, id: number, via: Via): void {
  try {
    const s = load(scanRoot), cur = s[id];
    if (!cur) return;
    cur.sentAt = new Date().toISOString(); cur.via = via; delete cur.failedAt; delete cur.reason;
    save(scanRoot, s);
  } catch { /* 기록 실패가 결정을 막지 않는다 */ }
}

/** 메신저가 못 보냈음과 이유를 적는다 */
export function markUndelivered(scanRoot: string, id: number, reason: string): void {
  try {
    const s = load(scanRoot), cur = s[id];
    if (!cur) return;
    cur.failedAt = new Date().toISOString(); cur.reason = reason;
    save(scanRoot, s);
  } catch { /* 기록 실패가 결정을 막지 않는다 */ }
}

/** 사용자가 다시 보내기를 눌러 outbox 줄이 대기로 돌아갔음을 적는다(보냄·전달 안 됨 표시를 지우고 횟수를 센다) */
export function markRequeued(scanRoot: string, id: number): void {
  try {
    const s = load(scanRoot), cur = s[id];
    if (!cur) return;
    cur.resent += 1; delete cur.sentAt; delete cur.failedAt; delete cur.reason; delete cur.via;
    save(scanRoot, s);
  } catch { /* 기록 실패가 결정을 막지 않는다 */ }
}

/** 읽음을 적는다. 받은 세션이 request ack로 응답했을 때만 부른다. 이미 읽음이면 그대로 */
export function markRead(scanRoot: string, id: number): void {
  try {
    const s = load(scanRoot), cur = s[id];
    if (!cur || cur.readAt) return;
    cur.readAt = new Date().toISOString();
    save(scanRoot, s);
  } catch { /* 기록 실패가 응답을 막지 않는다 */ }
}

/** 요청 하나의 전달 상태. 기록이 없으면 null(옛 결정, 또는 결정 전) */
export function deliveryOf(scanRoot: string, r: Request, now = Date.now()): Delivery | null {
  const rec = load(scanRoot)[r.id];
  const d = lastDecision(r);
  if (!rec || !d || rec.decidedAt !== d.at) return null;
  const applied = r.events.find((e) => e.by === 'agent' && e.at > d.at && !NOT_APPLIED.has(e.kind))?.at ?? null;
  // 뒤 칸이 찼으면 앞 칸도 찬 것으로 본다
  const read = rec.readAt ?? applied;
  const sent = rec.sentAt ?? read;
  const waitMin = Math.max(0, Math.floor((now - Date.parse(rec.sentAt ?? d.at)) / 60000));
  const received = isStart(r) ? !!read : !!applied;
  const stalled = stalledMin(r, received, now) !== null;
  // 보냄이 없고 메신저가 못 보냈다고 알렸으면 '전달 안 됨', 아직 메신저가 안 가져갔으면 대기
  const state: DeliveryState = stalled ? 'stalled' : applied ? 'applied' : read ? 'read' : rec.failedAt && !sent ? 'failed' : !sent ? 'hook-wait' : 'sending';
  return { decision: d.note, kind: d.kind, pressed: d.at, sent, read, applied, resent: rec.resent, state, waitMin, ...(rec.via ? { via: rec.via } : {}), ...(rec.reason ? { reason: rec.reason } : {}) };
}
