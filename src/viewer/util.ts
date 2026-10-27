/**
 * @spec viewer-util 설계서 보기 화면의 공통 도구
 * @why 화면 파일마다 요소 만들기, 서버 부르기, 주소 맞추기, 표시용 글을 따로 만들면 서로 달라지므로 한 곳에 둔다.
 * @contract finish(src/finish.ts)가 화면 이름 맞추기(matchScreen)를 같이 쓴다. 브라우저에서 돌 수 있는 코드만 둔다.
 */
import type { Model, ModelScreen, Role } from '../types.js';

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
export type Tone = 'me' | 'ag' | 'ok' | 'bad' | 'dim' | 'wait';
/** 상태를 한두 단어로 알리는 이름표 */
export const chip = (tone: Tone, text: Kid, extra = ''): HTMLSpanElement => h('span', { class: `chip ${tone}${extra}` }, text);
/** 범위·종류를 알리는 태그: c=화면·컴포넌트(파랑), i=정보(초록), 비우면 보통 */
export const tag = (kind: 'c' | 'i' | '', text: Kid): HTMLSpanElement => h('span', { class: `tag${kind ? ` ${kind}` : ''}` }, text);
/** 확인 필요 표시. 어디서나 같은 모양이고, 누르면 같은 확인 필요 패널이 열린다(onclick을 안 주면 표시만) */
export const rv = (text: Kid = '확인 필요', onclick?: () => void): HTMLElement => h(onclick ? 'button' : 'span', { class: 'rv', onclick: onclick ? (e: Event) => { e.stopPropagation(); onclick(); } : undefined }, text);

/** 구분 점의 뜻. 모양과 색이 정해져 있고(style.css의 .bul), 한 화면 안에서는 같은 점이 둘이 되지 않게 쓴다 */
export type BulKind = 'ing' | 'rev' | 'br' | 'scr' | 'int' | 'que' | 'des' | 'imp' | 'tst' | 'fnd' | 'nrq' | 'fin' | 'cmp';
/** 점의 모양(색은 뜻마다 css에 있다). 비워 두면 동그라미 = 끝남·온전함. 진행 단계는 꼭지점이 늘수록 끝에 가깝다: 설계 ▲(3) → 구현 ■(4) → 테스트 ⬢(6) → 완료 ●. ◆는 갈림·발견, ★은 예외 */
const BUL_SHAPE: Partial<Record<BulKind, string>> = { ing: 'sq', rev: 'tri', br: 'dia', int: 'sq', que: 'sq', des: 'tri', imp: 'sq', tst: 'hex', fnd: 'dia', nrq: 'star' };
/** 구분 점 하나 */
export const bul = (kind: BulKind): HTMLSpanElement => h('span', { class: `bul ${kind}${BUL_SHAPE[kind] ? ` ${BUL_SHAPE[kind]}` : ''}` });
/** 카드에 두는 점들(글자 없이 점만, 마우스를 올리면 뜻이 뜬다). 해당하는 구분이 없으면 아무것도 그리지 않는다 */
export function buls(kinds: { kind: BulKind; label: string }[]): HTMLElement | null {
  if (!kinds.length) return null;
  const label = kinds.map((k) => k.label).join(' · ');
  return h('span', { class: 'buls', title: label, 'aria-label': label, role: 'img' }, kinds.map((k) => bul(k.kind)));
}

/** 보기를 거르는 칩 한 줄(fchips). 위쪽 칩 = 상태·종류. 하나만 고르고, 넘치면 줄바꿈된다. 칩에 점(bul)을 주면 같은 구분의 카드 점과 짝이 된다 */
export function filterChips<K extends string>(items: { key: K; label: string; count: number; bul?: BulKind }[], current: K, pick: (k: K) => void): HTMLElement {
  return h('div', { class: 'fchips' }, items.map((i) => h('button', { class: `fc${current === i.key ? ' on' : ''}`, onclick: () => pick(i.key) }, i.bul ? bul(i.bul) : null, i.label, h('small', null, i.count))));
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
  const el = h('header', { class: 'ph' }, h('i', { class: 'ph-mark' }), actions ? h('div', { class: 'phrow' }, main, h('div', { style: 'display:flex;gap:8px;flex:none' }, actions)) : main);
  stickHead(el);
  return el;
}

/** 페이지 머리를 스크롤해도 위에 붙여 두는 일. 붙으면(stuck) 설명 줄을 접어 자리를 줄이고, 아래에 붙는 필터 칩이 비켜 설 높이(--ph-h)를 알린다 */
function stickHead(el: HTMLElement): void {
  const mark = el.firstElementChild as HTMLElement;
  new IntersectionObserver(([e]) => el.classList.toggle('stuck', !e.isIntersecting)).observe(mark);
  new ResizeObserver(() => { if (el.isConnected) document.documentElement.style.setProperty('--ph-h', `${el.offsetHeight}px`); }).observe(el);
}

/** 오른쪽 패널(sidepanel): 제목(+닫기·접기) / 본문 칸들 / 아래 단추. 폭은 380 고정.
 *  눌러서 여는 패널은 onClose(✕)를, 늘 떠 있는 패널은 fold(접기 토글 »)를 준다. 둘을 섞지 않는다 */
export interface SidePanelOptions {
  /** 패널 제목 */
  title: Kid;
  /** 제목 옆 이름표 */
  badge?: Kid;
  /** 제목 아래 한 줄 설명 */
  sub?: Kid;
  /** 눌러서 여는 패널: 닫기(✕). 없으면 닫기 단추를 그리지 않는다 */
  onClose?: () => void;
  /** 늘 떠 있는 패널: 접은 상태를 브라우저에 기억할 이름. 주면 접기 토글(»)이 생기고, 접으면 좁은 띠(«)가 된다 */
  fold?: string;
  /** 본문 칸들 */
  body: Kid;
  /** 아래 단추 줄 */
  foot?: Kid;
}
/** 접은 상태를 읽고 쓴다(브라우저 저장소가 막혀 있어도 화면은 돌아가게) */
const foldKey = (k: string): string => `spec.fold.${k}`;
const folded = (k: string): boolean => { try { return localStorage.getItem(foldKey(k)) === '1'; } catch { return false; } };
const setFolded = (k: string, v: boolean): void => { try { localStorage.setItem(foldKey(k), v ? '1' : '0'); } catch { /* 저장 못 해도 화면은 그대로 */ } };
export function sidePanel({ title, badge, sub, onClose, fold, body, foot }: SidePanelOptions): HTMLElement {
  const el = h('aside', { class: 'sidepanel' });
  const toggle = (to: boolean): HTMLElement => h('button', { class: 'sp-x tg', 'aria-label': to ? '패널 접기' : '패널 펼치기', title: to ? '패널 접기' : '패널 펼치기', onclick: () => { setFolded(fold as string, to); draw(); } }, to ? '»' : '«');
  const draw = (): void => {
    if (fold && folded(fold)) {
      el.className = 'sidepanel rail';
      el.replaceChildren(toggle(false), h('span', { class: 'rt' }, title));
      return;
    }
    el.className = 'sidepanel';
    const parts = h('div', null,
      h('div', { class: 'sp-head' }, h('h3', null, title), badge ?? null, onClose ? h('button', { class: 'sp-x', onclick: onClose, 'aria-label': '닫기' }, '✕') : null, fold ? toggle(true) : null),
      sub ? h('div', { class: 'hint' }, sub) : null, body, foot ? h('div', { class: 'sp-foot' }, foot) : null);
    el.replaceChildren(...Array.from(parts.childNodes));
  };
  draw();
  return el;
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
  const hits = model.screens.map((s) => ({ s, r: (s.routes ?? []).filter((x) => rx(x).test(pathname)).sort((a, b) => b.length - a.length)[0] })).filter((x) => x.r);
  return hits.sort((a, b) => b.r.length - a.r.length)[0]?.s || null;
}

/** 시각을 "월/일 시:분"으로 */
export const fmt = (iso: string): string => { const d = new Date(iso); const p = (n: number): string => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
/** 정보가 화면에서 하는 일의 화면용 이름 */
export const ROLE_LABEL: Record<Role, string> = { input: '입력', shown: '보임', modify: '수정', judge: '판단' };
/** 정보가 하는 일을 보이는 순서 */
export const ROLES: Role[] = ['input', 'shown', 'modify', 'judge'];

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

/** 사용자 언어(지금은 한국어). 이름 값이 언어별로 있어 언어가 늘면 여기만 바꾼다 */
const NAME_LANG = 'ko';

/** 정보나 필드 이름을 사용자 언어(지금은 한국어)로 만든다. 이름이 없으면 영어 이름이 그대로 나온다. 영어 이름은 부르는 쪽이 마우스를 올리면 보이게(title) 붙인다 */
export function nameLabel(model: Model, kind: 'infos' | 'props', name: string): string {
  const local = model.names?.[NAME_LANG]?.[kind]?.[name];
  return local || name;
}
