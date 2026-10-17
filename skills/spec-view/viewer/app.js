// 설계서 보기 — 주소(#)로 세 화면을 고른다: 화면 흐름(#/map), 정보 흐름(#/info/<정보>), 화면 설계서(#/screen/<화면>?tab=…).
// 상단 내비게이션 하나로 모든 화면과 정보에 간다. 개발 모드 전용. 소스에서 계산한 모델을 읽어 그리고, 쓰기는 .spec의 승인·메모·확인 목록뿐이다.
import { h, get, statusChip } from './util.js';
import { mapView } from './map.js';
import { infoMap, infoDrawer } from './info.js';
import { screenView } from './screen.js';

const root = document.getElementById('app');
let model = null, active = null, key = '', topEl = null, menu = null;

const parse = () => {
  const [path, qs = ''] = (location.hash.slice(1) || '/map').split('?');
  const p = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { view: p[0] || 'map', arg: p[1] || '', params: new URLSearchParams(qs) };
};
const hash = (view, arg = '', params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `#/${view}${arg ? `/${encodeURIComponent(arg)}` : ''}${qs ? `?${qs}` : ''}`;
};
const nav = (hh, replace) => { closeMenu(); if (replace) history.replaceState(null, '', hh); else location.hash = hh; };

// 상단 메뉴(화면 ▾, 정보 ▾): 누르면 목록이 열리고, 바깥을 누르면 닫힌다
function closeMenu() { menu?.remove(); menu = null; }
function openMenu(anchor, items) {
  const was = menu; closeMenu(); if (was && was.dataset.for === anchor.dataset.k) return;
  const r = anchor.getBoundingClientRect();
  menu = h('div', { class: 'menu', dataset: { for: anchor.dataset.k }, style: `left:${Math.min(r.left, innerWidth - 340)}px;top:${r.bottom + 6}px` }, items);
  document.body.append(menu);
}
document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('[data-k]')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

function screenMenuItems(cur) {
  const groups = [...new Set(model.screens.map((s) => s.domain || '기타'))];
  return groups.map((g) => [
    groups.length > 1 ? h('div', { class: 'mgroup' }, g) : null,
    model.screens.filter((s) => (s.domain || '기타') === g).map((s) => h('button', { class: `mitem${s.name === cur ? ' cur' : ''}`, onclick: () => nav(hash('screen', s.name)) },
      h('span', null, s.name), statusChip(s.status, ['test-requested', 'approved-changed'].includes(s.status.status) ? ' pulse' : ''))),
  ]);
}
const infoMenuItems = (cur) => (model.infos.length ? model.infos.map((i) => h('button', { class: `mitem${i.name === cur ? ' cur' : ''}`, onclick: () => nav(hash('info', i.name)) }, h('span', { class: 'mono' }, i.name), i.flagged ? h('span', { style: 'color:var(--amber);font-size:11px' }, `확인 ${i.flagged}`) : null)) : [h('div', { class: 'mitem' }, '정보가 없다')]);

function topbar(r) {
  const s = model.summary;
  const first = model.screens.find((x) => ['test-requested', 'approved-changed'].includes(x.status.status));
  const curScreen = r.view === 'screen' ? r.arg : '';
  const curInfo = r.view === 'info' ? r.arg : '';
  const chips = [
    s.waiting ? h('button', { class: 'pill accent', onclick: () => first && nav(hash('screen', first.name, { tab: 'approval' })) }, '승인 대기 ', h('b', { style: 'color:var(--accent)' }, s.waiting), h('small', null, `테스트 요청 ${s.testRequested} · 승인 후 변경 ${s.changedAfterApproval}`)) : null,
    s.memosUndelivered ? h('span', { class: 'pill purple' }, '전달 전 메모 ', h('b', { style: 'color:var(--purple)' }, s.memosUndelivered)) : null,
    h('span', { class: 'pill warn' }, '확인 필요 ', h('b', null, r.view === 'info' ? model.infos.reduce((a, i) => a + i.flagged, 0) : s.needCheck))];
  const curModel = curScreen ? model.screens.find((x) => x.name === curScreen) : null;
  return h('header', { class: 'top tall' }, h('span', { class: 'dev mono' }, 'DEV'), h('span', { class: 'ttl' }, model.project),
    h('div', { class: 'tabs-top' },
      h('button', { class: r.view === 'map' ? 'sel' : '', onclick: () => nav(hash('map')) }, '화면 흐름'),
      h('button', { class: r.view === 'info' && !curInfo ? 'sel' : '', onclick: () => nav(hash('info')) }, '정보 흐름'),
      h('button', { class: `nav-dd${r.view === 'screen' ? ' sel' : ''}`, dataset: { k: 'screens' }, onclick: (e) => openMenu(e.currentTarget, screenMenuItems(curScreen)) }, curScreen || '화면', h('span', { class: 'caret' }, '▾')),
      h('button', { class: `nav-dd${curInfo ? ' sel' : ''}`, dataset: { k: 'infos' }, onclick: (e) => openMenu(e.currentTarget, infoMenuItems(curInfo)) }, curInfo || '정보', h('span', { class: 'caret' }, '▾'))),
    curModel ? statusChip(curModel.status, ['test-requested', 'approved-changed'].includes(curModel.status.status) ? ' pulse' : '') : null,
    h('span', { class: 'grow' }), chips);
}

function render() {
  const r = parse();
  closeMenu();
  if (active && r.view === 'screen' && active.name === r.arg) { active.setScreen(r.arg, r.params.get('tab')); topEl.replaceWith(topEl = topbar(r)); return; }
  if (active) { active.destroy(); active = null; }
  root.replaceChildren();
  if (!model) return;
  topEl = topbar(r); root.append(topEl);
  const body = h('div', { class: r.view === 'screen' ? 'split' : 'map-col', style: r.view === 'screen' ? '' : 'flex:1;display:flex;flex-direction:column;min-height:0' });
  root.append(body);
  if (r.view === 'screen') {
    if (!model.screens.find((s) => s.name === r.arg)) { body.append(h('div', { class: 'empty-note', style: 'flex:1' }, `화면 "${r.arg}"을 찾지 못했다`)); return; }
    const v = screenView(body, { model, name: r.arg, tab: r.params.get('tab'), at: r.params.get('at'), go: (n, t, at) => { nav(hash('screen', n, { tab: t, at }), true); topEl.replaceWith(topEl = topbar(parse())); } });
    active = { name: r.arg, ...v };
  } else if (r.view === 'info') {
    const sel = r.arg || '';
    infoMap(body, model, {
      selected: sel, onSelect: (n) => nav(hash('info', n === sel ? '' : n)),
      drawer: sel ? infoDrawer(model, sel, { onClose: () => nav(hash('info')), openInfo: (n) => nav(hash('info', n)), openScreen: (n) => nav(hash('screen', n)) }) : null,
    });
  } else {
    mapView(body, { model, domain: r.params.get('domain') || '', setDomain: (d) => nav(hash('map', '', { domain: d })), openScreen: (n) => nav(hash('screen', n)) });
  }
}

async function load(initial) {
  const m = await get('/__spec/model.json');
  if (model && m.generatedAt < model.generatedAt) return;
  const k = JSON.stringify({ ...m, generatedAt: 0 });
  if (!initial && k === key) return;
  key = k; model = m;
  const r = parse();
  if (active && r.view === 'screen') { active.update(m); if (!menu) topEl.replaceWith(topEl = topbar(r)); } else render();
}
window.addEventListener('hashchange', render);
load(true).then(() => { render(); setInterval(() => load(false).catch(() => {}), 2500); }).catch((e) => { root.append(h('div', { class: 'empty-note' }, `모델을 읽지 못했다: ${e.message}`)); });
