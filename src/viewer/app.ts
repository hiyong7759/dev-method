/**
 * @spec viewer-app 설계서 보기의 틀
 * @why 상단 내비게이션 하나로 모든 화면과 정보와 관리로 가게 한다. 주소(#)가 곧 지금 보는 곳이라 새로고침해도, 링크를 보내도 같은 곳이 열린다: 화면 흐름(#/map), 정보 흐름(#/info/<정보>), 화면 설계서(#/screen/<화면>?tab=…), 관리(#/manage, #/manage/<요청 번호>).
 * @basis 개발 모드 전용이다. 소스에서 계산한 모델을 읽어 그리고, 쓰기는 .spec의 승인·메모·확인 목록뿐이다. 모델은 2.5초마다 다시 받아 달라졌을 때만 그린다.
 * @contract 서버(middleware.ts)가 /__spec/model.json을 준다. 정보 흐름은 창 폭에 맞춰 상자를 줄바꿈해 놓으므로 창 폭이 달라지면 다시 그린다.
 */
import { h, get, statusChip, errorText } from './util.js';
import type { Kid } from './util.js';
import { mapView } from './map.js';
import { infoMap, infoDrawer, infoOverview } from './info.js';
import { screenView } from './screen.js';
import type { ScreenViewHandle } from './screen.js';
import { manageList } from './manage-list.js';
import { manageDetail } from './manage-detail.js';
import { hash, nav as go } from './route.js';
import type { Model } from '../types.js';

/** 설계서 보기 틀의 전부가 그려지는 자리 */
const root = document.getElementById('app') as HTMLElement;
let model: Model | null = null, active: (ScreenViewHandle & { name: string }) | null = null, key = '', topEl: HTMLElement | null = null, menu: HTMLElement | null = null;

/** 주소(#)를 읽은 결과: 어느 화면(view), 그 안의 대상(arg), 쿼리(params) */
interface Route { view: string; arg: string; params: URLSearchParams }
const parse = (): Route => {
  const [path, qs = ''] = (location.hash.slice(1) || '/map').split('?');
  const p = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { view: p[0] || 'map', arg: p[1] || '', params: new URLSearchParams(qs) };
};
// 상단 메뉴(화면 ▾, 정보 ▾): 누르면 목록이 열리고, 바깥을 누르면 닫힌다
function closeMenu(): void { menu?.remove(); menu = null; }
/** 메뉴를 닫고 이동한다 */
const nav = (hh: string, replace?: boolean): void => { closeMenu(); go(hh, replace); };
function openMenu(anchor: HTMLElement, items: Kid[]): void {
  const was = menu;
  closeMenu();
  if (was && was.dataset.for === anchor.dataset.k) return;
  const r = anchor.getBoundingClientRect();
  menu = h('div', { class: 'menu', dataset: { for: anchor.dataset.k ?? '' }, style: `left:${Math.min(r.left, innerWidth - 340)}px;top:${r.bottom + 6}px` }, items);
  document.body.append(menu);
}
document.addEventListener('click', (e) => { const t = e.target as HTMLElement; if (menu && !menu.contains(t) && !t.closest('[data-k]')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

/** 화면 ▾ 메뉴의 목록(분야별 묶음, 상태 이름표 포함) */
function screenMenuItems(m: Model, cur: string): Kid[] {
  const groups = [...new Set(m.screens.map((s) => s.domain || '기타'))];
  return groups.map((g) => [
    groups.length > 1 ? h('div', { class: 'mgroup' }, g) : null,
    m.screens.filter((s) => (s.domain || '기타') === g).map((s) => h('button', { class: `mitem${s.name === cur ? ' cur' : ''}`, onclick: () => nav(hash('screen', s.name)) },
      h('span', null, s.name), statusChip(s.status, ['test-requested', 'approved-changed'].includes(s.status.status) ? ' pulse' : ''))),
  ]);
}
/** 정보 ▾ 메뉴의 목록 */
const infoMenuItems = (m: Model, cur: string): Kid[] => (m.infos.length ? m.infos.map((i) => h('button', { class: `mitem${i.name === cur ? ' cur' : ''}`, onclick: () => nav(hash('info', i.name)) }, h('span', { class: 'mono' }, i.name), i.flagged ? h('span', { style: 'color:var(--amber);font-size:11px' }, `확인 ${i.flagged}`) : null)) : [h('div', { class: 'mitem' }, '정보가 없다')]);

/** 맨 위 줄: 현행 | 관리 전환, 그 영역의 메뉴, 지금 상태 */
function topbar(m: Model, r: Route): HTMLElement {
  const s = m.summary;
  const first = m.screens.find((x) => ['test-requested', 'approved-changed'].includes(x.status.status));
  const curScreen = r.view === 'screen' ? r.arg : '';
  const curInfo = r.view === 'info' ? r.arg : '';
  const chips = [
    s.waiting ? h('button', { class: 'pill accent', onclick: () => { if (first) nav(hash('screen', first.name, { tab: 'approval' })); } }, '승인 대기 ', h('b', { style: 'color:var(--accent)' }, s.waiting), h('small', null, `테스트 요청 ${s.testRequested} · 승인 후 변경 ${s.changedAfterApproval}`)) : null,
    s.memosUndelivered ? h('span', { class: 'pill purple' }, '전달 전 메모 ', h('b', { style: 'color:var(--purple)' }, s.memosUndelivered)) : null,
    h('span', { class: 'pill warn' }, '확인 필요 ', h('b', null, r.view === 'info' ? m.infos.reduce((a, i) => a + i.flagged, 0) : s.needCheck))];
  const curModel = curScreen ? m.screens.find((x) => x.name === curScreen) : null;
  const seg = h('div', { class: 'seg' }, h('button', { class: r.view === 'manage' ? '' : 'on', onclick: () => nav(hash('map')) }, '현행'), h('button', { class: r.view === 'manage' ? 'on' : '', onclick: () => nav(hash('manage')) }, '관리'));
  if (r.view === 'manage') {
    return h('header', { class: 'top tall' }, h('span', { class: 'dev mono' }, 'DEV'), h('span', { class: 'ttl' }, m.project), seg,
      h('div', { class: 'tabs-top' }, h('button', { class: 'sel', onclick: () => nav(hash('manage')) }, '요청')),
      h('span', { class: 'grow' }), s.requestsMine ? h('span', { class: 'pill accent' }, '내 차례 ', h('b', { style: 'color:var(--accent)' }, s.requestsMine)) : null);
  }
  return h('header', { class: 'top tall' }, h('span', { class: 'dev mono' }, 'DEV'), h('span', { class: 'ttl' }, m.project), seg,
    h('div', { class: 'tabs-top' },
      h('button', { class: r.view === 'map' ? 'sel' : '', onclick: () => nav(hash('map')) }, '화면 흐름'),
      h('button', { class: r.view === 'info' && !curInfo ? 'sel' : '', onclick: () => nav(hash('info')) }, '정보 흐름'),
      h('button', { class: `nav-dd${r.view === 'screen' ? ' sel' : ''}`, dataset: { k: 'screens' }, onclick: (e) => openMenu(e.currentTarget as HTMLElement, screenMenuItems(m, curScreen)) }, curScreen || '화면', h('span', { class: 'caret' }, '▾')),
      h('button', { class: `nav-dd${curInfo ? ' sel' : ''}`, dataset: { k: 'infos' }, onclick: (e) => openMenu(e.currentTarget as HTMLElement, infoMenuItems(m, curInfo)) }, curInfo || '정보', h('span', { class: 'caret' }, '▾'))),
    curModel ? statusChip(curModel.status, ['test-requested', 'approved-changed'].includes(curModel.status.status) ? ' pulse' : '') : null,
    h('span', { class: 'grow' }), chips);
}

/** 주소에 맞는 화면을 그린다 */
function render(): void {
  const r = parse();
  closeMenu();
  if (active && model && r.view === 'screen' && active.name === r.arg) { active.setScreen(r.arg, r.params.get('tab')); topEl?.replaceWith(topEl = topbar(model, r)); return; }
  if (active) { active.destroy(); active = null; }
  root.replaceChildren();
  if (!model) return;
  const m = model;
  topEl = topbar(m, r);
  root.append(topEl);
  const body = h('div', { class: r.view === 'screen' ? 'split' : 'map-col', style: r.view === 'screen' ? '' : 'flex:1;display:flex;flex-direction:column;min-height:0' });
  root.append(body);
  if (r.view === 'screen') {
    if (!m.screens.find((s) => s.name === r.arg)) { body.append(h('div', { class: 'empty-note', style: 'flex:1' }, `화면 "${r.arg}"을 찾지 못했다`)); return; }
    const v = screenView(body, { model: m, name: r.arg, tab: r.params.get('tab'), at: r.params.get('at'), go: (n, t, at) => { nav(hash('screen', n, { tab: t, at }), true); topEl?.replaceWith(topEl = topbar(m, parse())); } });
    active = { name: r.arg, ...v };
  } else if (r.view === 'info') {
    const sel = r.arg || '';
    infoMap(body, m, {
      selected: sel, onSelect: (n) => nav(hash('info', n === sel ? '' : n)),
      drawer: sel ? infoDrawer(m, sel, { onClose: () => nav(hash('info')), openInfo: (n) => nav(hash('info', n)) }) : infoOverview(m, { openInfo: (n) => nav(hash('info', n)) }),
    });
  } else if (r.view === 'manage') {
    if (r.arg) manageDetail(body, { model: m, id: r.arg });
    else manageList(body, { model: m });
  } else {
    mapView(body, { model: m, domain: r.params.get('domain') || '' });
  }
}

/** 서버에서 모델을 받아 달라졌을 때만 다시 그린다 */
async function load(initial: boolean): Promise<void> {
  const m = await get<Model>('/__spec/model.json');
  if (model && m.generatedAt < model.generatedAt) return;
  const k = JSON.stringify({ ...m, generatedAt: 0 });
  if (!initial && k === key) return;
  key = k; model = m;
  const r = parse();
  if (active && r.view === 'screen') { active.update(m); if (!menu) topEl?.replaceWith(topEl = topbar(m, r)); } else render();
}
window.addEventListener('hashchange', render);
// 정보 흐름은 창 폭에 맞춰 상자를 줄바꿈해 놓으므로, 창 크기가 바뀌면(폭이 달라졌을 때만) 다시 배치한다
let lastW = window.innerWidth, resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = window.setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (parse().view === 'info') render(); } }, 150); });
load(true).then(() => { render(); setInterval(() => { load(false).catch(() => {}); }, 2500); }).catch((e: unknown) => { root.append(h('div', { class: 'empty-note' }, `모델을 읽지 못했다: ${errorText(e)}`)); });
