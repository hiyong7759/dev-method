/**
 * @spec screen-view 화면 설계서
 * @why 왼쪽은 실제로 동작하는 화면(iframe), 오른쪽은 개요·컴포넌트·메모·승인·히스토리 패널로, 화면을 눌러 보면서 그 화면의 존재 이유·동작·정보·이력을 한자리에서 확인하게 한다. 정보를 고르면 같은 정보 상세 패널이 열린다.
 * @contract 상태와 동작을 ctx.ts의 ScreenCtx 객체 하나에 모아 탭들(tabs.ts)에 넘긴다. 화면 안에서 다른 화면으로 가면 이 화면 설계서도 그 화면으로 따라간다(go 콜백으로 주소를 바꾼다). 글을 쓰는 중이면 모델이 새로 와도 패널을 다시 그리지 않는다.
 */
import { h, get, post, copyText, matchScreen, statusChip, toast } from './util.js';
import { infoDrawer } from './info.js';
import { runStep } from './steps.js';
import { overview, components, memoTab, approval, history } from './tabs.js';
import type { Box, ScreenCtx, TabName } from './ctx.js';
import type { MemoTarget, Model, ModelScreen, Spec } from '../types.js';

/** 오른쪽 패널의 탭 순서와 이름 */
const TABS: [TabName, string][] = [['overview', '개요'], ['components', '컴포넌트'], ['memo', '메모'], ['approval', '승인'], ['history', '히스토리']];
/** 탭마다 왼쪽 화면 아래에 띄우는 안내 */
const HINTS: Record<TabName, string> = {
  overview: '실제로 동작하는 화면이다. 오른쪽 "다루는 정보"에 올리면 화면에서 그 정보가 보이는 자리가 강조된다.',
  components: '점선 번호표는 오른쪽 카드의 번호와 같다. 카드를 누르면 그 영역이 강조되고, 화면 밖이면 보이는 자리로 이동한다.',
  memo: '화면 위를 끌어서 아무 영역이나 고른다. 컴포넌트가 아닌 빈 곳도 고를 수 있다.',
  approval: '실제로 동작하는 화면이다. 눌러 보면서 오른쪽 확인 목록을 따라 테스트한다.',
  history: '"상세 보기"를 누르면 그 변경이 바꾼 곳이 목록으로 나오고, 작은 화면 요소는 노란 테두리로 보여 준다.',
};
const isTab = (t: string | null | undefined): t is TabName => TABS.some(([k]) => k === t);

/** 화면 안(iframe) 창이 갖고 있을 수 있는 캡처 도구 */
interface FrameWindow extends Window { htmlToImage?: { toPng(node: HTMLElement, opts: Record<string, unknown>): Promise<string> } }

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
 * @domain 현행
 * @why 한 화면의 존재 이유, 동작, 정보, 이력을 실제로 동작하는 화면과 나란히 보게 한다.
 * @does 오른쪽 탭(개요, 컴포넌트, 메모, 승인, 히스토리)을 오가며 본다 | 탭마다 해당 내용이 나온다 | 화면 설계서를 열어 본다#3 | → 3b
 * @does 화면 위에서 영역을 끌어 메모를 남긴다 | 메모 탭에 대상과 함께 저장된다 | 화면 설계서를 열어 본다#3b | | 고치고 싶은 곳이 있으면
 */
export function screenView(root: HTMLElement, { model, name, tab, at, go }: ScreenViewOptions): ScreenViewHandle {
  let alive = true, raf = 0;
  const state: Pick<ScreenCtx, 'model' | 'name' | 'tab' | 'at' | 'focus' | 'drawer' | 'hOpen' | 'hl' | 'active' | 'fieldRole' | 'hFilter' | 'draft' | 'draftText' | 'ap' | 'regionMode' | 'showNumbers' | 'specs' | 'sc' | 'route'> = {
    model, name, tab: isTab(tab) ? tab : 'overview', at,
    focus: null, drawer: null, hOpen: new Set(), hl: new Set(), active: null, fieldRole: null, hFilter: '전체',
    draft: null, draftText: '', ap: { problem: false }, regionMode: false, showNumbers: true, specs: [],
    sc: () => c.model.screens.find((s) => s.name === c.name) as ModelScreen,
    route: () => { try { return iframe.contentWindow?.location.pathname ?? ''; } catch { return c.sc().sample || c.sc().route; } },
  };
  // 나머지 동작(c.render 등)은 아래에서 차례로 붙인다. 모두 붙인 뒤에야 탭들에 넘긴다
  const c = state as ScreenCtx;
  const hasScreen = (): boolean => c.model.screens.some((s) => s.name === c.name);
  const spec = (): Spec[] => c.model.specs.filter((s) => s.screens.includes(c.name));
  const ordered = (): Spec[] => [...spec().filter((s) => s.kind !== 'logic'), ...spec().filter((s) => s.kind === 'logic')];
  c.num = (id) => ordered().findIndex((s) => s.id === id) + 1;

  // ── 틀 ──
  const iframe = h('iframe', { title: '실제 화면' });
  const marks = h('div', { class: 'marks' });
  const dragl = h('div', { class: 'dragl hidden' });
  const hint = h('div', { class: 'hint' });
  const urlEl = h('span', { class: 'url mono' });
  const okEl = h('span', { class: 'ok-dot' }, '동작함 · 눌러 볼 수 있다');
  const swEl = h('span', { class: 'sw on' }, h('i'));
  const regionBtn = h('button', { class: 'regionbtn', onclick: () => (c.regionMode ? stopRegion() : c.startRegion()) }, '영역 메모');
  const live = h('div', { class: 'live' },
    h('div', { class: 'livebar' }, h('span', { class: 'badge-live' }, '실제 화면'), urlEl, h('span', { class: 'grow' }), okEl, regionBtn,
      h('button', { class: 'tgl', onclick: () => { c.showNumbers = !c.showNumbers; swEl.classList.toggle('on', c.showNumbers); } }, '번호표', swEl)),
    h('div', { class: 'stage' }, iframe, marks, dragl, hint));
  const side = h('aside', { class: 'side' });
  const shead = h('div', { class: 'shead' }), banners = h('div', { class: 'banners' }), tabsEl = h('div', { class: 'tabs' });
  const tbody = h('div', { class: 'tbody' });
  side.append(shead, banners, tabsEl, tbody);
  root.append(live, side);

  // ── 실제 화면 ──
  const loadFrame = (path: string): void => { iframe.src = path; urlEl.textContent = `${location.host}${path}`; };
  iframe.addEventListener('load', () => { okEl.classList.remove('bad'); okEl.textContent = '동작함 · 눌러 볼 수 있다'; });
  iframe.addEventListener('error', () => { okEl.classList.add('bad'); okEl.textContent = '열리지 않음'; });
  const sc0 = c.sc();
  loadFrame(at || sc0.sample || sc0.route || '/');

  // 화면 안에서 다른 화면으로 가면 설계서도 따라간다
  let lastPath: string | null = null;
  const poll = window.setInterval(() => {
    let p: string;
    try { p = iframe.contentWindow?.location.pathname ?? ''; } catch { return; }
    if (p === lastPath || p === 'blank') return;
    lastPath = p; urlEl.textContent = `${location.host}${p}`;
    const m = matchScreen(c.model, p);
    if (m && m.name !== c.name) { c.name = m.name; c.focus = null; c.drawer = null; c.draft = null; c.ap = { problem: false }; go(m.name, c.tab, p); render(); }
  }, 400);

  // ── 표시 ──
  function head(): void {
    const sc = c.sc(), st = sc.status;
    shead.replaceChildren(h('div', { class: 'r1' }, h('span', { class: 'nm' }, sc.name), statusChip(st, ['test-requested', 'approved-changed'].includes(st.status) ? ' pulse' : '')),
      h('div', { class: 'route mono' }, [sc.route, sc.missing ? `미작성 ${sc.missing}` : null, sc.warnings.length ? `확인 필요 ${sc.warnings.length}` : null].filter(Boolean).join(' · ')));
    const bs: HTMLElement[] = [];
    if (st.status === 'test-requested') bs.push(h('div', { class: 'banner blue' }, h('i'), h('span', null, h('b', null, '확인해 주세요'), ' — 에이전트가 테스트를 요청했습니다'), h('button', { onclick: () => c.setTab('approval') }, '승인 탭 ›')));
    if (st.status === 'approved-changed') bs.push(h('div', { class: 'banner amber' }, h('i'), h('span', null, h('b', null, '다시 확인해 주세요'), ' — 승인 뒤 소스가 바뀌었습니다'), h('button', { onclick: () => c.setTab('approval') }, '승인 탭 ›')));
    const undelivered = c.model.memos.filter((m) => m.screen === c.name && m.state === 'pending' && !m.copiedAt).length;
    if (undelivered) bs.push(h('div', { class: 'banner purple' }, h('i'), h('span', null, h('b', null, '에이전트에게 알려 주세요'), ` — 전달하지 않은 메모 ${undelivered}건`), h('button', { class: 'btn', onclick: () => { void c.copyRequest(); } }, '요청 복사')));
    banners.replaceChildren(...bs);
    banners.style.paddingBottom = bs.length ? '12px' : '0';
    const memoDot = undelivered, apDot = ['test-requested', 'approved-changed'].includes(st.status);
    const counts: Partial<Record<TabName, number>> = { components: spec().length, memo: c.model.memos.filter((m) => m.screen === c.name).length };
    tabsEl.replaceChildren(...TABS.map(([k, l]) => h('button', { class: c.tab === k ? 'sel' : '', onclick: () => c.setTab(k) }, l, counts[k] != null ? ` · ${counts[k]}` : '',
      k === 'memo' && memoDot ? h('span', { class: 'tdot p pulse pp' }) : null, k === 'approval' && apDot ? h('span', { class: `tdot${st.status === 'approved-changed' ? ' a' : ''} pulse ${st.status}` }) : null)));
  }
  function body(): void {
    c.specs = ordered();
    tbody.replaceChildren();
    if (c.drawer) { side.classList.add('drawer-on'); tbody.replaceChildren(); showDrawer(c.drawer); return; }
    side.classList.remove('drawer-on');
    tabsEl.classList.remove('hidden'); shead.classList.remove('hidden'); banners.classList.remove('hidden');
    const views: Record<TabName, (ctx: ScreenCtx) => HTMLElement> = { overview, components, memo: memoTab, approval, history };
    tbody.append(views[c.tab](c));
    hint.textContent = HINTS[c.tab];
  }
  // 정보 상세 맨 위에 '화면에서 어떻게 표시했는지'를 알린다
  function locNote(): string {
    if (!c.hlField) return '';
    if (fieldRects().length) return '화면에서 이 정보가 나오는 자리를 표시했다';
    if (c.hl.size) return '이 정보가 나오는 정확한 자리를 못 찾아, 이 정보를 쓰는 컴포넌트 단위로 표시했다';
    return '화면에서 표시할 자리를 찾지 못했다';
  }
  function showDrawer(d: { info: string; prop?: string }): void {
    [shead, banners, tabsEl].forEach((n) => n.classList.add('hidden'));
    const drawer = infoDrawer(c.model, d.info, {
      focusField: d.prop, currentScreen: c.name, onClose: () => { c.drawer = null; c.setHLField(null); c.hl = new Set(); c.render(); }, locNote: locNote(),
      openInfo: (n) => { c.drawer = { info: n }; c.render(); }, openScreen: (n) => { c.drawer = null; go(n, 'overview'); c.name = n; c.render(); },
    });
    tbody.replaceChildren(drawer);
    tbody.style.padding = '0';
    drawer.style.flex = '1';
  }
  function render(): void {
    tbody.style.padding = '';
    head(); body();
    regionBtn.classList.toggle('on', c.regionMode);
    regionBtn.textContent = c.regionMode ? '영역 메모 켬' : '영역 메모';
  }
  c.render = render;
  c.setTab = (t) => { c.tab = t; c.drawer = null; c.active = null; c.flash = false; c.hlField = null; if (t !== 'overview') c.hl = new Set(); go(c.name, t); render(); };
  c.setHL = (s) => { c.hl = s; };
  // 정보 필드에 올리면: 그 정보가 화면에 나오는 자리(글자·배지 등)를 강조. 찾지 못하면(가공해서 보여 주는 값 등) 그 값을 쓰는 컴포넌트로 대신한다
  c.setHLField = (f) => { c.hlField = f; c.hl = f ? new Set(f.specs) : new Set(); };
  // 정보 필드를 누르면: 정보 상세를 열고, 화면에서 그 정보가 나오는 자리를 표시하고, 화면 밖이면 그 자리로 스크롤한다
  c.openField = (f) => {
    c.flash = false; c.setHLField(f); c.drawer = { info: f.info, prop: f.prop }; render();
    let el: Element | null | undefined = null;
    for (const d of f.doms || []) { try { el = frameDoc()?.querySelector(d.sel); } catch { el = null; } if (el) break; }
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else { const first = f.specs.find((id) => c.isOnScreen(id)); if (first) c.focusSpec(first); }
  };
  c.setActive = (id) => { c.active = id; };
  // 눌러야 나타나는 컴포넌트: 검사가 찾아 둔 순서대로 화면을 눌러 열어 준다
  c.revealSpec = async (id) => {
    const sp = ordered().find((x) => x.id === id), doc = frameDoc();
    if (!sp?.reveal || !doc) return false;
    for (const st of sp.reveal) { if (!runStep(doc, st)) break; await new Promise((r) => setTimeout(r, 350)); }
    return c.isOnScreen(id);
  };
  // 컴포넌트 카드를 누르면 그 영역을 강조하고, 화면 밖이면 보이는 자리로 스크롤한다(한 번 더 누르면 해제)
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
  c.openInfo = (info, prop) => { c.flash = false; c.drawer = { info, prop }; const f = c.sc().fields.find((x) => x.info === info && x.prop === prop); c.hl = new Set(f ? f.specs : []); render(); };
  c.go = (n) => { const t = c.model.screens.find((s) => s.name === n); if (!t) return; c.name = n; c.drawer = null; c.ap = { problem: false }; c.draft = null; go(n, 'overview'); c.tab = 'overview'; loadFrame(t.sample || t.route); render(); };
  c.refresh = async () => { const m = await get<Model>('/__spec/model.json'); if (m.generatedAt >= c.model.generatedAt) { c.model = m; render(); } };
  c.copyRequest = async () => {
    const r = await post<{ text: string }>('/__spec/export', { screen: c.name, mark: true });
    if (!r.text) { toast('전달할 대기 메모가 없습니다'); return; }
    await copyText(r.text); toast('복사했습니다. 에이전트에 붙여 넣으세요'); await c.refresh();
  };
  c.startMemoFor = (s) => {
    c.draft = s ? { type: 'component', spec: s.id, title: s.title, file: `${s.file}:${s.line}` } : { type: 'screen', route: c.route() };
    c.draftText = '';
    if (c.tab !== 'components' || !s) c.tab = s ? 'components' : 'memo';
    render();
  };

  // ── 화면 캡처: 화면과 같은 주소 안이라 보던 상태 그대로 찍는다 ──
  async function lib(): Promise<NonNullable<FrameWindow['htmlToImage']>> {
    const win = iframe.contentWindow as FrameWindow, doc = iframe.contentDocument as Document;
    if (win.htmlToImage) return win.htmlToImage;
    await new Promise<void>((ok, err) => { const sc = doc.createElement('script'); sc.src = '/__spec/vendor/html-to-image.js'; sc.onload = () => ok(); sc.onerror = () => err(new Error('캡처 도구를 불러오지 못했다')); doc.head.append(sc); });
    if (!win.htmlToImage) throw new Error('캡처 도구를 불러오지 못했다');
    return win.htmlToImage;
  }
  // rect: 페이지 좌표 {x,y,w,h}. 없으면 지금 보이는 화면 전체. 가로 720px 안으로 줄여 PNG 데이터 주소로 돌려준다
  c.capture = async (rect) => {
    try {
      const L = await lib(), doc = iframe.contentDocument as Document, win = iframe.contentWindow as Window;
      const W = Math.max(doc.documentElement.scrollWidth, win.innerWidth), H = Math.max(doc.documentElement.scrollHeight, win.innerHeight);
      const bg = getComputedStyle(doc.body).backgroundColor;
      const full = await L.toPng(doc.documentElement, { width: W, height: H, pixelRatio: 1, cacheBust: true, backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff' });
      const img = new Image();
      await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = full; });
      const r = rect ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: rect.w, h: rect.h } : { x: win.scrollX, y: win.scrollY, w: win.innerWidth, h: win.innerHeight };
      r.w = Math.min(r.w, W - r.x); r.h = Math.min(r.h, H - r.y);
      const k = Math.min(1, 720 / r.w), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(r.w * k)); cv.height = Math.max(1, Math.round(r.h * k));
      cv.getContext('2d')?.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png');
    } catch (e) { console.warn('캡처 실패', e); return ''; }
  };
  c.uploadShot = async (data, prefix) => {
    if (!data) return '';
    const shot = `${prefix}-${Date.now()}.png`;
    await post('/__spec/shot', { name: shot, data });
    return shot;
  };

  // 요소가 지금 실제 화면에 있는지, 있으면 그 자리로 스크롤
  c.isOnScreen = (id) => { const sp = ordered().find((x) => x.id === id); const doc = frameDoc(); if (!sp || sp.kind !== 'dom' || !sp.anchor || !doc) return false; try { return !!doc.querySelector(sp.anchor.slice(4)); } catch { return false; } };
  c.focusSpec = (id) => { const sp = ordered().find((x) => x.id === id); if (!sp?.anchor) return; try { frameDoc()?.querySelector(sp.anchor.slice(4))?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* 잘못된 선택자 */ } };
  // 'ok' 테두리로 보여 줄 수 있다 / 'big' 화면 대부분이라 테두리가 의미 없다 / 'none' 지금 화면에 없다 / 'logic' 화면에 안 보이는 로직
  c.spanState = (id) => {
    const sp = ordered().find((x) => x.id === id);
    if (!sp) return 'none';
    if (sp.kind !== 'dom') return 'logic';
    const r = rects().find((x) => x.s.id === id);
    if (!r) return 'none';
    return ((r.r.right - r.r.left) * (r.r.bottom - r.r.top)) / Math.max(1, iframe.clientWidth * iframe.clientHeight) > 0.45 ? 'big' : 'ok';
  };
  c.setFlash = (ids) => {
    const ok = ids.filter((id) => c.spanState(id) === 'ok');
    c.hl = new Set(ok); c.flash = ok.length > 0;
    if (ok[0]) c.focusSpec(ok[0]);
  };

  // ── 화면 위 표시(번호표, 강조) ──
  const frameDoc = (): Document | null => { try { return iframe.contentDocument; } catch { return null; } };
  /** 선택자에 맞는 모든 요소를 감싸는 하나의 사각형 */
  function unionRect(doc: Document, selector: string): Box | null {
    let els: Element[];
    try { els = [...doc.querySelectorAll(selector)]; } catch { return null; }
    if (!els.length) return null;
    let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    for (const e of els) { const q = e.getBoundingClientRect(); if (!q.width && !q.height) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
    return r < l ? null : { left: l, top: t, right: r, bottom: b };
  }
  const rects = (): { s: Spec; r: Box }[] => {
    const doc = frameDoc();
    if (!doc) return [];
    return ordered().filter((s) => s.kind === 'dom' && s.anchor).map((s) => ({ s, r: unionRect(doc, s.anchor.slice(4)) })).filter((x): x is { s: Spec; r: Box } => x.r !== null);
  };
  // 정보가 나오는 자리: 선택자로 찾은 요소(모드 text면 그 요소 안 글자 부분만)의 화면 위 사각형들
  function fieldRects(): Box[] {
    const f = c.hlField, doc = frameDoc();
    if (!f || !f.doms?.length || !doc) return [];
    const out: Box[] = [];
    for (const d of f.doms) {
      let els: Element[];
      try { els = [...doc.querySelectorAll(d.sel)].slice(0, 24); } catch { continue; }
      for (const el of els) {
        if (d.mode === 'text') {
          let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
          const rng = doc.createRange();
          for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent?.trim()) { rng.selectNodeContents(n); for (const q of rng.getClientRects()) { l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); } }
          if (r > l) out.push({ left: l, top: t, right: r, bottom: b });
        } else { const q = el.getBoundingClientRect(); if (q.width || q.height) out.push({ left: q.left, top: q.top, right: q.right, bottom: q.bottom }); }
      }
    }
    const seen = new Set<string>();
    return out.filter((r) => { const k = [r.left, r.top, r.right, r.bottom].map(Math.round).join(','); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function track(): void {
    if (!alive) return;
    const frs = fieldRects();
    // 필드에 올린 동안에는, 그 자리를 찾았으면 그 자리만 강조하고 못 찾았을 때만 컴포넌트 상자로 대신한다
    const fbPool = [...marks.querySelectorAll<HTMLElement>('.fbox')];
    frs.forEach((r, i) => {
      let e = fbPool[i];
      if (!e) { e = h('div', { class: 'fbox' }); marks.append(e); }
      e.style.cssText = `left:${r.left - 4}px;top:${r.top - 3}px;width:${r.right - r.left + 8}px;height:${r.bottom - r.top + 6}px`;
    });
    fbPool.slice(frs.length).forEach((e) => e.remove());
    const ids = new Set<string>(c.tab === 'components' ? ordered().filter((s) => s.kind === 'dom').map((s) => s.id) : (frs.length ? [] : c.hl));
    if (c.draft?.type === 'component' && c.draft.spec) ids.add(c.draft.spec);
    const have = new Map([...marks.querySelectorAll<HTMLElement>('.mbox')].map((e) => [e.dataset.id as string, e])); // 컴포넌트 상자만 다룬다(정보 강조·고른 영역 표시는 따로 관리)
    const rs = rects();
    for (const { s, r } of rs) {
      if (!ids.has(s.id)) continue;
      let e = have.get(s.id);
      if (!e) { e = h('div', { class: 'mbox', dataset: { id: s.id } }, h('span', { class: 'mbadge' }, c.num(s.id))); marks.append(e); }
      have.delete(s.id);
      e.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.right - r.left}px;height:${r.bottom - r.top}px`;
      (e.firstElementChild as HTMLElement).style.display = c.showNumbers ? '' : 'none';
      e.classList.toggle('on', c.active === s.id); e.classList.toggle('dim', !!c.active && c.active !== s.id);
      // 히스토리에서 고른 변경이 바꾼 요소는 눈에 띄게(깜빡이는 노란 테두리 + 이름표)
      const fl = !!c.flash && c.hl.has(s.id);
      e.classList.toggle('flash', fl);
      let lab = e.querySelector('.mlabel');
      if (fl && !lab) { lab = h('span', { class: 'mlabel' }, `바뀐 곳 · ${s.title}`); e.append(lab); }
      if (!fl && lab) lab.remove();
    }
    have.forEach((e) => e.remove());
    // 고른 영역은 메모를 쓰는 동안 화면에 남긴다(페이지 좌표 → 지금 스크롤 위치 기준)
    const dr = (c.draft?.rect && c.draft.type !== 'component') ? c.draft.rect : (c.ap.region?.rect || null);
    let keep = marks.querySelector<HTMLElement>('.selrect');
    if (dr) {
      const doc = frameDoc();
      const sx = doc?.defaultView?.scrollX || 0, sy = doc?.defaultView?.scrollY || 0;
      if (!keep) { keep = h('div', { class: 'selrect' }, h('label')); marks.append(keep); }
      keep.style.cssText = `left:${dr.x - sx}px;top:${dr.y - sy}px;width:${dr.w}px;height:${dr.h}px`;
      (keep.firstElementChild as HTMLElement).textContent = `선택 영역 · ${dr.w}×${dr.h}${c.draft?.type === 'empty' ? ' · 요소 없음' : ''}`;
    } else keep?.remove();
    raf = requestAnimationFrame(track);
  }
  raf = requestAnimationFrame(track);

  // ── 화면 영역 고르기(메모) ──
  let selEl: HTMLElement | null = null;
  const stopRegion = (): void => { c.regionMode = false; dragl.classList.add('hidden'); selEl?.remove(); selEl = null; render(); };
  c.startRegion = ({ forError } = {}) => { c.regionMode = true; c.regionForError = !!forError; dragl.classList.remove('hidden'); if (!forError) { c.tab = 'memo'; go(c.name, 'memo'); } render(); };
  /** 끌어서 고른 사각형이 어느 컴포넌트에 가까운지 보고, 메모가 가리킬 곳(영역 또는 빈 영역)을 만든다 */
  function target(r: Box): MemoTarget {
    const doc = frameDoc();
    const sx = doc?.defaultView?.scrollX || 0, sy = doc?.defaultView?.scrollY || 0;
    const rect = { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.right - r.left), h: Math.round(r.bottom - r.top) };
    const rs = rects();
    let best: { s: Spec; r: Box } | null = null, area = 0;
    for (const x of rs) { const w = Math.min(r.right, x.r.right) - Math.max(r.left, x.r.left), hh = Math.min(r.bottom, x.r.bottom) - Math.max(r.top, x.r.top); if (w > 0 && hh > 0 && w * hh > area) { area = w * hh; best = x; } }
    const lab = (x: { s: Spec }): { title: string; file: string; id: string } => ({ title: x.s.title, file: `${x.s.file}:${x.s.line}`, id: x.s.id });
    const route = c.route();
    if (best) return { type: 'region', rect, nearest: lab(best), route };
    const above = rs.filter((x) => x.r.bottom <= r.top).sort((a, b) => b.r.bottom - a.r.bottom)[0];
    const below = rs.filter((x) => x.r.top >= r.bottom).sort((a, b) => a.r.top - b.r.top)[0];
    const s = (x: { s: Spec } | undefined): string => (x ? `${x.s.title} (${x.s.file}:${x.s.line})` : '');
    return { type: 'empty', rect, neighbors: { above: s(above), below: s(below) }, route };
  }
  dragl.addEventListener('mousedown', (e) => {
    const box = dragl.getBoundingClientRect();
    const sx = e.clientX - box.left, sy = e.clientY - box.top;
    selEl?.remove();
    const sel = h('div', { class: 'selrect' }, h('label'));
    selEl = sel;
    dragl.append(sel);
    const move = (ev: MouseEvent): void => {
      const x = ev.clientX - box.left, y = ev.clientY - box.top;
      const l = Math.min(sx, x), t = Math.min(sy, y), w = Math.abs(x - sx), hh = Math.abs(y - sy);
      sel.style.cssText = `left:${l}px;top:${t}px;width:${w}px;height:${hh}px`;
      (sel.firstElementChild as HTMLElement).textContent = `선택 영역 · ${Math.round(w)}×${Math.round(hh)}`;
    };
    const up = (ev: MouseEvent): void => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      const x = ev.clientX - box.left, y = ev.clientY - box.top;
      const r: Box = { left: Math.min(sx, x), top: Math.min(sy, y), right: Math.max(sx, x), bottom: Math.max(sy, y) };
      if (r.right - r.left < 8 || r.bottom - r.top < 8) { sel.remove(); selEl = null; return; }
      const t = target(r);
      sel.remove(); selEl = null;
      c.regionMode = false; dragl.classList.add('hidden');
      void c.capture(t.rect).then((d) => { t.shotData = d; if (c.draft === t || c.ap.region === t) c.render(); });
      if (c.regionForError) { c.ap.region = t; c.ap.target = 'region'; c.ap.problem = true; c.tab = 'approval'; }
      else { c.draft = t; c.draftText = ''; c.tab = 'memo'; }
      go(c.name, c.tab); render();
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up); e.preventDefault();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && c.regionMode) stopRegion(); });

  // 글을 쓰는 중이면 모델이 바뀌어도 패널을 다시 그리지 않는다(입력이 사라지지 않게)
  const editing = (): boolean => !!(c.draft || c.ap.problem) || (tbody.contains(document.activeElement) && document.activeElement?.tagName === 'TEXTAREA');
  render();
  return {
    update(m) { if (m.generatedAt < c.model.generatedAt) return; c.model = m; if (!hasScreen()) return; if (editing()) head(); else render(); },
    setScreen(n, t) { if (n !== c.name) { c.go(n); } if (t && isTab(t) && t !== c.tab) { c.tab = t; render(); } },
    destroy() { alive = false; cancelAnimationFrame(raf); clearInterval(poll); },
  };
}
