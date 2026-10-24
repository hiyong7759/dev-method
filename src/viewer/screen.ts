/**
 * @spec screen-view 화면 설계서
 * @why 왼쪽은 실제로 동작하는 화면(iframe), 오른쪽은 개요·현행·히스토리 패널로, 화면을 눌러 보면서 그 화면의 존재 이유·하는 일·구조·변경 이력을 한자리에서 확인하게 한다. 정보를 고르면 같은 정보 상세 패널이 열린다.
 * @contract 상태와 동작을 ctx.ts의 ScreenCtx 객체 하나에 모아 탭들(tabs.ts)에 넘긴다. 화면 안에서 다른 화면으로 가면 이 화면 설계서도 그 화면으로 따라간다(go 콜백으로 주소를 바꾼다). 메모와 화면 승인은 없다(변경은 요청 단위로 한다).
 */
import { h, matchScreen, chip, sidePanel } from './util.js';
import { infoDrawer } from './info.js';
import { runStep } from './steps.js';
import { overview, nowTab, history } from './tabs.js';
import type { Box, ScreenCtx, TabName } from './ctx.js';
import { hash, nav, liveAt } from './route.js';
import { worstMark, markChip } from './design-status.js';
import type { Model, ModelScreen, Spec } from '../types.js';

/** 오른쪽 패널의 탭 순서와 이름 */
const TABS: [TabName, string][] = [['overview', '개요'], ['now', '현행'], ['history', '히스토리']];
/** 탭마다 왼쪽 화면 위 막대에 띄우는 안내 */
const STATUS: Record<TabName, string> = { overview: '동작함 · 눌러 볼 수 있다', now: '구조 표시 켜짐', history: '동작함 · 눌러 볼 수 있다' };
const isTab = (t: string | null | undefined): t is TabName => TABS.some(([k]) => k === t);

/** 화면 설계서를 만들 때 받는 값 */
export interface ScreenViewOptions {
  /** 처음 받은 모델 */
  model: Model;
  /** 처음 보일 화면 이름 */
  name: string;
  /** 처음 열 탭(없으면 개요) */
  tab?: string | null;
  /** 실제 화면을 처음 열 주소(없으면 화면의 예시 주소) */
  at?: string | null;
  /** 보고 있는 화면이나 탭이 바뀌었을 때 주소(#)를 바꾸는 콜백 */
  go: (name: string, tab?: string, at?: string) => void;
}
/** 만든 화면 설계서를 바깥(app.ts)이 다루는 손잡이 */
export interface ScreenViewHandle {
  /** 서버에서 새 모델을 받았을 때 */
  update(m: Model): void;
  /** 주소(#)가 바뀌어 다른 화면이나 탭으로 가야 할 때 */
  setScreen(n: string, t?: string | null): void;
  /** 화면을 지울 때(타이머와 애니메이션을 멈춘다) */
  destroy(): void;
}

/**
 * @screen 화면 설계서
 * @route /__spec/#/screen/:name
 * @sample /__spec/#/screen/%EC%9A%94%EC%B2%AD%20%EB%AA%A9%EB%A1%9D
 * @domain 현행
 * @to 요청 상세 | "관리에서 열기"를 누른다 | 요청 번호
 * @to 사용 흐름 | 개요의 "흐름 보기"를 누른다 |
 * @to 정보 변경 겹쳐 보기 | 히스토리의 "정보 변경 스냅샷"을 누른다 | 요청 번호
 * @to 화면 변경 전후 비교 | 히스토리의 "화면 디자인 스냅샷"을 누른다 | 요청 번호
 * @to 리포트 | 정보 상세의 확인 필요 패널에서 "리포트" 링크를 누른다 |
 * @to 시안 현황 | 패널 위의 "시안 현황"을 누른다 |
 * @why 한 화면의 존재 이유, 하는 일, 구조, 이력을 실제로 동작하는 화면과 나란히 보게 한다.
 * @does 오른쪽 탭(개요, 현행, 히스토리)을 오가며 본다 | 탭마다 해당 내용이 나온다 | 화면 설계서를 열어 본다#3
 * @does 아래 고정 줄의 코멘트 개수를 눌러 오른쪽 코멘트 창을 연다 | 코멘트 창이 열리고 아래 개수 줄은 제자리에 그대로 있다 | 코멘트를 담아 한번에 보낸다#1 | → 2
 * @does 창 안에서 대상(부품 고르기·영역 그리기·화면 전체)을 고르고 글을 써 "코멘트 담기"를 누른다 | 담은 코멘트 목록에 쌓이고 아직 안 보내졌다고 보인다 | 코멘트를 담아 한번에 보낸다#2 | → 3, 2b
 * @does "이 화면"과 "전체" 탭을 오가며 담은 것과 보낸 것을 본다 | 이 화면 탭은 지금 화면의 것만, 전체 탭은 모든 화면의 것이 나온다 | 코멘트를 담아 한번에 보낸다#2b | → 3 | 다른 화면에서 담은 것까지 보려면
 * @does 아래 고정 줄의 "한번에 보내기"를 누른다 | 담은 코멘트가 모두 한꺼번에 에이전트에게 가고 담은 목록이 비워진다 | 코멘트를 담아 한번에 보낸다#3
 */
export function screenView(root: HTMLElement, { model, name, tab, at, go }: ScreenViewOptions): ScreenViewHandle {
  let alive = true, raf = 0;
  const state: Pick<ScreenCtx, 'model' | 'name' | 'tab' | 'at' | 'drawer' | 'hFilter' | 'active' | 'specs' | 'sc'> = {
    model, name, tab: isTab(tab) ? tab : 'overview', at, drawer: null, hFilter: '전체', active: null, specs: [],
    sc: () => c.model.screens.find((s) => s.name === c.name) as ModelScreen,
  };
  // 나머지 동작(c.render 등)은 아래에서 차례로 붙인다. 모두 붙인 뒤에야 탭들에 넘긴다
  const c = state as ScreenCtx;
  const hasScreen = (): boolean => c.model.screens.some((s) => s.name === c.name);
  const spec = (): Spec[] => c.model.specs.filter((s) => s.screens.includes(c.name));
  // 순서: 이 화면의 부품, 모든 화면 공통(앱 틀), 로직
  const ordered = (): Spec[] => [...spec().filter((s) => s.kind !== 'logic' && !s.shell), ...spec().filter((s) => s.kind !== 'logic' && s.shell), ...spec().filter((s) => s.kind === 'logic')];
  c.num = (id) => ordered().findIndex((s) => s.id === id) + 1;
  c.showShell = true;
  c.label = (id) => {
    const sp = ordered().find((s) => s.id === id);
    if (!sp) return '';
    if (!sp.shell) return String(c.num(id));
    const i = ordered().filter((s) => s.shell && s.kind !== 'logic').findIndex((s) => s.id === id);
    return String.fromCharCode(65 + (i % 26));
  };

  // ── 틀 ──
  const iframe = h('iframe', { title: '실제 화면' });
  const marks = h('div', { class: 'marks' });
  const urlEl = h('span', { class: 'url mono' });
  const okEl = h('span', { class: 'ok-dot' });
  const shellBtn = h('button', { class: 'shell-tog', onclick: () => { c.showShell = !c.showShell; shellBtn.classList.toggle('off', !c.showShell); shellBtn.textContent = `공통 화면 표시 ${c.showShell ? '켜짐' : '꺼짐'}`; } }, '공통 화면 표시 켜짐');
  const live = h('div', { class: 'live' },
    h('div', { class: 'livebar' }, h('span', { class: 'badge-live' }, '실제 화면'), urlEl, h('span', { class: 'grow' }), shellBtn, okEl),
    h('div', { class: 'stage' }, iframe, marks));
  // 오른쪽 패널은 공통 패널 틀(늘 떠 있는 패널이라 접기 토글). 다시 그릴 때마다 틀째 바꿔 끼운다
  let side: HTMLElement = h('aside', { class: 'sidepanel' });
  const banners = h('div', { class: 'banners' }), tabsEl = h('div', { class: 'tabs' });
  const tbody = h('div', { class: 'tbody' });
  root.append(live, side);

  // ── 실제 화면 ──
  const loadFrame = (path: string): void => { iframe.src = path; urlEl.textContent = `${location.host}${path}`; };
  const status = (): void => { okEl.classList.remove('bad'); okEl.textContent = STATUS[c.tab]; };
  iframe.addEventListener('load', status);
  iframe.addEventListener('error', () => { okEl.classList.add('bad'); okEl.textContent = '열리지 않음'; });
  const sc0 = c.sc();
  loadFrame(at || liveAt(c.model, c.name) || sc0.route || '/');

  // 화면 안에서 다른 화면으로 가면 설계서도 따라간다
  let lastPath: string | null = null;
  const poll = window.setInterval(() => {
    let p: string;
    try { p = iframe.contentWindow?.location.pathname ?? ''; } catch { return; }
    if (p === lastPath || p === 'blank') return;
    lastPath = p; urlEl.textContent = `${location.host}${p}`;
    const m = matchScreen(c.model, p);
    if (m && m.name !== c.name) { c.name = m.name; c.drawer = null; c.active = null; go(m.name, c.tab, p); render(); }
  }, 400);

  // ── 표시 ──
  /** 이 화면을 범위로 하는 진행 중인 요청들 */
  const requestsHere = (): Model['requests'] => c.model.requests.filter((r) => r.stage !== 'done' && r.stage !== 'cancelled' && r.scope.screens.includes(c.name));
  function bannerEl(): HTMLElement | null {
    // 테스트 경로를 따라가는 중이면 그 요청만 보고 있으므로, 다른 요청의 '내 차례' 줄을 띄우지 않는다
    if (new URLSearchParams(location.hash.split('?')[1] ?? '').get('tr')) return null;
    const mine = requestsHere().filter((r) => r.turn === 'user');
    if (!mine.length) return null;
    const r = mine[0];
    return h('div', { class: 'mybar' }, h('b', null, '내 차례'), h('span', null, `#${r.id} ${r.stepLabel}`), h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => nav(hash('manage', String(r.id))) }, '관리에서 열기 ›'));
  }
  /** 이 화면에 대응하는 시안 판의 최신 여부 한 줄(없으면 안 그린다) */
  function designLine(): HTMLElement | null {
    const boards = c.model.designs.filter((d) => d.screens.includes(c.name));
    if (!boards.length) return null;
    const worst = worstMark(boards), later = boards.reduce((n, d) => n + d.verifyLater.length, 0);
    return h('div', { class: 'designline' }, markChip(worst, undefined, '시안 '), h('span', { class: 'hint' }, `시안 ${boards.map((d) => d.no).join('·')}${later ? ` · 나중에 확인할 것 ${later}건` : ''}`), h('a', { class: 'lnk', href: hash('manage', 'designs') }, '시안 현황 ›'));
  }
  /** 오른쪽 패널을 다시 그린다. 정보 상세를 열었으면 그 패널(눌러서 여는 패널)이 통째로 대신 들어온다 */
  function render(): void {
    let next: HTMLElement;
    if (c.drawer) {
      next = infoDrawer(c.model, c.drawer.info, { currentScreen: c.name, onClose: () => { c.drawer = null; render(); }, openInfo: (n) => { c.drawer = { info: n }; render(); }, openScreen: (n) => { c.drawer = null; c.go(n); } });
    } else {
      const sc = c.sc();
      const reqs = requestsHere();
      const b = bannerEl();
      c.specs = ordered();
      banners.replaceChildren(...(b ? [b] : []));
      tabsEl.replaceChildren(...TABS.map(([k, l]) => h('button', { class: c.tab === k ? 'sel' : '', onclick: () => c.setTab(k) }, l)));
      const views: Record<TabName, (ctx: ScreenCtx) => HTMLElement> = { overview, now: nowTab, history };
      tbody.replaceChildren(views[c.tab](c));
      next = sidePanel({ title: sc.name, badge: reqs.length ? chip('ag', `요청 진행 중 ${reqs.length}건`) : null, fold: 'screen',
        sub: [sc.why || '존재 이유 미작성', sc.route ? [' · ', h('span', { class: 'mono' }, sc.route)] : null], body: [designLine(), banners, tabsEl, tbody] });
    }
    side.replaceWith(next);
    side = next;
    status();
  }
  c.render = render;
  c.setTab = (t) => { c.tab = t; c.drawer = null; c.active = null; go(c.name, t); render(); };
  c.openInfo = (info) => { c.drawer = { info }; render(); };
  c.go = (n) => { const t = c.model.screens.find((s) => s.name === n); if (!t) return; c.name = n; c.drawer = null; c.active = null; go(n, 'overview'); c.tab = 'overview'; loadFrame(liveAt(c.model, n) || t.route); render(); };
  // 눌러야 나타나는 컴포넌트: 검사가 찾아 둔 순서대로 화면을 눌러 열어 준다
  c.revealSpec = async (id) => {
    const sp = ordered().find((x) => x.id === id), doc = frameDoc();
    if (!sp?.reveal || !doc) return false;
    for (const st of sp.reveal) { if (!runStep(doc, st)) break; await new Promise((r) => setTimeout(r, 350)); }
    return c.isOnScreen(id);
  };
  // 컴포넌트를 누르면 그 영역을 강조하고, 화면 밖이면 보이는 자리로 스크롤한다(한 번 더 누르면 해제)
  c.pickComp = async (id) => {
    const sp0 = c.specs.find((x) => x.id === id);
    if (sp0 && sp0.kind === 'dom' && !c.isOnScreen(id) && sp0.reveal) await c.revealSpec(id);
    c.active = c.active === id ? null : id;
    const sp = c.specs.find((x) => x.id === id);
    if (c.active && sp && sp.kind === 'dom' && sp.anchor) {
      try { frameDoc()?.querySelector(sp.anchor.slice(4))?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* 잘못된 선택자 */ }
    }
    render();
  };
  // 요소가 지금 실제 화면에 있는지
  c.isOnScreen = (id) => { const sp = ordered().find((x) => x.id === id); const doc = frameDoc(); if (!sp || sp.kind !== 'dom' || !sp.anchor || !doc) return false; try { return !!doc.querySelector(sp.anchor.slice(4)); } catch { return false; } };

  // ── 화면 위 표시(컴포넌트 이름표) ──
  const frameDoc = (): Document | null => { try { return iframe.contentDocument; } catch { return null; } };
  /** 선택자에 맞는 요소마다의 사각형(보이지 않는 것은 뺀다) */
  function boxesOf(doc: Document, selector: string): Box[] {
    let els: Element[];
    try { els = [...doc.querySelectorAll(selector)]; } catch { return []; }
    const out: Box[] = [];
    for (const e of els) { const q = e.getBoundingClientRect(); if (q.width || q.height) out.push({ left: q.left, top: q.top, right: q.right, bottom: q.bottom }); }
    return out;
  }
  /** 사각형들을 모두 감싸는 하나의 사각형 */
  const union = (bs: Box[]): Box | null => bs.length ? { left: Math.min(...bs.map((b) => b.left)), top: Math.min(...bs.map((b) => b.top)), right: Math.max(...bs.map((b) => b.right)), bottom: Math.max(...bs.map((b) => b.bottom)) } : null;
  /** 같은 부품이 이만큼 많으면 하나씩 그리지 않고 한 틀로 묶어 "× n"만 보인다 */
  const MAX_SEPARATE = 6;
  const rects = (): { s: Spec; boxes: Box[] }[] => {
    const doc = frameDoc();
    if (!doc) return [];
    return ordered().filter((s) => s.kind === 'dom' && s.anchor).map((s) => ({ s, boxes: boxesOf(doc, s.anchor.slice(4)) })).filter((x) => x.boxes.length);
  };
  const contains = (a: Box, b: Box): boolean => a.left <= b.left + 1 && a.top <= b.top + 1 && a.right >= b.right - 1 && a.bottom >= b.bottom - 1 && (a.right - a.left > b.right - b.left + 2 || a.bottom - a.top > b.bottom - b.top + 2);
  /** 부품 안의 부품: 이 부품의 틀을 통째로 품은 다른 부품의 수 */
  const depths = (): Map<string, number> => {
    // 앱 틀(공통)은 부품을 품는 바깥 틀로 세지 않는다
    const all = rects().map((x) => ({ id: x.s.id, shell: x.s.shell, u: union(x.boxes) as Box }));
    return new Map(all.map((x) => [x.id, x.shell ? 0 : all.filter((y) => !y.shell && y.id !== x.id && contains(y.u, x.u)).length]));
  };
  c.depthOf = (id) => depths().get(id) ?? 0;
  c.countOf = (id) => rects().find((x) => x.s.id === id)?.boxes.length ?? 0;
  let lastSig = '';
  function track(): void {
    if (!alive) return;
    const ids = new Set<string>(c.tab === 'now' ? ordered().filter((s) => s.kind === 'dom' && (c.showShell || !s.shell)).map((s) => s.id) : c.active ? [c.active] : []);
    const have = new Map([...marks.querySelectorAll<HTMLElement>('.mbox')].map((e) => [e.dataset.key as string, e]));
    const all = rects();
    const unionAll = new Map(all.map((x) => [x.s.id, union(x.boxes) as Box]));
    // 겹침(부품 안의 부품)은 앱 틀을 빼고 센다
    const unions = new Map([...unionAll].filter(([id]) => !all.find((x) => x.s.id === id)?.s.shell));
    for (const { s, boxes } of all) {
      if (!ids.has(s.id)) continue;
      const parts = boxes.length > 1 && boxes.length <= MAX_SEPARATE ? boxes : [unionAll.get(s.id) as Box];
      const nested = !s.shell && [...unions].some(([id, u]) => id !== s.id && contains(u, unionAll.get(s.id) as Box));
      parts.forEach((r, i) => {
        const key = `${s.id}#${i}`;
        let e = have.get(key);
        if (!e) { e = h('div', { class: 'mbox', dataset: { id: s.id, key } }, h('span', { class: 'mbadge', title: s.title }, c.label(s.id))); marks.append(e); }
        have.delete(key);
        e.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.right - r.left}px;height:${r.bottom - r.top}px`;
        e.classList.toggle('on', c.active === s.id); e.classList.toggle('dim', !!c.active && c.active !== s.id); e.classList.toggle('in', nested); e.classList.toggle('shell', s.shell);
        // 같은 부품이 여러 곳이면 첫 틀에 "× n"을 붙인다(묶어 그린 때는 전체 개수)
        const many = boxes.length > 1 && i === 0 ? boxes.length : 0;
        const cnt = e.querySelector('.mcount');
        if (many && !cnt) e.append(h('span', { class: 'mcount' }, `× ${many}`)); else if (many && cnt) cnt.textContent = `× ${many}`; else if (!many && cnt) cnt.remove();
      });
    }
    have.forEach((e) => e.remove());
    // 부품이 화면에 나타나거나 겹침이 바뀌면(화면이 늦게 뜰 때 등) 오른쪽 목록의 "화면에 n곳"·들여쓰기를 다시 그린다
    const sig = all.map((x) => `${x.s.id}:${x.boxes.length}:${x.s.shell ? 0 : [...unions].filter(([id, u]) => id !== x.s.id && contains(u, unionAll.get(x.s.id) as Box)).length}`).join('|');
    if (sig !== lastSig) { lastSig = sig; if (c.tab === 'now' && !c.drawer) render(); }
    raf = requestAnimationFrame(track);
  }
  raf = requestAnimationFrame(track);

  render();
  return {
    update(m) { if (m.generatedAt < c.model.generatedAt) return; c.model = m; if (!hasScreen()) return; render(); },
    setScreen(n, t) { if (n !== c.name) { c.go(n); } if (t && isTab(t) && t !== c.tab) { c.tab = t; render(); } },
    destroy() { alive = false; cancelAnimationFrame(raf); clearInterval(poll); },
  };
}
