/**
 * @spec decision-delivery 사용자 결정의 전달 기록
 * @why 승인·반려를 눌러도 담당 세션이 읽었는지 알 길이 없어, 여러 요청을 번갈아 보다 보면 전달이 안 된 요청을 놓친다. 결정 한 건마다 눌림·보냄·읽음·반영 시각을 한 기록에 적고, 화면의 이름표·상태 글·오른쪽 패널이 모두 이 기록 하나만 읽게 해서 서로 어긋나지 않게 한다.
 * @contract 기록은 이 컴퓨터에만 두는 .spec/deliveries.json(요청 번호 → 가장 최근 결정의 기록)이고 커밋하지 않는다. 눌림은 요청 파일의 사용자 결정 기록 시각이다. 보냄·읽음·재전송은 wake.ts·inbox.ts가 적는다. 반영은 그 결정 뒤에 에이전트가 요청 파일에 남긴 첫 기록의 시각으로 계산한다. 뒤 칸이 찼으면 앞 칸도 찬 것으로 본다(반영 ⇒ 읽음 ⇒ 보냄). 기록이 없는 옛 결정은 전달 상태를 만들지 않는다. 기록·계산이 실패해도 사용자 결정은 그대로 성공한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './project.js';
import type { Delivery, DeliveryState, Request } from './types.js';

/** 읽음이 없을 때 다시 보내기까지 기다리는 시간(분) */
export const RESEND_AFTER_MIN = 5;
/** 자동 재전송 최대 횟수. 그 뒤에도 안 읽히면 사용자에게 넘긴다 */
export const RESEND_MAX = 2;

/** 결정으로 보는 사용자 기록 종류 */
const DECISIONS = new Set(['design-approved', 'design-rejected', 'test-approved', 'test-problem', 'redesigned']);
/** 반영으로 치지 않는 에이전트 기록 종류(세션을 만들거나 이름을 정한 것은 결정을 읽은 일이 아니다) */
const NOT_APPLIED = new Set(['session-started', 'agent', 'created', 'started']);

/** 저장되는 모양 */
interface Stored { decidedAt: string; sentAt?: string; readAt?: string; lastSentAt?: string; resent: number; via?: 'wake' | 'hook' }
type Store = Record<string, Stored>;

const file = (scanRoot: string): string => path.join(specDir(scanRoot), 'deliveries.json');
function load(scanRoot: string): Store {
  try { return JSON.parse(fs.readFileSync(file(scanRoot), 'utf8')) as Store; } catch { return {}; }
}
function save(scanRoot: string, s: Store): void { fs.writeFileSync(file(scanRoot), JSON.stringify(s, null, 2) + '\n'); }

/** 요청의 가장 최근 결정 기록 */
export function lastDecision(r: Request): Request['events'][number] | undefined {
  return [...r.events].reverse().find((e) => e.by === 'user' && DECISIONS.has(e.kind));
}

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

/** 보냄을 적는다. again이면 다시 보낸 것이라 재전송 횟수를 센다 */
export function markSent(scanRoot: string, id: number, via: 'wake' | 'hook', again = false): void {
  try {
    const s = load(scanRoot), cur = s[id];
    if (!cur) return;
    const now = new Date().toISOString();
    cur.sentAt = cur.sentAt ?? now; cur.lastSentAt = now; cur.via = via;
    if (again) cur.resent += 1;
    save(scanRoot, s);
  } catch { /* 기록 실패가 결정을 막지 않는다 */ }
}

/** 읽음을 적는다(훅이 결정을 세션에 넣어 줬거나 깨움 글이 세션에 도착했을 때). 이미 읽음이면 그대로 */
export function markRead(scanRoot: string, id: number): void {
  try {
    const s = load(scanRoot), cur = s[id];
    if (!cur || cur.readAt) return;
    cur.readAt = new Date().toISOString();
    save(scanRoot, s);
  } catch { /* 기록 실패가 훅을 막지 않는다 */ }
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
  const since = Date.parse(rec.lastSentAt ?? rec.sentAt ?? d.at);
  const waitMin = Math.max(0, Math.floor((now - since) / 60000));
  const state: DeliveryState = applied ? 'applied' : read ? 'read' : !sent ? 'hook-wait' : rec.resent >= RESEND_MAX && waitMin >= RESEND_AFTER_MIN ? 'failed' : 'sending';
  const nextResendAt = state === 'sending' && rec.resent < RESEND_MAX ? new Date(since + RESEND_AFTER_MIN * 60000).toISOString() : null;
  return { decision: d.note, kind: d.kind, pressed: d.at, sent, read, applied, resent: rec.resent, maxResend: RESEND_MAX, state, waitMin, nextResendAt };
}

/** 지금 다시 보내야 하는 요청 번호들: 보낸 지 RESEND_AFTER_MIN분이 지났는데 읽음이 없고 재전송이 남은 것 */
export function dueForResend(scanRoot: string, list: Request[], now = Date.now()): number[] {
  return list.filter((r) => {
    const v = deliveryOf(scanRoot, r, now);
    return !!v && v.state === 'sending' && v.resent < v.maxResend && !!v.nextResendAt && Date.parse(v.nextResendAt) <= now;
  }).map((r) => r.id);
}
