/**
 * @spec comment-basket 담아 둔 코멘트
 * @why 코멘트를 하나씩 보내면 에이전트가 낱개로 받아 흐름을 잡기 어렵다. 화면을 따라가며 코멘트를 먼저 담아 두고, 다 담은 뒤 한번에 보내게 한다. 담은 것은 보내기 전에 고치거나 지울 수 있다.
 * @basis 담아 둔 것은 아직 에이전트에게 안 간 초안이라 이 브라우저에만 둔다(서버에는 보낼 때 처음 쌓인다). 테스트 경로를 따라가는 새 창과 요청 상세 창이 같은 담음을 보도록 localStorage에 둔다.
 * @contract 항목 모양은 BasketItem이다. 바꾸면 담기 화면(comment.ts)과 요청 상세의 반려(manage-detail.ts)가 함께 바뀐다. 보내기는 서버의 /__spec/comment/send 하나만 부른다.
 */
import { post } from './util.js';
import type { CommentTarget } from '../types.js';

/** 담아 둔 코멘트 하나 */
export interface BasketItem {
  /** 담은 것을 가리키는 열쇠(보내기 전 고치기·지우기에 쓴다) */
  key: string;
  /** 어디에 남기는지 */
  target: CommentTarget;
  /** 글 */
  text: string;
  /** 같이 보낼 캡처(data:image/png, 없으면 빈 글) */
  shot: string;
}

const KEY = 'spec-view:comment-basket';
const EVENT = 'cm-basket';
let memory: BasketItem[] | null = null;

/** 담은 코멘트들. 저장소를 못 쓰면 이 창 안에서만 기억한다 */
export function basket(): BasketItem[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as BasketItem[]; } catch { return memory ?? []; }
}
function store(items: BasketItem[]): void {
  memory = items;
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 캡처가 너무 커서 못 담으면 이 창 안에서만 기억한다 */ }
  window.dispatchEvent(new Event(EVENT));
}
/** 담은 코멘트가 바뀌면(다른 창에서 바뀐 것 포함) 알려 달라고 등록한다 */
export function onBasket(fn: () => void): void { window.addEventListener(EVENT, fn); window.addEventListener('storage', (e) => { if (e.key === KEY) fn(); }); }

/** 코멘트를 담는다 */
export function addToBasket(it: Omit<BasketItem, 'key'>): void { store([...basket(), { ...it, key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }]); }
/** 담은 글을 고친다 */
export function editBasket(key: string, text: string): void { store(basket().map((i) => (i.key === key ? { ...i, text } : i))); }
/** 담은 것을 지운다 */
export function removeFromBasket(key: string): void { store(basket().filter((i) => i.key !== key)); }

/** 담은 코멘트를 전부 한번에 보낸다. request가 있으면 그 테스트 요청의 반려가 되고, 담은 게 없을 때는 note(이유 한 줄)가 반려 이유다. 보낸 뒤 담음을 비운다 */
export async function sendBasket(o: { request?: number; note?: string } = {}): Promise<void> {
  const items = basket();
  await post('/__spec/comment/send', { items: items.map(({ target, text, shot }) => ({ target, text, shot })), request: o.request, note: o.note });
  store([]);
}
