/**
 * @spec test-screen 테스트 화면
 * @why 사용자가 테스트에서 하는 일(실제 화면을 눌러 보고, 이상한 곳을 짚고, 승인이나 반려)을 한 화면에서 끝내게 한다. 에이전트가 올린 카드만 보면 에이전트가 보이고 싶은 것만 보게 되므로, 중심은 에이전트가 보여 주지 않은 곳을 사용자가 직접 짚어 알리는 도구다. 점검 세션이 이미 확인한 것은 접힌 한 줄로만 보여 중복해서 보지 않게 한다.
 * @basis 요청 상세의 하위 화면(#/manage/<번호>/test)이고 오른쪽은 다른 화면과 같은 공통 패널 자리를 쓴다(새 영역을 만들지 않는다). 가운데는 테스트 데이터로 뜬 실제 화면(테스트 서버, 없으면 운영 앱)이다. 안쪽 화면은 출처가 달라 직접 못 읽으므로 짚기 도우미(test-probe.ts)에게 메시지로 부품 이름·위치와 캡처를 받는다. 짚은 것은 서버에 요청별로 저장되어 새로고침해도 남는다(브라우저에 담지 않는다).
 * @contract 서버의 /__spec/request/test-note*, test-approve, test-problem으로만 쓴다. 점검을 거쳐 사용자 차례(테스트 승인 대기)일 때만 짚고 끝낼 수 있다. 짚기는 도구줄의 짚기 켜기(또는 Alt를 누르는 동안)에 켜지고, 켜진 동안 눌러서 부품, 끌어서 영역을 짚는다.
 * @does 점검이 끝나 확인하세요가 온 요청의 테스트 화면을 연다 | 가운데 실제 화면, 위 도구줄, 오른쪽 공통 패널 자리에 짚은 것 목록과 아래 승인·반려가 보인다 | 화면을 눌러 보며 이상한 곳을 짚고 끝낸다#1 | → 2
 * @does 짚기를 켜고 부품을 누르거나 영역을 끌고 한 줄을 쓴 뒤 Enter를 누른다 | 부품 테두리와 이름이 뜨고 한 줄 입력칸이 바로 열리며, Enter를 치면 담기 단계 없이 목록에 쌓이고 캡처는 뒤에서 붙는다 | 화면을 눌러 보며 이상한 곳을 짚고 끝낸다#2 | → 3
 * @does 짚은 것이 없으면 승인, 있으면 "쌓인 N건 모두 반려"를 누른다 | 승인하면 요청이 끝나고, 반려하면 짚은 것이 모두 한 묶음으로 담당에게 가며 요청 상세로 돌아간다 | 화면을 눌러 보며 이상한 곳을 짚고 끝낸다#3
 * @does 고쳐져 돌아온 요청의 테스트 화면을 연다 | 지난번에 짚은 것만 지난번과 지금 캡처로 보인다 | 고쳐져 돌아온 것만 다시 확인한다#1 | → 2
 * @does 항목마다 "고쳐졌다" 또는 "아직이다"를 누른다 | 모두 고쳐졌으면 승인이 켜지고, 아직인 것은 모아서 반려할 수 있다 | 고쳐져 돌아온 것만 다시 확인한다#2
 */
import { h, post, chip, toast, errorText, sidePanel } from './util.js';
import type { Kid } from './util.js';
import { hash, nav, liveAt } from './route.js';
import type { Model, RequestView, TestNote } from '../types.js';

interface Box { x: number; y: number; w: number; h: number }
interface Hit { box: Box; label: string; src?: string }
interface Reply { spec: 'probe-reply'; id: number; url?: string; part?: Hit | null; shot?: string; error?: string }

/** 캡처 위에 짚은 곳을 붉은 네모로 그린다(부품·영역일 때). 못 그리면 원본을 그대로 돌려준다 */
async function mark(dataUrl: string, box: Box | null): Promise<string> {
  if (!box || !dataUrl) return dataUrl;
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('캡처를 못 읽음')); img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    if (!g) return dataUrl;
    g.drawImage(img, 0, 0);
    g.lineWidth = 3; g.strokeStyle = '#ff5a5a'; g.fillStyle = 'rgba(255,90,90,.12)';
    g.fillRect(box.x, box.y, box.w, box.h); g.strokeRect(box.x, box.y, box.w, box.h);
    return c.toDataURL('image/png');
  } catch { return dataUrl; }
}

/** 테스트 화면을 그린다. root는 요청 상세 하위 화면이 그려지는 자리 */
export function testScreen(root: HTMLElement, { model, r, screen, onChange }: { model: Model; r: RequestView; screen: string; onChange: () => void }): void {
  const review = r.test?.review;
  let notes: TestNote[] = (r.test?.notes ?? []).map((n) => ({ ...n }));
  const myTurn = r.stage === 'test' && r.step === 'requested' && !!review;

  // ── 틀: 가운데 실제 화면 + 오른쪽 공통 패널 자리 ──
  const scr = model.screens.find((s) => s.name === screen)?.name ?? r.scope.screens.find((n) => model.screens.some((s) => s.name === n)) ?? model.screens[0]?.name ?? '';
  const route = (scr && liveAt(model, scr, r.id)) || '/';
  const url = model.reviewFrame ? new URL(route, model.reviewFrame.url).href : route;
  const frame = h('iframe', { title: '테스트 데이터로 뜬 실제 화면' });
  const ov = h('div', { class: 'tv-ov' });
  const pinsEl = h('div', { class: 'tv-pins' });
  const hl = h('div', { class: 'tv-hl hidden' });
  const pop = h('div', { class: 'tv-pop hidden' });
  const stage = h('div', { class: `stage${model.reviewFrame ? ' td' : ''}` }, frame, pinsEl, hl, ov, pop,
    model.reviewFrame ? [h('div', { class: 'td-band' }, '테스트 데이터로 보는 화면입니다 · 운영 데이터가 아닙니다'), h('div', { class: 'td-edge' })] : null);
  let side: HTMLElement = h('aside', { class: 'sidepanel' });

  // ── 안쪽 화면과 메시지로 대화한다(안쪽은 출처가 달라 직접 못 읽는다) ──
  let seq = 0, pageUrl = '';
  const waiting = new Map<number, (m: Reply | null) => void>();
  const onMessage = (e: MessageEvent): void => {
    if (!document.contains(frame)) { window.removeEventListener('message', onMessage); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); return; }
    if (e.source !== frame.contentWindow) return;
    const d = e.data as Reply | { spec: 'probe-key'; down: boolean } | null;
    if (!d) return;
    if (d.spec === 'probe-key') { altHeld = d.down; syncPicking(); return; }
    if (d.spec !== 'probe-reply') return;
    if (d.url) { pageUrl = d.url; drawPins(); }
    waiting.get(d.id)?.(d); waiting.delete(d.id);
  };
  window.addEventListener('message', onMessage);
  const targetOrigin = (): string => { try { return new URL(frame.src, location.href).origin; } catch { return '*'; } };
  const ask = (type: 'at' | 'capture' | 'info', extra: object = {}): Promise<Reply | null> => new Promise((ok) => {
    const w = frame.contentWindow;
    if (!w) return ok(null);
    const id = ++seq;
    waiting.set(id, ok);
    w.postMessage({ spec: 'probe', id, type, ...extra }, targetOrigin());
    window.setTimeout(() => { if (waiting.delete(id)) ok(null); }, type === 'capture' ? 9000 : 2500);
  });

  // ── 짚기: 켜진 동안 눌러서 부품, 끌어서 영역 ──
  let toggled = false, altHeld = false;
  const picking = (): boolean => myTurn && (toggled || altHeld);
  const pickBtn = h('button', { class: 'btn sm', onclick: () => { toggled = !toggled; syncPicking(); } }, '짚기 켜기');
  function syncPicking(): void {
    ov.classList.toggle('on', picking());
    pickBtn.textContent = toggled ? '짚기 끄기' : '짚기 켜기';
    pickBtn.classList.toggle('pri', toggled);
    if (!picking()) hl.classList.add('hidden');
  }
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Alt') { altHeld = e.type === 'keydown'; syncPicking(); } };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
  const frameRect = (): DOMRect => frame.getBoundingClientRect();
  const stageRect = (): DOMRect => stage.getBoundingClientRect();
  /** 안쪽 화면 좌표의 네모를 이 틀(stage) 위 좌표로 옮겨 보인다 */
  const place = (el: HTMLElement, b: Box): void => {
    const fr = frameRect(), sr = stageRect();
    el.style.left = `${fr.left - sr.left + b.x}px`; el.style.top = `${fr.top - sr.top + b.y}px`; el.style.width = `${b.w}px`; el.style.height = `${b.h}px`;
  };
  let hovering = false;
  ov.addEventListener('mousemove', (ev) => {
    if (drag) { const b = dragBox(ev); place(hl, b); hl.dataset.label = '영역'; hl.classList.remove('hidden'); return; }
    if (hovering) return;
    hovering = true;
    const fr = frameRect();
    void ask('at', { x: ev.clientX - fr.left, y: ev.clientY - fr.top }).then((m) => {
      hovering = false;
      if (!picking()) return;
      if (m?.part) { place(hl, m.part.box); hl.dataset.label = m.part.label; hl.classList.remove('hidden'); } else hl.classList.add('hidden');
    });
  });
  let drag: { x: number; y: number } | null = null;
  const local = (ev: MouseEvent): { x: number; y: number } => { const fr = frameRect(); return { x: ev.clientX - fr.left, y: ev.clientY - fr.top }; };
  const dragBox = (ev: MouseEvent): Box => { const p = local(ev), d = drag as { x: number; y: number }; return { x: Math.min(p.x, d.x), y: Math.min(p.y, d.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) }; };
  ov.addEventListener('mousedown', (ev) => { ev.preventDefault(); drag = local(ev); });
  ov.addEventListener('mouseup', (ev) => {
    if (!drag) return;
    const b = dragBox(ev), start = drag;
    drag = null; hl.classList.add('hidden');
    if (b.w < 8 && b.h < 8) void pickPart(start.x, start.y, ev); else void pickRegion(b, ev);
  });

  /** 짚는 순간 화면을 찍어 두는 일. 저장은 이 결과를 기다리지 않는다 */
  const takeShot = async (box: Box | null): Promise<string> => { const m = await ask('capture'); return m?.shot ? mark(m.shot, box) : ''; };
  async function pickPart(x: number, y: number, ev: MouseEvent): Promise<void> {
    const m = await ask('at', { x, y });
    // 글이 있는 덩어리를 못 찾은 자리(빈 틈 등)는 누른 자리 둘레를 영역으로 짚는다. 눌렀는데 아무 일도 없으면 사용자가 헷갈리기 때문이다
    if (!m?.part) {
      const b: Box = { x: Math.max(0, x - 80), y: Math.max(0, y - 40), w: 160, h: 80 };
      openEditor({ kind: 'region', label: `${pageLabel(m)} › 누른 자리 둘레`, box: b }, takeShot(b), ev);
      return;
    }
    openEditor({ kind: 'part', label: m.part.label, box: m.part.box, ...(m.part.src ? { src: m.part.src } : {}) }, takeShot(m.part.box), ev);
  }
  async function pickRegion(b: Box, ev: MouseEvent): Promise<void> {
    const info = await ask('info');
    openEditor({ kind: 'region', label: `${pageLabel(info)} › 그려서 지정한 영역`, box: b }, takeShot(b), ev);
  }
  const pageLabel = (m: Reply | null): string => (m?.url ?? pageUrl) || scr || '화면';
  async function pickScreen(): Promise<void> {
    const info = await ask('info');
    openEditor({ kind: 'screen', label: `${pageLabel(info)} › 화면 전체` }, takeShot(null), null);
  }

  /** 한 줄 입력칸을 짚은 자리 옆에 연다. Enter로 저장하면 바로 목록에 쌓이고, 캡처는 오는 대로 붙는다 */
  function openEditor(t: { kind: TestNote['kind']; label: string; box?: Box; src?: string }, shotP: Promise<string>, ev: MouseEvent | null): void {
    const input = h('input', { class: 'cm-ta', placeholder: '무엇이 이상한지 한 줄', style: 'width:100%;padding:8px' }) as HTMLInputElement;
    const close = (): void => { pop.classList.add('hidden'); pop.replaceChildren(); };
    const save = async (): Promise<void> => {
      const text = input.value.trim();
      if (!text) { toast('한 줄을 쓰세요'); return; }
      close();
      try {
        const n = await post<TestNote>('/__spec/request/test-note', { id: r.id, kind: t.kind, label: t.label, url: pageUrl || url, text, ...(t.src ? { src: t.src } : {}), ...(t.box ? { box: t.box } : {}) });
        notes.push(n); drawPins(); drawSide();
        const shot = await shotP;
        if (shot) { const withShot = await post<TestNote>('/__spec/request/test-note-shot', { id: r.id, note: n.id, shot }); const i = notes.findIndex((x) => x.id === n.id); if (i >= 0) notes[i] = withShot; drawSide(); } else toast('캡처는 못 찍었습니다. 글은 저장됐습니다');
      } catch (e) { toast(errorText(e)); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } else if (e.key === 'Escape') close(); });
    const sr = stageRect();
    const at = ev ? { x: Math.min(Math.max(ev.clientX - sr.left, 10), Math.max(10, sr.width - 460)), y: Math.min(ev.clientY - sr.top + 14, Math.max(10, sr.height - 130)) } : { x: Math.max(10, sr.width / 2 - 220), y: Math.max(10, sr.height / 2 - 60) };
    pop.style.left = `${at.x}px`; pop.style.top = `${at.y}px`;
    pop.replaceChildren(h('div', { class: 'hint', style: 'margin:0 0 6px' }, `${t.label} · 화면 이름·위치·캡처는 자동으로 붙습니다`), input, h('div', { class: 'hint', style: 'margin:6px 0 0' }, 'Enter 저장 · Esc 취소 · 저장하면 바로 목록에 쌓입니다'));
    pop.classList.remove('hidden');
    input.focus();
  }

  /** 짚은 것의 번호핀: 지금 보는 안쪽 화면 주소와 같은 곳에서 짚은 것만 그 자리에 보인다(스크롤은 반영하지 못한다) */
  function drawPins(): void {
    pinsEl.replaceChildren(...notes.filter((n) => n.box && (n.status === 'open' || n.status === 'still') && (!pageUrl || n.url === pageUrl)).map((n) => {
      const b = n.box as Box, fr = frameRect(), sr = stageRect();
      return h('div', { class: 'tv-pin', style: `left:${fr.left - sr.left + b.x - 8}px;top:${fr.top - sr.top + b.y - 8}px` }, n.id);
    }));
  }

  // ── 오른쪽 패널 ──
  const noteShot = (n: TestNote, which: 'shot' | 'afterShot'): HTMLElement => {
    const f = n[which];
    return f ? h('img', { class: 'tv-thumb', src: `/__spec/shots/${f}`, alt: which === 'shot' ? '짚은 때 캡처' : '고친 뒤 캡처' }) : h('div', { class: 'tv-thumb none' }, which === 'shot' ? (n.status === 'open' ? '캡처 붙이는 중…' : '캡처 없음') : '점검이 다시 못 찍음 · 화면에서 직접 확인');
  };
  const run = async (fn: () => Promise<unknown>, ok = ''): Promise<void> => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(errorText(e)); } };
  const update = (n: TestNote): void => { const i = notes.findIndex((x) => x.id === n.id); if (i >= 0) notes[i] = n; drawPins(); drawSide(); };
  function openNote(n: TestNote): HTMLElement {
    const kind = n.kind === 'part' ? '부품' : n.kind === 'region' ? '영역' : '화면 전체';
    const text = h('div', { class: 'tv-text', title: '눌러서 고치기', onclick: () => {
      const inp = h('input', { class: 'cm-ta', value: n.text, style: 'width:100%;padding:6px' }) as HTMLInputElement;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') void run(async () => update(await post<TestNote>('/__spec/request/test-note-edit', { id: r.id, note: n.id, text: inp.value }))); else if (e.key === 'Escape') drawSide(); });
      text.replaceWith(inp); inp.focus();
    } }, n.text);
    return h('div', { class: 'box tv-note' },
      h('div', { class: 'tv-pin', style: 'position:static;flex:none' }, n.id),
      h('div', { class: 'tv-nb' }, h('div', { class: 'tv-nk' }, `${kind} · ${n.label}`), text, noteShot(n, 'shot'),
        h('div', { class: 'tv-act' },
          n.sentNow ? chip('ok', '먼저 알림 ✓') : h('button', { class: 'btn sm', onclick: () => { void run(async () => { await post('/__spec/request/test-note-now', { id: r.id, note: n.id }); update({ ...n, sentNow: true }); }, '담당에게 먼저 알렸습니다. 고치는 것은 반려한 뒤입니다'); } }, '이것만 지금 보내기'),
          h('button', { class: 'btn sm', onclick: () => { void run(async () => { await post('/__spec/request/test-note-delete', { id: r.id, note: n.id }); notes = notes.filter((x) => x.id !== n.id); drawPins(); drawSide(); }); } }, '지우기'))));
  }
  function recheckNote(n: TestNote): HTMLElement {
    const answer = (a: 'fixed' | 'still'): void => { void run(async () => update(await post<TestNote>('/__spec/request/test-note-answer', { id: r.id, note: n.id, answer: a }))); };
    return h('div', { class: 'box tv-note', style: 'flex-direction:column' },
      h('div', null, h('b', null, `${n.id}. `), n.text), h('div', { class: 'tv-nk' }, n.label),
      h('div', { class: 'tv-ba' }, h('div', null, h('div', { class: 'tv-nk' }, '전 (지난번에 짚은 때)'), noteShot(n, 'shot')), h('div', null, h('div', { class: 'tv-nk' }, '후 (점검이 같은 자리를 다시 찍음)'), noteShot(n, 'afterShot'))),
      h('div', { class: 'tv-act' }, h('button', { class: 'btn ok', onclick: () => answer('fixed') }, '고쳐졌다'), h('button', { class: 'btn bad', onclick: () => answer('still') }, '아직이다')));
  }
  function drawSide(): void {
    const open = notes.filter((n) => n.status === 'open'), still = notes.filter((n) => n.status === 'still');
    const back = notes.filter((n) => n.status === 'returned'), fixed = notes.filter((n) => n.status === 'fixed');
    const toSend = open.length + still.length;
    const approveOn = myTurn && !toSend && !back.length;
    const body: Kid[] = [];
    if (!review) body.push(h('div', { class: 'hint' }, '이 요청은 점검을 거치지 않은 옛 테스트라 요청 상세에서 확인합니다.'));
    else if (!myTurn) body.push(h('div', { class: 'box' }, h('b', null, review.state === 'running' || review.state === 'fixing' ? '점검 중입니다' : '지금은 사용자가 할 일이 없습니다'), h('div', { class: 'hint', style: 'margin:4px 0 0' }, '점검이 끝나면 알려 드립니다. 그때 이상한 곳을 짚고 승인하거나 반려합니다.')));
    else {
      if (review.failures.length) body.push(h('div', { class: 'warn' }, h('b', null, `점검이 고치지 못한 것 ${review.failures.length}건`), ...review.failures.map((f) => h('div', null, `· ${f.what}${f.detail ? ` — ${f.detail}` : ''}`))));
      if (back.length || fixed.length) body.push(h('div', null, h('b', null, back.length ? `고쳐졌는지 봐 주세요 · ${back.length}건` : '고쳐졌는지 본 것'), h('div', { class: 'hint', style: 'margin:2px 0 0' }, '지난번에 짚은 것만 다시 보입니다. 나머지는 다시 묻지 않습니다.')), ...back.map(recheckNote), ...fixed.map((n) => h('div', { class: 'box', style: 'border-color:var(--green)' }, chip('ok', '고쳐졌다 ✓'), ` ${n.text}`)));
      body.push(h('b', null, `내가 짚은 것 ${toSend}건`));
      if (!toSend) body.push(h('div', { class: 'box', style: 'text-align:center;color:var(--dim);padding:18px' }, '아직 짚은 것이 없습니다'));
      body.push(...still.map((n) => h('div', { class: 'box tv-note' }, chip('bad', '아직이다'), ` ${n.text}`)), ...open.map((n) => openNote(n)));
      body.push(h('div', { class: 'hint', style: 'margin:0' }, '도구줄의 짚기 켜기를 누르고 화면의 이상한 곳을 눌러(부품) 또는 끌어서(영역) 한 줄을 쓰세요. 화면 전체는 도구줄의 화면 전체 짚기.'));
      body.push(seenBox());
    }
    const foot: Kid[] = myTurn ? [
      h('button', { class: `btn ok${approveOn ? '' : ' off'}`, disabled: !approveOn, title: approveOn ? '' : toSend ? '짚은 것이 남아 있어 승인할 수 없습니다' : '고쳐졌는지 답해 주세요', onclick: () => { void run(async () => { await post('/__spec/request/test-approve', { id: r.id, none: false }); onChange(); nav(hash('manage', String(r.id)), true); }, '테스트를 승인했습니다'); } }, '승인'),
      h('button', { class: `btn bad${toSend ? '' : ' off'}`, disabled: !toSend, onclick: () => { void run(async () => { await post('/__spec/request/test-problem', { id: r.id, note: '' }); onChange(); nav(hash('manage', String(r.id)), true); }, '한 번에 보내고 반려했습니다. 같은 요청에서 고칩니다'); } }, toSend ? `쌓인 ${toSend}건 모두 반려` : '반려'),
      h('div', { class: 'hint', style: 'flex-basis:100%;margin:2px 0 0' }, toSend ? '짚은 것이 남아 있어 승인은 꺼져 있습니다.' : back.length ? `${back.length}건에 답하면 승인 또는 반려가 켜집니다.` : '짚은 것이 없으면 승인, 있으면 쌓인 것을 한 번에 반려합니다.')] : [];
    const next = sidePanel({ title: '짚은 것', fold: 'testscreen', body, foot });
    side.replaceWith(next); side = next;
  }
  /** 점검 세션이 이미 본 것: 접힌 한 줄(중복해서 안 보게 하는 보조) */
  function seenBox(): HTMLElement {
    const seen = review?.seen ?? [];
    return h('details', { class: 'box', style: 'padding:8px 12px' }, h('summary', { style: 'cursor:pointer;font-size:12px;color:var(--dim)' }, `에이전트가 이미 본 것 ${seen.length}건${seen.every((x) => x.ok) ? ' · 모두 통과' : ''}`),
      ...seen.map((x) => h('div', { style: 'font-size:12px;margin-top:4px' }, `${x.ok ? '✓' : '✗'} ${x.what}${x.detail ? ` — ${x.detail}` : ''}`)));
  }

  // ── 위 줄(도구줄)과 조립 ──
  const urlEl = h('span', { class: 'url mono' }, url.replace(/^https?:\/\//, ''));
  const count = h('span', { class: 'hint', style: 'margin:0' });
  const live = h('div', { class: 'live' },
    h('div', { class: 'livebar' }, h('button', { class: 'btn sm', onclick: () => nav(hash('manage', String(r.id))) }, `‹ 요청 #${r.id} 상세로`), h('b', null, `테스트 · 요청 #${r.id}`),
      review ? chip(review.state === 'passed' || review.state === 'skipped' ? 'ok' : 'wait', `${review.state === 'skipped' ? '점검 없이 직접 확인' : review.state === 'passed' ? '점검 통과' : '점검 중'} · ${review.round}번째`) : null,
      urlEl, h('span', { class: 'grow' }), myTurn ? [h('span', { class: 'hint', style: 'margin:0' }, 'Alt를 누르는 동안에도 짚을 수 있습니다'), pickBtn, h('button', { class: 'btn sm', onclick: () => { void pickScreen(); } }, '화면 전체 짚기')] : null, count),
    stage);
  const holder = h('div', { class: 'split', style: 'flex:1;min-height:0' }, live, side);
  root.append(holder);
  drawSide();
  const refreshCount = (): void => { count.textContent = `짚은 것 ${notes.filter((n) => n.status === 'open' || n.status === 'still').length}건`; };
  const t = window.setInterval(() => { if (!document.contains(frame)) { clearInterval(t); return; } refreshCount(); }, 400);
  refreshCount();

  // ── 안쪽 화면 열기: 테스트 서버가 꺼져 있으면 켠 뒤 연다 ──
  const open = (): void => { frame.src = url; };
  if (model.reviewFrame) void post('/__spec/testdata/ensure').catch(() => undefined).then(open); else open();
  frame.addEventListener('load', () => { void ask('info'); });
}
