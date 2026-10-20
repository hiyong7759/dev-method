/**
 * @spec viewer-util 설계서 보기 화면의 공통 도구
 * @why 화면 파일마다 요소 만들기, 서버 부르기, 주소 맞추기, 표시용 글을 따로 만들면 서로 달라지므로 한 곳에 둔다.
 * @contract finish(src/finish.ts)가 화면 이름 맞추기(matchScreen)를 같이 쓴다. 브라우저에서 돌 수 있는 코드만 둔다.
 */
import type { Model, ModelScreen, Role, ScreenStatus } from '../types.js';

/** 이벤트 처리기(on클릭 등)들 */
type Handlers = { [K in keyof GlobalEventHandlersEventMap as `on${K}`]?: (e: GlobalEventHandlersEventMap[K]) => void };
/** 요소 속성: 이벤트(on…), class, style, dataset, 그 밖 속성 */
export type Props = Handlers & { class?: string | false | null; style?: string; dataset?: Record<string, string>; [attr: string]: unknown };
/** 요소 안에 넣을 수 있는 것: 요소, 글, 숫자, 비어 있음, 또는 그 목록 */
export type Kid = Node | string | number | false | null | undefined | Kid[];

/** 요소를 만든다: h('div', { class: 'a' }, '글', 다른요소) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.style.cssText = String(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c: Kid): void => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

/** 보기를 거르는 칩 한 줄. 정보 흐름과 사용 흐름이 같은 모양을 쓰고, 칩이 많아지면 줄바꿈된다 */
export function filterChips<K extends string>(items: { key: K; label: string; count: number }[], current: K, pick: (k: K) => void): HTMLElement {
  return h('div', { class: 'seg fchips' }, items.map((i) => h('button', { class: current === i.key ? 'on' : '', onclick: () => pick(i.key) }, `${i.label} ${i.count}`)));
}

/** 잡은 오류에서 사람이 읽을 글만 꺼낸다(src/cli.ts에도 같은 것이 있다: 화면 코드는 바깥 폴더를 못 불러온다) */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 서버에서 JSON을 읽는다(저장된 것을 쓰지 않고 늘 새로) */
export async function get<T>(url: string): Promise<T> { const r = await fetch(url, { cache: 'no-store' }); return r.json() as Promise<T>; }
/** 서버에 JSON을 보낸다. 서버가 오류를 알리면 그 글로 예외를 던진다 */
export async function post<T = unknown>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body || {}) });
  const j = await r.json() as T & { error?: string };
  if (j && j.error) throw new Error(j.error);
  return j;
}

/** 라우트 패턴('/trips/:tripId/days/:n')과 실제 주소 맞추는 식 */
const rx = (pattern: string): RegExp => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '')}/?$`);
/** 실제 주소에 맞는 화면(여러 개면 주소가 가장 구체적인 것) */
export function matchScreen(model: Pick<Model, 'screens'>, pathname: string): ModelScreen | null {
  const hits = model.screens.filter((s) => s.route && rx(s.route).test(pathname));
  return hits.sort((a, b) => b.route.length - a.route.length)[0] || null;
}

/** 시각을 "월/일 시:분"으로 */
export const fmt = (iso: string): string => { const d = new Date(iso); const p = (n: number): string => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
/** 정보가 화면에서 하는 일의 화면용 이름 */
export const ROLE_LABEL: Record<Role, string> = { input: '입력', shown: '보여줌', modify: '수정', judge: '판단' };
/** 정보가 하는 일을 보이는 순서 */
export const ROLES: Role[] = ['input', 'shown', 'modify', 'judge'];

/** 화면 상태를 알리는 작은 이름표 */
export function statusChip(st: Pick<ScreenStatus, 'status' | 'label'>, extra = ''): HTMLSpanElement {
  return h('span', { class: `chip-st ${st.status}${extra}` }, st.label);
}

let toastTimer = 0;
/** 화면 아래에 잠깐 뜨는 안내 */
export function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 3200);
}

/** 글을 클립보드에 복사한다. 보안 문맥이 아니면 임시 입력칸을 거친다 */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 보안 문맥이 아니면 아래로 */ }
  const ta = h('textarea', { style: 'position:fixed;left:-999px' }, text);
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}
