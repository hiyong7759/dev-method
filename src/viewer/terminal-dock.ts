/**
 * @spec terminal-dock 화면 아래 붙박이 터미널 영역
 * @why 담당 세션과 대화하려고 브라우저 탭이나 iTerm2 창을 따로 열면 화면과 대화가 흩어진다. 설계서 보기의 모든 화면(현행·관리) 아래에 열고 닫는 영역을 붙이고, 일하는 담당 세션마다 탭 하나로 실제 터미널을 보여 준다.
 * @basis 화면을 다시 그릴 때마다 터미널 연결이 끊기지 않도록, 영역은 화면 틀(#app) 밖 형제 요소로 한 번만 만들고 다시 그리지 않는다. 열림·높이·고른 탭은 이 브라우저에만 기억한다.
 * @contract 탭 목록은 /__spec/term/tabs.json을 3초마다 받는다. 일하는 담당은 탭이 되고(끝나면 사라진다), 끝난 담당은 "지난 담당" 목록에서 골라 지난 대화(읽기만)로 연다. 터미널은 /__spec/term/<요청 번호>/ 를 iframe으로 붙인다(비밀 값은 서버가 쥐고 있다). 탭을 처음 고를 때 연결하고 이후에는 숨기기만 한다. 사용자 차례(질문·막힘)인 탭에는 표시를 붙인다.
 * @does 담당 세션을 화면 안에서 터미널로 본다 | 맨 위 줄 "터미널" 단추를 누르면 화면 아래에 영역이 열리고 일하는 담당마다 탭이 보인다
 * @does 끝난 담당의 지난 대화를 다시 본다 | 영역의 "지난 담당"에서 고르면 터미널이 아니라 지난 대화가 탭으로 열린다
 * @does 터미널 영역의 높이를 바꾼다 | 영역 위 손잡이를 끌면 높이가 바뀌고 이 브라우저가 기억한다
 */
import { h, get, fmt } from './util.js';
import type { TermTabs } from '../types.js';

const KEY = 'term-dock';
interface Saved { open: boolean; height: number; tab: number }
const load = (): Saved => { try { return { open: false, height: 300, tab: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Saved> }; } catch { return { open: false, height: 300, tab: 0 }; } };
const save = (): void => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 못 기억해도 영역은 쓸 수 있다 */ } };
const st = load();

let data: TermTabs = { live: [], past: [], available: true, reason: '' };
/** 지난 대화를 열어 둔 요청 번호들(탭처럼 보인다. 탭 키는 음수) */
const logs: number[] = [];
const panes = new Map<string, HTMLElement>();
const buttons = new Set<HTMLElement>();
const dock = h('div', { class: 'tdock' });
dock.hidden = true;
const bar = h('div', { class: 'tdock-bar' });
const body = h('div', { class: 'tdock-body' });
const grip = h('div', { class: 'tdock-grip', title: '끌어서 높이를 바꿉니다' });
dock.append(grip, bar, body);

/** 지난 대화 한 칸(읽기만) */
function logPane(id: number): HTMLElement {
  const box = h('div', { class: 'tdock-log' }, h('div', { class: 'hint' }, '읽는 중…'));
  get<{ sid: string; turns: { role: string; at: string; text: string }[]; total: number }[]>(`/__spec/request/conversation.json?id=${id}`).then((list) => {
    box.replaceChildren(...list.flatMap((c) => [
      h('div', { class: 'hint' }, `세션 ${c.sid.slice(0, 8)} · 대화 ${c.total}줄${c.total > c.turns.length ? ` 중 마지막 ${c.turns.length}줄` : ''}`),
      ...c.turns.map((t) => h('div', { class: t.role === 'tool' ? 'hint' : 'quote' }, h('b', null, `${t.role === 'user' ? '받은 글' : t.role === 'agent' ? '에이전트' : '도구'}${t.at ? ` · ${fmt(t.at)}` : ''}`), ' ', t.text)),
    ]), ...(list.length ? [] : [h('div', { class: 'hint' }, '남은 대화가 없습니다.')]));
    box.scrollTop = box.scrollHeight;
  }).catch(() => box.replaceChildren(h('div', { class: 'hint' }, '대화를 읽지 못했습니다.')));
  return box;
}

const labelOf = (): string => `▣ 터미널${data.live.length ? ` ${data.live.length}` : ''}`;
const btnClass = (): string => `tdock-btn${st.open ? ' on' : ''}${data.live.some((t) => t.askingUser) ? ' ask' : ''}`;

/** 맨 위 줄에 놓는 열고 닫는 단추(맨 위 줄을 다시 그릴 때마다 새로 만든다) */
export function dockButton(): HTMLElement {
  const b = h('button', { class: btnClass(), title: '화면 아래 터미널 영역을 열고 닫습니다', onclick: () => { st.open = !st.open; save(); paint(); } }, labelOf());
  buttons.add(b);
  return b;
}

function paint(): void {
  const ids = new Set(data.live.map((t) => t.id));
  // 끝난 담당의 터미널은 닫고(탭이 사라진다) 연결도 끊는다
  for (const [k, el] of panes) { const [kind, n] = k.split(':'); if (kind === 't' && !ids.has(Number(n))) { el.remove(); panes.delete(k); } }
  const want = st.tab > 0 ? (ids.has(st.tab) ? st.tab : 0) : (logs.includes(-st.tab) ? st.tab : 0);
  const pick = want || data.live[0]?.id || (logs.length ? -logs[0] : 0);
  if (pick !== st.tab) { st.tab = pick; save(); }
  dock.hidden = !st.open;
  dock.style.height = `${st.height}px`;
  for (const b of buttons) { if (!b.isConnected) { buttons.delete(b); continue; } b.className = btnClass(); b.textContent = labelOf(); }
  const tab = (key: number, label: string, mark: string, onx?: () => void): HTMLElement => h('button', { class: `tdock-tab${st.tab === key ? ' on' : ''}${mark === ' ◆' ? ' ask' : ''}`, onclick: () => { st.tab = key; save(); paint(); } }, label, mark, onx ? h('span', { class: 'x', title: '닫기', onclick: (e: Event) => { e.stopPropagation(); onx(); } }, '✕') : null);
  const pastRows = data.past.filter((p) => !logs.includes(p.id));
  bar.replaceChildren(
    ...data.live.map((t) => tab(t.id, t.title, t.askingUser ? ' ◆' : ' ●')),
    ...logs.map((id) => tab(-id, `#${id} 지난 기록`, '', () => { logs.splice(logs.indexOf(id), 1); panes.get(`l:${id}`)?.remove(); panes.delete(`l:${id}`); paint(); })),
    ...(pastRows.length ? [h('select', { class: 'tdock-past', onchange: (e: Event) => { const el = e.target as HTMLSelectElement; const id = Number(el.value); el.value = ''; if (id) { logs.push(id); st.tab = -id; save(); paint(); } } }, h('option', { value: '' }, '지난 담당 ▾'), ...pastRows.map((p) => h('option', { value: String(p.id) }, `#${p.id} 담당`)))] : []),
    h('span', { class: 'grow', style: 'flex:1' }),
    h('button', { class: 'tdock-x', title: '접기', onclick: () => { st.open = false; save(); paint(); } }, '⌄ 접기'),
  );
  body.querySelector('.note')?.remove();
  if (!st.open) return;
  const note = (text: string): void => { body.append(h('div', { class: 'hint pad note' }, text)); };
  if (!data.available && data.live.length) { for (const el of panes.values()) el.hidden = true; note(`터미널을 열 수 없습니다: ${data.reason}`); return; }
  const show = (k: string, make: () => HTMLElement, on: boolean): void => {
    let el = panes.get(k);
    if (!el && on) { el = make(); panes.set(k, el); body.append(el); }
    if (el) el.hidden = !on;
  };
  for (const t of data.live) show(`t:${t.id}`, () => h('iframe', { class: 'tdock-term', src: `/__spec/term/${t.id}/`, title: `${t.title} 터미널` }), st.tab === t.id);
  for (const id of logs) show(`l:${id}`, () => logPane(id), st.tab === -id);
  if (!data.live.length && !logs.length) note('지금 일하는 담당 세션이 없습니다. 담당이 시작되면 탭이 생기고, 끝난 담당은 위 "지난 담당"에서 지난 기록으로 볼 수 있습니다.');
}

async function refresh(): Promise<void> {
  if (document.hidden) return;
  try {
    const next = await get<TermTabs>('/__spec/term/tabs.json');
    if (JSON.stringify(next) !== JSON.stringify(data)) { data = next; paint(); }
  } catch { /* 서버가 잠깐 없다 */ }
}

/** 영역을 화면 틀 바로 뒤에 붙이고 탭 목록을 지켜본다(한 번만 부른다) */
export function mountDock(afterEl: HTMLElement): void {
  afterEl.after(dock);
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('tdock-drag');
    const move = (ev: PointerEvent): void => { st.height = Math.max(120, Math.min(innerHeight - 160, innerHeight - ev.clientY)); dock.style.height = `${st.height}px`; };
    const up = (): void => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); document.body.classList.remove('tdock-drag'); save(); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });
  void refresh().then(paint);
  setInterval(() => { void refresh(); }, 3000);
}
