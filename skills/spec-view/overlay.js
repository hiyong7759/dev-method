// 설계서 보기 — 개발 서버에서만 화면 위에 얹히는 읽기 전용 보기.
// 존재 이유: 소스 주석(@screen/@spec)이 곧 설계서이므로, 실행 중인 화면 옆에서 그대로 읽어 "설계가 화면에 맞게 구현됐나"를 눈으로 확인하게 하려고.
// 화면 구성: 위 = 화면 헤더(@screen), 오른쪽 = 컴포넌트 목록(@spec), 왼쪽 = 원래 화면(번호표와 점선으로 연결 위치 표시).
// 페이지 CSS와 섞이지 않게 Shadow DOM 안에 그린다. 페이지를 줄여 보여주려고 html에 transform을 걸면
//   position:fixed 요소의 기준이 html 상자로 바뀌므로, 오버레이 좌표는 모두 html 상자 기준(origin)으로 계산한다.
(() => {
  if (window.__specView) return;
  window.__specView = true;

  const HEADER_H = 76, PANEL_W = 360, FOOT_H = 76;
  const STORE_KEY = 'spec-view.open';
  const ACCENT = '#9db4ff', ACCENT_DEEP = '#5b6fb8';
  const KIND_COLOR = { dom: '#9db4ff', '3d': '#7fd8bd', logic: '#c9b0ff' };
  const KIND_LABEL = { dom: 'dom', '3d': '3d', logic: '로직' };

  const host = document.createElement('div');
  host.style.cssText = 'all:initial';
  document.documentElement.appendChild(host);
  const sh = host.attachShadow({ mode: 'open' });
  sh.innerHTML = `<style>
    *{box-sizing:border-box}
    .fab,.header,.panel{font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',system-ui,sans-serif}
    .mono{font-family:ui-monospace,'JetBrains Mono',Menlo,monospace}
    button{font:inherit;cursor:pointer}
    .foot{position:fixed;left:100%;bottom:0;width:${PANEL_W}px;height:${FOOT_H}px;z-index:2147483000;display:flex;align-items:center;padding:0 20px;background:#22201d;border-top:1px solid #3a362f;border-left:1px solid #3a362f;color:#a89f92;font-size:12px}
    .fab{position:fixed;right:20px;bottom:16px;z-index:2147483001;display:flex;align-items:center;gap:10px;min-height:44px;padding:0 16px 0 14px;border:1px solid #3a362f;border-radius:22px;background:#1c1a17;color:#efe9e0;font-size:13px;font-weight:500;box-shadow:0 6px 20px rgba(28,26,23,.28)}
        .header{position:fixed;left:0;top:-${HEADER_H}px;width:100vw;height:${HEADER_H}px;z-index:2147483000;display:flex;align-items:center;gap:20px;padding:0 20px;background:#1c1a17;border-bottom:1px solid #3a362f;color:#efe9e0}
    .header .dev{font-size:11px;padding:3px 8px;border-radius:4px;background:#9db4ff;color:#14161f}
    .htext{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    .hrow{display:flex;align-items:baseline;gap:10px}
    .hrow .at{font-size:11px;color:#a89f92}
    .hname{font-size:17px;font-weight:700}
    .hwhy{font-size:13px;line-height:1.5;color:#d9d1c6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sw{position:relative;width:36px;height:20px;border-radius:10px;background:#5a564f;transition:background .12s}
    .sw i{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:8px;background:#efe9e0;transition:left .12s,background .12s}
    .fab.on{right:calc(20px - ${PANEL_W}px);border-color:#5b6fb8;background:#232a45}
    .fab.on .sw{background:#9db4ff}
    .fab.on .sw i{left:18px;background:#14161f}
    .panel{position:fixed;left:100%;top:0;width:${PANEL_W}px;height:calc(100% - ${FOOT_H}px);z-index:2147483000;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:#22201d;border-left:1px solid #3a362f;color:#efe9e0}
    .phead{display:flex;align-items:baseline;justify-content:space-between;padding:0 2px 2px;font-size:13px;font-weight:700}
    .phead span.mono{font-size:11px;font-weight:400;color:#a89f92}
    .card{display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:10px;border:1px solid #3a362f;background:#2b2824;transition:opacity .12s}
    .card.dim{opacity:.5}
    .card.on{border:2px solid #9db4ff;background:#262c4a;padding:13px}
    .ctop{display:flex;align-items:center;gap:8px}
    .num{width:22px;height:22px;border-radius:11px;background:#9db4ff;color:#14161f;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;flex:none}
    .num.logic{background:none;border:1px dashed #a89f92;color:#a89f92}
    .ctitle{font-size:15px;font-weight:700}
    .kind{margin-left:auto;font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid}
    .row{display:flex;gap:10px;font-size:13px;line-height:1.5}
    .row .k{flex:0 0 36px;font-size:12px;color:#a89f92;padding-top:2px}
    .row .v{color:#e4ddd2;min-width:0;overflow-wrap:anywhere}
    .row .v.empty{color:#8f867a;font-style:italic}
    .where{font-size:12px;color:#b8afa2;overflow-wrap:anywhere;margin-top:-4px}
    .zone{display:flex;align-items:baseline;justify-content:space-between;margin-top:6px;padding:0 2px;font-size:12px;font-weight:700;color:#d9d1c6;letter-spacing:.02em}
    .zone span.mono{font-weight:400;font-size:11px;color:#a89f92}
    .sum{display:flex;gap:8px;flex:none}
    .chip{display:flex;align-items:baseline;gap:6px;min-height:36px;padding:0 12px;border:1px solid #3a362f;border-radius:18px;background:#2b2824;color:#efe9e0;font-size:13px;align-items:center}
    .chip b{font-size:15px}
    .chip.warnc b{color:#e0b25a}
    .chip.sel{border-color:#9db4ff;background:#262c4a}
    .warn{font-size:12px;line-height:1.5;color:#e0b25a;padding:10px 12px;border:1px solid #5a4a22;border-radius:8px}
    .marks{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147482000}
    .box{position:absolute;border-radius:6px;outline:2px dashed #5b6fb8;outline-offset:2px;transition:opacity .12s}
    .box.on{outline:3px solid #5b6fb8;background:rgba(91,111,184,.2)}
    .box.dim{opacity:.35}
    .badge{position:absolute;left:-8px;top:-8px;width:26px;height:26px;border-radius:13px;background:#5b6fb8;color:#fff;border:2px solid #f3ebe1;font-size:12px;display:flex;align-items:center;justify-content:center}
    .hide{display:none}
  </style>
  <button class="fab" aria-pressed="false"><span>설계서 보기</span><span class="sw"><i></i></span></button>
  <div class="marks hide"></div>
  <header class="header hide">
    <span class="dev mono">DEV</span>
    <div class="htext"><div class="hrow"><span class="at mono">@screen</span><span class="hname"></span></div><div class="hwhy"></div></div>
    <div class="sum"></div>
  </header>
  <aside class="panel hide" aria-label="컴포넌트 설명"></aside>
  <div class="foot hide"><span>개발 모드 전용 · 읽기 전용</span></div>`;

  const $ = (s) => sh.querySelector(s);
  const fab = $('.fab'), marks = $('.marks'), header = $('.header'), panel = $('.panel'), foot = $('.foot');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let data = null, active = null, open = false, raf = 0, filter = 'all';
  const saved = {};

  function layout(on) {
    const s = document.documentElement.style;
    if (on) {
      ['transform', 'marginTop', 'width', 'height'].forEach((k) => { saved[k] = s[k]; });
      s.transform = 'translateZ(0)'; s.marginTop = `${HEADER_H}px`;
      s.width = `calc(100vw - ${PANEL_W}px)`; s.height = `calc(100vh - ${HEADER_H}px)`;
    } else {
      ['transform', 'marginTop', 'width', 'height'].forEach((k) => { s[k] = saved[k] || ''; });
    }
    window.dispatchEvent(new Event('resize'));
  }

  const row = (k, v, emptyText) => {
    const r = el('div', 'row'); r.append(el('span', 'k', k), el('span', v ? 'v' : 'v empty', v || emptyText || '미작성')); return r;
  };

  const isLogic = (s) => s.kind === 'logic';
  const missing = (s) => !s.why || !s.basis;

  function renderSummary() {
    const sum = $('.sum'); sum.textContent = '';
    const chip = (key, label, n, cls) => {
      const b = el('button', `chip${cls ? ` ${cls}` : ''}${filter === key ? ' sel' : ''}`);
      b.append(el('span', null, label), el('b', 'mono', String(n)));
      b.addEventListener('click', () => { filter = filter === key && key !== 'all' ? 'all' : key; renderPanel(); });
      sum.append(b);
    };
    chip('all', '컴포넌트', data.specs.length);
    chip('missing', '미작성', data.specs.filter(missing).length);
    chip('warn', '확인 필요', data.warnings.length, 'warnc');
  }

  function renderPanel() {
    panel.textContent = '';
    renderSummary();
    if (filter === 'warn') {
      panel.append(el('div', 'phead', '확인 필요'));
      if (!data.warnings.length) panel.append(el('div', 'row', '없음'));
      data.warnings.forEach((w) => panel.append(el('div', 'warn', w)));
      return;
    }
    const zones = [['화면 요소', data.ordered.filter((s) => !isLogic(s))], ['로직 (화면에 없음)', data.ordered.filter(isLogic)]];
    for (const [name, list] of zones) {
      const shown = list.filter((s) => filter !== 'missing' || missing(s));
      if (!shown.length) continue;
      const z = el('div', 'zone'); z.append(el('span', null, name), el('span', 'mono', `${shown.length}개`)); panel.append(z);
      shown.forEach((s) => {
        const color = KIND_COLOR[s.kind] || '#c9b0ff';
        const card = el('article', 'card'); card.dataset.id = s.id;
        const top = el('div', 'ctop');
        top.append(el('span', `num mono${isLogic(s) ? ' logic' : ''}`, String(data.num[s.id])), el('span', 'ctitle', s.title));
        const kind = el('span', 'kind mono', KIND_LABEL[s.kind] || s.kind); kind.style.color = color; kind.style.borderColor = color;
        top.append(kind);
        card.append(top, el('div', 'where mono', `${s.file}:${s.line}`), row('이유', s.why), row('근거', s.basis));
        if (s.contract) card.append(row('약속', s.contract));
        card.addEventListener('mouseenter', () => setActive(s.id));
        card.addEventListener('mouseleave', () => setActive(null));
        panel.append(card);
      });
    }
    renderMarks();
  }

  function renderMarks() {
    marks.textContent = '';
    data.specs.forEach((s) => {
      if (s.kind !== 'dom') return;
      const box = el('div', 'box'); box.dataset.id = s.id; box.dataset.sel = s.anchor.slice(4);
      box.append(el('span', 'badge mono', String(data.num[s.id])));
      marks.append(box);
    });
    syncState(); track();
  }

  // 대상 요소의 현재 위치를 따라간다 (창 크기·스크롤·애니메이션으로 움직이므로 열려 있는 동안 매 프레임)
  function track() {
    cancelAnimationFrame(raf);
    if (!open) return;
    const o = marks.getBoundingClientRect();
    marks.querySelectorAll('.box').forEach((b) => {
      let t = null;
      try { t = document.querySelector(b.dataset.sel); } catch { /* 잘못된 선택자는 못 찾음으로 */ }
      if (!t) { b.style.display = 'none'; return; }
      const r = t.getBoundingClientRect();
      b.style.display = ''; b.style.left = `${r.left - o.left}px`; b.style.top = `${r.top - o.top}px`;
      b.style.width = `${r.width}px`; b.style.height = `${r.height}px`;
    });
    raf = requestAnimationFrame(track);
  }

  function setActive(id) { active = id; syncState(); }
  function syncState() {
    for (const n of [...panel.querySelectorAll('.card'), ...marks.querySelectorAll('.box')]) {
      n.classList.toggle('on', active === n.dataset.id);
      n.classList.toggle('dim', !!active && active !== n.dataset.id);
    }
  }

  async function show(on) {
    open = on;
    try { localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch { /* 저장소가 막힌 환경 */ }
    fab.classList.toggle('on', on); fab.setAttribute('aria-pressed', String(on));
    [marks, header, panel, foot].forEach((n) => n.classList.toggle('hide', !on));
    layout(on);
    if (!on) { cancelAnimationFrame(raf); return; }
    try {
      data = await (await fetch('/__spec/spec.json', { cache: 'no-store' })).json();
      data.ordered = [...data.specs.filter((x) => !isLogic(x)), ...data.specs.filter(isLogic)];
      data.num = Object.fromEntries(data.ordered.map((x, i) => [x.id, i + 1]));
      $('.hname').textContent = data.screen ? data.screen.name : '(@screen 없음)';
      $('.hwhy').textContent = data.screen ? data.screen.why : '';
      renderPanel();
    } catch (e) {
      panel.textContent = '';
      panel.append(el('div', 'warn', `설계 목록을 읽지 못했다: ${e}`));
    }
  }

  fab.addEventListener('click', () => show(!open));
  let was = false;
  try { was = localStorage.getItem(STORE_KEY) === '1'; } catch { /* 없음 */ }
  if (was) show(true);
  window.__specViewShow = show;
})();
