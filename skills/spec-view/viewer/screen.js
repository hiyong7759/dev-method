// 화면 설계서: 왼쪽은 실제로 동작하는 화면(iframe), 오른쪽은 개요·컴포넌트·메모·승인·히스토리 패널. 정보를 고르면 같은 정보 상세 패널이 열린다.
import { h, get, post, copyText, matchScreen, statusChip, toast } from './util.js';
import { infoDrawer } from './info.js';
import { overview, components, memoTab, approval, history } from './tabs.js';

const TABS = [['overview', '개요'], ['components', '컴포넌트'], ['memo', '메모'], ['approval', '승인'], ['history', '히스토리']];

export function screenView(root, { model, name, tab, at, go }) {
  let alive = true, raf = 0;
  const c = {
    model, name, tab: tab || 'overview', at,
    focus: null, drawer: null, hl: new Set(), active: null, fieldRole: null, hFilter: '전체',
    draft: null, draftText: '', ap: { problem: false }, regionMode: false, showNumbers: true,
    sc: () => c.model.screens.find((s) => s.name === c.name),
    route: () => { try { return iframe.contentWindow.location.pathname; } catch { return c.sc().sample || c.sc().route; } },
  };
  const spec = () => c.model.specs.filter((s) => s.screens.includes(c.name));
  const ordered = () => [...spec().filter((s) => s.kind !== 'logic'), ...spec().filter((s) => s.kind === 'logic')];
  c.specs = []; c.num = (id) => ordered().findIndex((s) => s.id === id) + 1;

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
  function loadFrame(path) { iframe.src = path; urlEl.textContent = `${location.host}${path}`; }
  iframe.addEventListener('load', () => { okEl.classList.remove('bad'); okEl.textContent = '동작함 · 눌러 볼 수 있다'; });
  iframe.addEventListener('error', () => { okEl.classList.add('bad'); okEl.textContent = '열리지 않음'; });
  const sc0 = c.sc();
  loadFrame(at || sc0.sample || sc0.route || '/');

  // 화면 안에서 다른 화면으로 가면 설계서도 따라간다
  let lastPath = null;
  const poll = setInterval(() => {
    let p; try { p = iframe.contentWindow.location.pathname; } catch { return; }
    if (p === lastPath || p === 'blank') return;
    lastPath = p; urlEl.textContent = `${location.host}${p}`;
    const m = matchScreen(c.model, p);
    if (m && m.name !== c.name) { c.name = m.name; c.focus = null; c.drawer = null; c.draft = null; c.ap = { problem: false }; go(m.name, c.tab, p); render(); }
  }, 400);

  // ── 표시 ──
  function head() {
    const sc = c.sc(), st = sc.status;
    shead.replaceChildren(h('div', { class: 'r1' }, h('span', { class: 'nm' }, sc.name), statusChip(st, ['test-requested', 'approved-changed'].includes(st.status) ? ' pulse' : '')),
      h('div', { class: 'route mono' }, [sc.route, sc.missing ? `미작성 ${sc.missing}` : null, sc.warnings.length ? `확인 필요 ${sc.warnings.length}` : null].filter(Boolean).join(' · ')));
    const bs = [];
    if (st.status === 'test-requested') bs.push(h('div', { class: 'banner blue' }, h('i'), h('span', null, h('b', null, '확인해 주세요'), ' — 에이전트가 테스트를 요청했습니다'), h('button', { onclick: () => c.setTab('approval') }, '승인 탭 ›')));
    if (st.status === 'approved-changed') bs.push(h('div', { class: 'banner amber' }, h('i'), h('span', null, h('b', null, '다시 확인해 주세요'), ' — 승인 뒤 소스가 바뀌었습니다'), h('button', { onclick: () => c.setTab('approval') }, '승인 탭 ›')));
    const undelivered = c.model.memos.filter((m) => m.screen === c.name && m.state === 'pending' && !m.copiedAt).length;
    if (undelivered) bs.push(h('div', { class: 'banner purple' }, h('i'), h('span', null, h('b', null, '에이전트에게 알려 주세요'), ` — 전달하지 않은 메모 ${undelivered}건`), h('button', { class: 'btn', onclick: () => c.copyRequest() }, '요청 복사')));
    banners.replaceChildren(...bs); banners.style.paddingBottom = bs.length ? '12px' : '0';
    const memoDot = undelivered, apDot = ['test-requested', 'approved-changed'].includes(st.status);
    const counts = { components: spec().length, memo: c.model.memos.filter((m) => m.screen === c.name).length };
    tabsEl.replaceChildren(...TABS.map(([k, l]) => h('button', { class: c.tab === k ? 'sel' : '', onclick: () => c.setTab(k) }, l, counts[k] != null ? ` · ${counts[k]}` : '',
      k === 'memo' && memoDot ? h('span', { class: 'tdot p pulse pp' }) : null, k === 'approval' && apDot ? h('span', { class: `tdot${st.status === 'approved-changed' ? ' a' : ''} pulse ${st.status}` }) : null)));
  }
  function body() {
    c.specs = ordered();
    tbody.replaceChildren();
    if (c.drawer) { side.classList.add('drawer-on'); tbody.replaceChildren(); showDrawer(); return; }
    side.classList.remove('drawer-on');
    tabsEl.classList.remove('hidden'); shead.classList.remove('hidden'); banners.classList.remove('hidden');
    const view = { overview, components, memo: memoTab, approval, history }[c.tab](c);
    tbody.append(view);
    hint.textContent = { overview: '실제로 동작하는 화면이다. 오른쪽 "다루는 정보"에 올리면 화면에서 그 정보가 보이는 자리가 강조된다.', components: '점선 번호표는 오른쪽 컴포넌트 카드의 번호와 같다. 카드에 올리면 그 영역이 강조된다.', memo: '화면 위를 끌어서 아무 영역이나 고른다. 컴포넌트가 아닌 빈 곳도 고를 수 있다.', approval: '실제로 동작하는 화면이다. 눌러 보면서 오른쪽 확인 목록을 따라 테스트한다.', history: '항목을 누르면 그 변경이 닿은 컴포넌트가 화면에 강조되고, 닿은 정보가 아래에 나온다.' }[c.tab];
  }
  function showDrawer() {
    [shead, banners, tabsEl].forEach((n) => n.classList.add('hidden'));
    tbody.replaceChildren(infoDrawer(c.model, c.drawer.info, {
      focusField: c.drawer.prop, currentScreen: c.name, onClose: () => { c.drawer = null; c.hl = new Set(); c.render(); },
      openInfo: (n) => { c.drawer = { info: n }; c.render(); }, openScreen: (n) => { c.drawer = null; go(n, 'overview'); c.name = n; c.render(); },
    }));
    tbody.style.padding = '0'; tbody.firstChild.style.flex = '1';
  }
  function render() {
    tbody.style.padding = '';
    head(); body();
    regionBtn.classList.toggle('on', c.regionMode); regionBtn.textContent = c.regionMode ? '영역 메모 켬' : '영역 메모';
  }
  c.render = render;
  c.setTab = (t) => { c.tab = t; c.drawer = null; go(c.name, t); render(); };
  c.setHL = (s) => { c.hl = s; };
  c.setActive = (id) => { c.active = id; };
  c.openInfo = (info, prop) => { c.drawer = { info, prop }; const f = c.sc().fields.find((x) => x.info === info && x.prop === prop); c.hl = new Set(f ? f.specs : []); render(); };
  c.go = (n) => { const t = c.model.screens.find((s) => s.name === n); if (!t) return; c.name = n; c.drawer = null; c.ap = { problem: false }; c.draft = null; go(n, 'overview'); c.tab = 'overview'; loadFrame(t.sample || t.route); render(); };
  c.refresh = async () => { const m = await get('/__spec/model.json'); if (m.generatedAt >= c.model.generatedAt) { c.model = m; render(); } };
  c.copyRequest = async () => {
    const r = await post('/__spec/export', { screen: c.name, mark: true });
    if (!r.text) return toast('전달할 대기 메모가 없습니다');
    await copyText(r.text); toast('복사했습니다. 에이전트에 붙여 넣으세요'); c.refresh();
  };
  c.startMemoFor = (s) => { c.draft = s ? { type: 'component', spec: s.id, title: s.title, file: `${s.file}:${s.line}` } : { type: 'screen' }; c.draftText = ''; if (c.tab !== 'components' || !s) c.tab = s ? 'components' : 'memo'; if (!s) c.draft = { type: 'screen', route: c.route() }; render(); };

  // ── 화면 캡처: 화면과 같은 주소 안이라 보던 상태 그대로 찍는다 ──
  async function lib() {
    const win = iframe.contentWindow, doc = iframe.contentDocument;
    if (win.htmlToImage) return win.htmlToImage;
    await new Promise((ok, err) => { const sc = doc.createElement('script'); sc.src = '/__spec/vendor/html-to-image.js'; sc.onload = ok; sc.onerror = () => err(new Error('캡처 도구를 불러오지 못했다')); doc.head.append(sc); });
    return win.htmlToImage;
  }
  // rect: 페이지 좌표 {x,y,w,h}. 없으면 지금 보이는 화면 전체. 가로 720px 안으로 줄여 PNG 데이터 주소로 돌려준다
  c.capture = async (rect) => {
    try {
      const L = await lib(), doc = iframe.contentDocument, win = iframe.contentWindow;
      const W = Math.max(doc.documentElement.scrollWidth, win.innerWidth), H = Math.max(doc.documentElement.scrollHeight, win.innerHeight);
      const bg = getComputedStyle(doc.body).backgroundColor;
      const full = await L.toPng(doc.documentElement, { width: W, height: H, pixelRatio: 1, cacheBust: true, backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff' });
      const img = new Image(); await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = full; });
      const r = rect ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: rect.w, h: rect.h } : { x: win.scrollX, y: win.scrollY, w: win.innerWidth, h: win.innerHeight };
      r.w = Math.min(r.w, W - r.x); r.h = Math.min(r.h, H - r.y);
      const k = Math.min(1, 720 / r.w), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(r.w * k)); cv.height = Math.max(1, Math.round(r.h * k));
      cv.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png');
    } catch (e) { console.warn('캡처 실패', e); return ''; }
  };
  c.uploadShot = async (data, prefix) => {
    if (!data) return '';
    const name = `${prefix}-${Date.now()}.png`;
    await post('/__spec/shot', { name, data }); return name;
  };

  // ── 화면 위 표시(번호표, 강조) ──
  const frameDoc = () => { try { return iframe.contentDocument; } catch { return null; } };
  function unionRect(doc, selector) {
    let els; try { els = [...doc.querySelectorAll(selector)]; } catch { return null; }
    if (!els.length) return null;
    let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    for (const e of els) { const q = e.getBoundingClientRect(); if (!q.width && !q.height) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
    return r < l ? null : { left: l, top: t, right: r, bottom: b };
  }
  const rects = () => {
    const doc = frameDoc(); if (!doc) return [];
    return ordered().filter((s) => s.kind === 'dom' && s.anchor).map((s) => ({ s, r: unionRect(doc, s.anchor.slice(4)) })).filter((x) => x.r);
  };
  function track() {
    if (!alive) return;
    const ids = new Set(c.tab === 'components' ? ordered().filter((s) => s.kind === 'dom').map((s) => s.id) : c.hl);
    if (c.draft?.type === 'component') ids.add(c.draft.spec);
    const have = new Map([...marks.children].map((e) => [e.dataset.id, e]));
    const rs = rects();
    for (const { s, r } of rs) {
      if (!ids.has(s.id)) continue;
      let e = have.get(s.id);
      if (!e) { e = h('div', { class: 'mbox', dataset: { id: s.id } }, h('span', { class: 'mbadge' }, c.num(s.id))); marks.append(e); }
      have.delete(s.id);
      e.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.right - r.left}px;height:${r.bottom - r.top}px`;
      e.firstChild.style.display = c.showNumbers ? '' : 'none';
      e.classList.toggle('on', c.active === s.id); e.classList.toggle('dim', !!c.active && c.active !== s.id);
    }
    have.forEach((e) => e.remove());
    // 고른 영역은 메모를 쓰는 동안 화면에 남긴다(페이지 좌표 → 지금 스크롤 위치 기준)
    const dr = (c.draft?.rect && c.draft.type !== 'component') ? c.draft.rect : (c.ap.region?.rect || null);
    let keep = marks.querySelector('.selrect');
    if (dr) {
      const doc = frameDoc(); const sx = doc?.defaultView?.scrollX || 0, sy = doc?.defaultView?.scrollY || 0;
      if (!keep) { keep = h('div', { class: 'selrect' }, h('label')); marks.append(keep); }
      keep.style.cssText = `left:${dr.x - sx}px;top:${dr.y - sy}px;width:${dr.w}px;height:${dr.h}px`;
      keep.firstChild.textContent = `선택 영역 · ${dr.w}×${dr.h}${c.draft?.type === 'empty' ? ' · 요소 없음' : ''}`;
    } else keep?.remove();
    raf = requestAnimationFrame(track);
  }
  raf = requestAnimationFrame(track);

  // ── 화면 영역 고르기(메모) ──
  let selEl = null;
  const stopRegion = () => { c.regionMode = false; dragl.classList.add('hidden'); selEl?.remove(); selEl = null; render(); };
  c.startRegion = ({ forError } = {}) => { c.regionMode = true; c.regionForError = !!forError; dragl.classList.remove('hidden'); if (!forError) { c.tab = 'memo'; go(c.name, 'memo'); } render(); };
  function target(r) {
    const doc = frameDoc(); const sx = doc?.defaultView?.scrollX || 0, sy = doc?.defaultView?.scrollY || 0;
    const rect = { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.right - r.left), h: Math.round(r.bottom - r.top) };
    rect.w = rect.w; rect.h = rect.h;
    const rs = rects();
    let best = null, area = 0;
    for (const x of rs) { const w = Math.min(r.right, x.r.right) - Math.max(r.left, x.r.left), hh = Math.min(r.bottom, x.r.bottom) - Math.max(r.top, x.r.top); if (w > 0 && hh > 0 && w * hh > area) { area = w * hh; best = x; } }
    const lab = (x) => ({ title: x.s.title, file: `${x.s.file}:${x.s.line}`, id: x.s.id });
    const route = c.route();
    if (best) return { type: 'region', rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, nearest: lab(best), route };
    const above = rs.filter((x) => x.r.bottom <= r.top).sort((a, b) => b.r.bottom - a.r.bottom)[0];
    const below = rs.filter((x) => x.r.top >= r.bottom).sort((a, b) => a.r.top - b.r.top)[0];
    const s = (x) => (x ? `${x.s.title} (${x.s.file}:${x.s.line})` : '');
    return { type: 'empty', rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, neighbors: { above: s(above), below: s(below) }, route };
  }
  dragl.addEventListener('mousedown', (e) => {
    const box = dragl.getBoundingClientRect(); const sx = e.clientX - box.left, sy = e.clientY - box.top;
    selEl?.remove(); selEl = h('div', { class: 'selrect' }, h('label')); dragl.append(selEl);
    const move = (ev) => {
      const x = ev.clientX - box.left, y = ev.clientY - box.top;
      const l = Math.min(sx, x), t = Math.min(sy, y), w = Math.abs(x - sx), hh = Math.abs(y - sy);
      selEl.style.cssText = `left:${l}px;top:${t}px;width:${w}px;height:${hh}px`; selEl.firstChild.textContent = `선택 영역 · ${Math.round(w)}×${Math.round(hh)}`;
    };
    const up = (ev) => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      const x = ev.clientX - box.left, y = ev.clientY - box.top;
      const r = { left: Math.min(sx, x), top: Math.min(sy, y), right: Math.max(sx, x), bottom: Math.max(sy, y) };
      if (r.right - r.left < 8 || r.bottom - r.top < 8) { selEl.remove(); selEl = null; return; }
      const t = target(r);
      selEl?.remove(); selEl = null;
      c.regionMode = false; dragl.classList.add('hidden');
      c.capture(t.rect).then((d) => { t.shotData = d; if (c.draft === t || c.ap.region === t) c.render(); });
      if (c.regionForError) { c.ap.region = t; c.ap.target = 'region'; c.ap.problem = true; c.tab = 'approval'; }
      else { c.draft = t; c.draftText = ''; c.tab = 'memo'; }
      go(c.name, c.tab); render();
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up); e.preventDefault();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && c.regionMode) stopRegion(); });

  // 글을 쓰는 중이면 모델이 바뀌어도 패널을 다시 그리지 않는다(입력이 사라지지 않게)
  const editing = () => !!(c.draft || c.ap.problem) || tbody.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
  render();
  return {
    update(m) { if (m.generatedAt < c.model.generatedAt) return; c.model = m; if (!c.sc()) return; if (editing()) head(); else render(); },
    setScreen(n, t) { if (n !== c.name) { c.go(n); } if (t && t !== c.tab) { c.tab = t; render(); } },
    destroy() { alive = false; cancelAnimationFrame(raf); clearInterval(poll); },
  };
}
