// 설계서 보기 — 주소(#)로 세 화면을 고른다: 화면 흐름(#/map), 정보 흐름(#/info/<정보>), 화면 설계서(#/screen/<화면>?tab=…).
// 개발 모드 전용. 소스에서 계산한 모델을 읽어 그리고, 쓰기는 .spec의 승인·메모·확인 목록뿐이다.
import { h, get } from './util.js';
import { mapView } from './map.js';
import { infoMap, infoDrawer } from './info.js';
import { screenView } from './screen.js';

const root = document.getElementById('app');
const q = new URLSearchParams(location.search);
let appPath = q.get('at') || sessionStorage.getItem('spec-app-path') || '/';
try { sessionStorage.setItem('spec-app-path', appPath); } catch { /* 저장소가 막힌 환경 */ }
let model = null, active = null, key = '', topEl = null;

const parse = () => {
  const [path, qs = ''] = (location.hash.slice(1) || '/map').split('?');
  const p = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { view: p[0] || 'map', arg: p[1] || '', params: new URLSearchParams(qs) };
};
const hash = (view, arg = '', params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `#/${view}${arg ? `/${encodeURIComponent(arg)}` : ''}${qs ? `?${qs}` : ''}`;
};
const nav = (hh, replace) => { if (replace) history.replaceState(null, '', hh); else location.hash = hh; };
const toApp = (p) => { location.href = p && p !== '/__spec/' ? p : appPath; };

function topbar(r) {
  const s = model.summary;
  if (r.view === 'screen') {
    return h('header', { class: 'top' }, h('span', { class: 'dev mono' }, 'DEV'), h('div', { class: 'crumb' }, h('a', { onclick: () => nav(hash('map')) }, '화면 흐름'), h('span', null, '›'), h('b', null, r.arg)), h('span', { class: 'grow' }),
      h('button', { class: 'pill', onclick: () => nav(hash('map')) }, '전체 지도 ↗'));
  }
  const first = model.screens.find((x) => ['test-requested', 'approved-changed'].includes(x.status.status));
  const chips = r.view === 'info' ? [
    h('span', { class: 'pill' }, '정보 ', h('b', null, model.infos.length)), h('span', { class: 'pill' }, '관계 ', h('b', null, model.relations.length)),
    h('span', { class: 'pill warn' }, '확인 필요 ', h('b', null, model.infos.reduce((a, i) => a + i.flagged, 0)))] : [
    s.waiting ? h('button', { class: 'pill accent', onclick: () => first && nav(hash('screen', first.name, { tab: 'approval' })) }, '승인 대기 ', h('b', { style: 'color:var(--accent)' }, s.waiting), h('small', null, `테스트 요청 ${s.testRequested} · 승인 후 변경 ${s.changedAfterApproval}`)) : null,
    s.memosUndelivered ? h('span', { class: 'pill purple' }, '에이전트에 전달 전 메모 ', h('b', { style: 'color:var(--purple)' }, s.memosUndelivered)) : null,
    h('span', { class: 'pill' }, '화면 ', h('b', null, s.screens)), h('span', { class: 'pill' }, '이동 ', h('b', null, s.moves)), h('span', { class: 'pill warn' }, '확인 필요 ', h('b', null, s.needCheck))];
  return h('header', { class: 'top tall' }, h('span', { class: 'dev mono' }, 'DEV'), h('span', { class: 'ttl' }, '전체 지도'), h('span', { class: 'sub mono' }, model.project),
    h('div', { class: 'tabs-top', style: 'margin-left:20px' },
      h('button', { class: r.view === 'map' ? 'sel' : '', onclick: () => nav(hash('map')) }, '화면 흐름'), h('button', { class: r.view === 'info' ? 'sel' : '', onclick: () => nav(hash('info')) }, '정보 흐름')),
    h('span', { class: 'grow' }), chips, h('button', { class: 'pill', onclick: () => toApp() }, '앱으로 ↗'));
}

function render() {
  const r = parse();
  if (active && r.view === 'screen' && active.name === r.arg) { active.setScreen(r.arg, r.params.get('tab')); return; }
  if (active) { active.destroy(); active = null; }
  root.replaceChildren();
  if (!model) return;
  topEl = topbar(r); root.append(topEl);
  const body = h('div', { class: r.view === 'screen' ? 'split' : 'map-col', style: r.view === 'screen' ? '' : 'flex:1;display:flex;flex-direction:column;min-height:0' });
  root.append(body);
  if (r.view === 'screen') {
    if (!model.screens.find((s) => s.name === r.arg)) { body.append(h('div', { class: 'empty-note', style: 'flex:1' }, `화면 "${r.arg}"을 찾지 못했다`)); return; }
    const v = screenView(body, { model, name: r.arg, tab: r.params.get('tab'), at: r.params.get('at'), go: (n, t, at) => { nav(hash('screen', n, { tab: t, at }), true); topEl.replaceWith(topEl = topbar(parse())); }, toMap: () => nav(hash('map')), toApp });
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
  if (active && r.view === 'screen') active.update(m); else render();
}
window.addEventListener('hashchange', render);
load(true).then(() => { render(); setInterval(() => load(false).catch(() => {}), 2500); }).catch((e) => { root.append(h('div', { class: 'empty-note' }, `모델을 읽지 못했다: ${e.message}`)); });
