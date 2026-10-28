/**
 * @spec viewer-app 설계서 보기의 틀
 * @why 상단 내비게이션 하나로 모든 화면과 정보와 관리로 가게 한다. 주소(#)가 곧 지금 보는 곳이라 새로고침해도, 링크를 보내도 같은 곳이 열린다: 사용 흐름(#/flow), 정보 흐름(#/info/<정보>), 화면 설계서(#/screen/<화면>?tab=…), 관리(#/manage, #/manage/<요청 번호>).
 * @basis 개발 모드 전용이다. 소스에서 계산한 모델을 읽어 그리고, 쓰기는 .spec의 승인·메모·확인 목록뿐이다. 모델은 2.5초마다 다시 받아 달라졌을 때만 그리고, 그릴 때 보던 자리·펼침·입력은 keep-ui.ts로 지킨다.
 * @contract 서버(middleware.ts)가 /__spec/model.json을 준다. 정보 흐름은 창 폭에 맞춰 상자를 줄바꿈해 놓으므로 창 폭이 달라지면 다시 그린다.
 * @does 여러 프로젝트를 띄워 두고 어느 프로젝트인지 알아본다 | 탭 제목이 "프로젝트 이름 · 설계서 보기"이고 머리글에 프로젝트 색 띠와 아이콘·이름이 보이며 탭 아이콘도 같은 색이다 | 여러 프로젝트를 구분한다#1
 * @does 도구 소스를 고친 뒤 서버가 아직 옛 코드로 떠 있을 때 설계서 보기를 연다 | 맨 위 줄 위에 안내 색 "서버가 옛 코드라 새 코드로 다시 띄우는 중입니다" 띠가 보이고(명령은 보이지 않는다), 서버가 새 코드로 다시 뜨면 저절로 새 화면으로 바뀐다 | 서버가 옛 코드로 떠 있는지 알아챈다#1
 */
import { h, get, tag, errorText } from './util.js';
import type { Kid } from './util.js';
import { flowView } from './flow.js';
import { infoMap, infoDrawer, infoOverview } from './info.js';
import type { InfoFilter } from './info.js';
import { screenView } from './screen.js';
import type { ScreenViewHandle } from './screen.js';
import { manageList } from './manage-list.js';
import { manageDetail } from './manage-detail.js';
import { reportsView } from './reports.js';
import { designStatusView } from './design-status.js';
import { glossaryView } from './glossary.js';
import { hash, nav as go } from './route.js';
import { themeMode, applyTheme, THEME_MODES } from './theme.js';
import { markTerms } from './terms.js';
import { snapshot, restore } from './keep-ui.js';
import { commentTool } from './comment.js';
import type { CommentTool } from './comment.js';
import { dockButton, mountDock } from './terminal-dock.js';
import type { Brand, Model } from '../types.js';

/** 설계서 보기 틀의 전부가 그려지는 자리 */
const root = document.getElementById('app') as HTMLElement;
// 화면 아래 터미널 영역: 화면을 다시 그려도 연결이 끊기지 않게 #app 밖에 한 번만 붙인다
mountDock(root);
let commentUi: CommentTool | null = null;
/** 서버가 잠깐 응답하지 않는 중인지, 처음 받은 서버의 코드 표(바뀌면 서버가 새로 떴다는 뜻) */
let down = false, loaded = false, seenStamp: string | undefined;
let model: Model | null = null, active: (ScreenViewHandle & { name: string; tr: string }) | null = null, key = '', topEl: HTMLElement | null = null, menu: HTMLElement | null = null;

/** 주소(#)를 읽은 결과: 어느 화면(view), 그 안의 대상(arg), 그 아래 쪽(sub), 쿼리(params) */
interface Route { view: string; arg: string; sub: string; params: URLSearchParams }
const parse = (): Route => {
  const [path, qs = ''] = (location.hash.slice(1) || '/flow').split('?');
  const p = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(qs);
  if (p[0] === 'manage' && (p[1] === 'reports' || p[1] === 'glossary' || p[1] === 'designs')) return { view: p[1], arg: '', sub: '', params };
  return { view: p[0] || 'flow', arg: p[1] || '', sub: p[2] || '', params };
};
// 상단 메뉴(화면 ▾, 정보 ▾, 밝기): 누르면 목록이 열리고, 바깥을 누르면 닫힌다
function closeMenu(): void { menu?.remove(); menu = null; }
/** 메뉴를 닫고 이동한다 */
const nav = (hh: string, replace?: boolean): void => { closeMenu(); go(hh, replace); };
function openMenu(anchor: HTMLElement, items: Kid[], narrow = false): void {
  const was = menu;
  closeMenu();
  if (was && was.dataset.for === anchor.dataset.k) return;
  const r = anchor.getBoundingClientRect();
  menu = h('div', { class: `menu${narrow ? ' narrow' : ''}`, dataset: { for: anchor.dataset.k ?? '' }, style: `left:${Math.min(r.left, innerWidth - (narrow ? 170 : 340))}px;top:${r.bottom + 6}px` }, items);
  document.body.append(menu);
}
document.addEventListener('click', (e) => { const t = e.target as HTMLElement; if (menu && !menu.contains(t) && !t.closest('[data-k]')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

/** 밝기 단추(◐): 누르면 다크·라이트·시스템 세 줄이 펼쳐진다. 상단 바 맨 오른쪽 */
function themeButton(): HTMLElement {
  return h('button', { class: 'tbtn', title: '화면 밝기', dataset: { k: 'theme' }, onclick: (e) => {
    const cur = themeMode();
    openMenu(e.currentTarget as HTMLElement, THEME_MODES.map((t) => h('button', { class: `mitem${t.key === cur ? ' cur' : ''}`, onclick: () => { applyTheme(t.key); closeMenu(); } }, h('span', null, t.label), t.key === cur ? h('small', null, '✓') : null)), true);
  } }, '◐');
}

/** 화면 ▾ 메뉴의 목록(분야별 묶음) */
function screenMenuItems(m: Model, cur: string): Kid[] {
  const groups = [...new Set(m.screens.map((s) => s.domain || '기타'))];
  return groups.map((g) => [
    groups.length > 1 ? h('div', { class: 'mgroup' }, g) : null,
    m.screens.filter((s) => (s.domain || '기타') === g).map((s) => h('button', { class: `mitem${s.name === cur ? ' cur' : ''}`, onclick: () => nav(hash('screen', s.name)) }, h('span', null, s.name))),
  ]);
}
/** 정보 ▾ 메뉴의 목록 */
const infoMenuItems = (m: Model, cur: string): Kid[] => (m.infos.length ? m.infos.map((i) => h('button', { class: `mitem${i.name === cur ? ' cur' : ''}`, onclick: () => nav(hash('info', i.name)) }, h('span', { class: 'mono' }, i.name), i.kind === 'internal' ? tag('', '내부') : null)) : [h('div', { class: 'mgroup' }, '정보가 없다')]);

const STALE_TEXT = '서버가 옛 코드라 새 코드로 다시 띄우는 중입니다 — 잠시 뒤 저절로 새 화면으로 바뀝니다';

/** 모델에 brand가 없는 옛 서버로도 화면이 열리게, 없으면 프로젝트 이름·기본 색·기본 아이콘으로 대신한다 */
const brandOf = (m: Model): Brand => m.brand ?? { name: m.project || '설계서 보기', color: '#7c83ff', icon: '◆' };

/** 탭 아이콘을 프로젝트 색 바탕에 아이콘을 얹은 그림으로 바꾼다 */
function setFavicon(b: Brand): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${b.color}"/><text x="16" y="23" font-size="19" text-anchor="middle">${b.icon}</text></svg>`;
  let l = document.querySelector<HTMLLinkElement>('link[rel=icon]');
  if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.append(l); }
  l.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 맨 위 줄: DEV · 프로젝트 · 현행|관리 · 그 영역의 메뉴 · 내 차례 · 밝기 단추. 확인 필요·승인·메모 개수는 올리지 않는다 */
function topbar(m: Model, r: Route): HTMLElement {
  const s = m.summary;
  const manage = ['manage', 'reports', 'glossary', 'designs'].includes(r.view);
  const seg = h('div', { class: 'seg' }, h('button', { class: manage ? '' : 'on', onclick: () => nav(hash('flow')) }, '현행'), h('button', { class: manage ? 'on' : '', onclick: () => nav(hash('manage')) }, '관리'));
  const mine = s.requestsMine ? h('a', { class: 'pill go', href: hash('manage'), title: '요청 목록에서 내 차례인 요청을 봅니다' }, '내 차례 ', h('b', null, s.requestsMine)) : null;
  const item = (label: Kid, on: boolean, to: string): HTMLElement => h('button', { class: on ? 'sel' : '', onclick: () => nav(to) }, label);
  const menuBtn = (label: string, key: string, on: boolean, items: () => Kid[]): HTMLElement => h('button', { class: `nav-dd${on ? ' sel' : ''}`, dataset: { k: key }, onclick: (e) => openMenu(e.currentTarget as HTMLElement, items()) }, label, h('span', { class: 'caret' }, '▾'));
  const nav2 = manage
    ? h('div', { class: 'tabs-top' }, item('요청', r.view === 'manage', hash('manage')), item(['리포트', s.reportsOpen ? h('b', { class: 'cnt' }, s.reportsOpen) : null], r.view === 'reports', hash('manage', 'reports')), item('용어집', r.view === 'glossary', hash('manage', 'glossary')), item('시안 현황', r.view === 'designs', hash('manage', 'designs')))
    : h('div', { class: 'tabs-top' }, item('사용 흐름', r.view === 'flow', hash('flow')), item('정보 흐름', r.view === 'info' && !r.arg, hash('info')),
      menuBtn('화면', 'screens', r.view === 'screen', () => screenMenuItems(m, r.view === 'screen' ? r.arg : '')), menuBtn('정보', 'infos', r.view === 'info' && !!r.arg, () => infoMenuItems(m, r.view === 'info' ? r.arg : '')));
  const b = brandOf(m);
  document.title = `${b.name} · 설계서 보기${m.testEnv ? ` (${m.testEnv})` : ''}`;
  setFavicon(b);
  return h('header', { class: 'top', style: `--brand:${b.color}` }, h('span', { class: 'dev mono' }, 'DEV'), m.testEnv ? h('span', { class: 'testenv', title: '운영 요청·리포트가 아닌 저장소 밖 테스트 데이터로 띄운 화면입니다' }, m.testEnv) : null, h('span', { class: 'ttl' }, h('span', { class: 'brand-icon' }, b.icon), ' ', b.name), seg, nav2, h('span', { class: 'grow' }), mine, dockButton(), themeButton());
}

/** 주소에 맞는 화면을 그린다 */
function render(): void {
  const r = parse();
  closeMenu();
  // 요청 목록의 거르기·보기를 기억해 두면, 요청 상세에서 "요청"으로 돌아올 때 보던 그대로 열린다
  if (r.view === 'manage' && !r.arg) { try { sessionStorage.setItem('mg-last', location.hash || '#/manage'); } catch { /* 못 기억해도 목록은 열린다 */ } }
  if (active && model && r.view === 'screen' && active.name === r.arg && active.tr === (r.params.get('tr') ?? '')) { active.setScreen(r.arg, r.params.get('tab')); topEl?.replaceWith(topEl = topbar(model, r)); return; }
  if (active) { active.destroy(); active = null; }
  root.replaceChildren();
  document.documentElement.style.removeProperty('--ph-h');
  if (!model) return;
  const m = model;
  topEl = topbar(m, r);
  // 서버가 옛 코드라 도구가 다시 띄우는 중이면 맨 위 줄 위에 안내한다(명령은 보이지 않는다. 새로 뜨면 저절로 새로고침한다)
  if (m.serverStale || down) root.append(h('div', { class: 'srv-stale' }, STALE_TEXT));
  root.append(topEl);
  const body = h('div', { class: r.view === 'screen' ? 'split' : 'map-col', style: r.view === 'screen' ? '' : 'flex:1;display:flex;flex-direction:column;min-height:0;overflow:auto' });
  root.append(body);
  const again = (): void => { void load(true).then(() => render()); };
  if (r.view === 'screen') {
    if (!m.screens.find((s) => s.name === r.arg)) { body.append(h('div', { class: 'empty-note', style: 'flex:1' }, `화면 "${r.arg}"을 찾지 못했다`)); return; }
    const v = screenView(body, { model: m, name: r.arg, tab: r.params.get('tab'), at: r.params.get('at'), go: (n, t, at) => { const q = parse().params; nav(hash('screen', n, { tab: t, at, tr: q.get('tr') ?? undefined, ts: q.get('ts') ?? undefined, tn: q.get('tn') ?? undefined }), true); topEl?.replaceWith(topEl = topbar(m, parse())); } });
    active = { name: r.arg, tr: r.params.get('tr') ?? '', ...v };
  } else if (r.view === 'info') {
    const sel = r.arg || '';
    const kind = (['screen', 'internal', 'review'].includes(r.params.get('kind') ?? '') ? r.params.get('kind') : 'all') as InfoFilter;
    const domain = r.params.get('domain') || '';
    const keep = { kind: kind === 'all' ? undefined : kind, domain: domain || undefined };
    infoMap(body, m, {
      selected: sel, filter: kind, domain, onFilter: (f) => nav(hash('info', sel, { ...keep, kind: f === 'all' ? undefined : f })), onDomain: (d) => nav(hash('info', '', { kind: keep.kind, domain: d || undefined })), onSelect: (n) => nav(hash('info', n === sel ? '' : n, keep)),
      drawer: sel ? infoDrawer(m, sel, { onClose: () => nav(hash('info', '', keep)), openInfo: (n) => nav(hash('info', n, keep)) }) : infoOverview(m, { openInfo: (n) => nav(hash('info', n, keep)) }),
    });
  } else if (r.view === 'manage') {
    if (r.arg) manageDetail(body, { model: m, id: r.arg, sub: r.sub, onChange: again });
    else manageList(body, { model: m, kind: r.params.get('kind') || '', onChange: again });
  } else if (r.view === 'reports') {
    reportsView(body, { model: m, onChange: again, no: Number(r.params.get('no')) || 0, from: r.params.get('from') || '' });
  } else if (r.view === 'designs') {
    designStatusView(body, { model: m, kind: r.params.get('kind') || '' });
  } else if (r.view === 'glossary') {
    glossaryView(body, { model: m, term: r.params.get('term') || '' });
  } else {
    flowView(body, { model: m, domain: r.params.get('domain') || '', kind: r.params.get('kind') || '', selected: r.params.get('sc') || '', onChange: again });
  }
}

/** 보고 있는 화면(요청·리포트·용어집·시안 현황·사용 흐름·정보 흐름) 데이터가 달라졌음을 알리는 알약. 누르면 새 내용으로 다시 그린다 */
function showFresh(): void {
  if (document.getElementById('fresh-pill')) return;
  const pill = h('button', { id: 'fresh-pill', class: 'btn sm fresh', onclick: () => { pill.remove(); render(); } }, '새 내용이 있습니다 · 눌러서 새로 고침');
  document.body.append(pill);
}

/** 서버에서 모델을 받아 달라졌을 때만 다시 그린다 */
async function load(initial: boolean): Promise<void> {
  const m = await get<Model>('/__spec/model.json');
  // 서버가 새 코드로 다시 떴으면(코드 표가 달라짐) 새 화면 코드로 바꾸려고 저절로 새로고침한다
  if (loaded && m.serverStamp !== seenStamp) { location.reload(); return; }
  loaded = true; seenStamp = m.serverStamp; down = false;
  if (!m.serverStale) root.querySelector('.srv-stale')?.remove();
  if (model && m.generatedAt < model.generatedAt) return;
  const k = JSON.stringify({ ...m, generatedAt: 0, comments: 0 });
  // 화면 설계서의 '실제 화면' 안(iframe)에서는 바깥 창의 코멘트 도구가 이미 있어, 안쪽에 하나 더 띄우면 겹쳐 보인다
  const framed = window.parent !== window;
  if (!commentUi && !framed) commentUi = commentTool(m); else commentUi?.update(m);
  if (!initial && k === key) return;
  key = k; model = m;
  const r = parse();
  if (active && r.view === 'screen') { active.update(m); if (!menu) topEl?.replaceWith(topEl = topbar(m, r)); return; }
  // 화면(screen)처럼 제자리 갱신하는 곳을 뺀 모든 화면은 2.5초마다 다시 그리면 깜빡이고 읽던 자리가 위로 올라가므로, 데이터만 달라졌을 때는 그리지 않고 "새 내용이 있다"는 알약만 띄운다(누르면 그때 다시 그린다)
  if (!initial && r.view !== 'screen') { showFresh(); return; }
  document.getElementById('fresh-pill')?.remove();
  // 같은 주소에서 데이터만 달라져 다시 그릴 때는 보던 자리·펼침·입력을 지킨다
  const snap = initial ? null : snapshot(root);
  render();
  if (snap) restore(root, snap);
}
window.addEventListener('hashchange', render);
// 화면이 그려지거나 바뀔 때마다 글 속의 용어(용어집)에 점선을 긋는다. 우리가 바꾼 것으로 다시 돌지 않도록 하는 동안은 지켜보기를 멈춘다
let termTimer = 0;
const termWatch = new MutationObserver(() => {
  clearTimeout(termTimer);
  termTimer = window.setTimeout(() => { if (!model) return; termWatch.disconnect(); markTerms(root, model.glossary); termWatch.observe(root, { childList: true, subtree: true }); }, 120);
});
termWatch.observe(root, { childList: true, subtree: true });
// 정보 흐름은 창 폭에 맞춰 상자를 줄바꿈해 놓으므로, 창 크기가 바뀌면(폭이 달라졌을 때만) 다시 배치한다
let lastW = window.innerWidth, resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = window.setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (parse().view === 'info') render(); } }, 150); });
load(true).then(() => { render(); setInterval(() => { load(false).catch(() => { if (!model) return; down = true; if (!root.querySelector('.srv-stale')) root.prepend(h('div', { class: 'srv-stale' }, STALE_TEXT)); }); }, 2500); }).catch((e: unknown) => { root.append(h('div', { class: 'empty-note' }, `모델을 읽지 못했다: ${errorText(e)}`)); });
