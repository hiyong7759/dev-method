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

/** 이름표 chip의 색: me=내 차례(노랑), ag=에이전트 차례(파랑), ok=완료·통과(초록), bad=문제(빨강), dim=그 밖 */
export type Tone = 'me' | 'ag' | 'ok' | 'bad' | 'dim';
/** 상태를 한두 단어로 알리는 이름표 */
export const chip = (tone: Tone, text: Kid, extra = ''): HTMLSpanElement => h('span', { class: `chip ${tone}${extra}` }, text);
/** 범위·종류를 알리는 태그: c=화면·컴포넌트(파랑), i=정보(초록), 비우면 보통 */
export const tag = (kind: 'c' | 'i' | '', text: Kid): HTMLSpanElement => h('span', { class: `tag${kind ? ` ${kind}` : ''}` }, text);
/** 확인 필요 표시. 어디서나 같은 모양이고, 누르면 같은 확인 필요 패널이 열린다(onclick을 안 주면 표시만) */
export const rv = (text: Kid = '확인 필요', onclick?: () => void): HTMLElement => h(onclick ? 'button' : 'span', { class: 'rv', onclick: onclick ? (e: Event) => { e.stopPropagation(); onclick(); } : undefined }, text);

/** 보기를 거르는 칩 한 줄(fchips). 위쪽 칩 = 상태·종류. 하나만 고르고, 넘치면 줄바꿈된다 */
export function filterChips<K extends string>(items: { key: K; label: string; count: number }[], current: K, pick: (k: K) => void): HTMLElement {
  return h('div', { class: 'fchips' }, items.map((i) => h('button', { class: `fc${current === i.key ? ' on' : ''}`, onclick: () => pick(i.key) }, i.label, h('small', null, i.count))));
}

/** 왼쪽 분류 목록(side-list). 분류(도메인처럼 프로젝트마다 달라지는 것)로 거를 때 쓴다 */
export function sideList<K extends string>(title: string, items: { key: K; label: string; count: number }[], current: K, pick: (k: K) => void): HTMLElement {
  return h('nav', { class: 'side-list' }, h('h4', null, title), items.map((i) => h('button', { class: current === i.key ? 'on' : '', onclick: () => pick(i.key) }, i.label, h('span', null, i.count))));
}

/** 페이지 머리(ph): [빵부스러기] 제목 / 한 줄 설명. 모든 화면이 같은 구조를 쓴다 */
export interface PageHeadOptions {
  /** 두 단계 이상 들어간 화면에서만: 위 단계 이동 링크들 */
  crumb?: Kid;
  /** 화면 제목 */
  title: Kid;
  /** 제목 바로 아래 한 줄 설명 */
  lead?: Kid;
  /** 설명 대신 이름표·출처를 한 줄로 보일 때 */
  meta?: Kid;
  /** 오른쪽 작업 단추 */
  actions?: Kid;
}
export function pageHead({ crumb, title, lead, meta, actions }: PageHeadOptions): HTMLElement {
  const main = h('div', null, crumb ? h('div', { class: 'crumb' }, crumb) : null, h('h1', null, title), lead ? h('p', { class: 'lead' }, lead) : null, meta ? h('div', { class: 'lead meta' }, meta) : null);
  return h('header', { class: 'ph' }, actions ? h('div', { class: 'phrow' }, main, h('div', { style: 'display:flex;gap:8px;flex:none' }, actions)) : main);
}

/** 오른쪽 패널(sidepanel): 제목+닫기 / 본문 칸들 / 아래 단추. 폭은 380 고정 */
export interface SidePanelOptions {
  /** 패널 제목 */
  title: Kid;
  /** 제목 아래 한 줄 설명 */
  sub?: Kid;
  /** 닫기(✕). 없으면 닫기 단추를 그리지 않는다 */
  onClose?: () => void;
  /** 본문 칸들 */
  body: Kid;
  /** 아래 단추 줄 */
  foot?: Kid;
}
export function sidePanel({ title, sub, onClose, body, foot }: SidePanelOptions): HTMLElement {
  return h('aside', { class: 'sidepanel' },
    h('div', { class: 'sp-head' }, h('h3', null, title), onClose ? h('button', { class: 'sp-x', onclick: onClose, 'aria-label': '닫기' }, '✕') : null),
    sub ? h('div', { class: 'hint' }, sub) : null, body, foot ? h('div', { class: 'sp-foot' }, foot) : null);
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

/** 화면 상태 이름표의 색 */
const STATUS_TONE: Record<string, Tone> = { dev: 'dim', 'test-requested': 'ag', 'needs-fix': 'bad', approved: 'ok', 'approved-changed': 'me', memo: 'dim' };
/** 화면 상태를 알리는 작은 이름표 */
export function statusChip(st: Pick<ScreenStatus, 'status' | 'label'>, extra = ''): HTMLSpanElement {
  return chip(STATUS_TONE[st.status] ?? 'dim', st.label, extra);
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
