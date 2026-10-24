/**
 * @spec comment-tool 공통 코멘트 도구
 * @shell
 * @anchor dom:.cm-fab
 * @why 어느 화면에서든 같은 단추 하나로 화면의 어느 부분인지 정해 에이전트에게 바로 묻거나 요청할 수 있어야 한다. 설명이 애매할 때는 부품을 고르거나 화면 캡처를 같이 보내는 것이 가장 정확하다. 화면마다 코멘트 기능을 따로 만들지 않고, 모든 화면 위에 얹히는 도구 하나로 둔다.
 * @basis 대상은 세 방식으로 정한다: 부품 고르기(화면 위 번호표나 data-ctarget이 붙은 곳), 영역 그리기(끌어서 네모), 화면 전체. 글쓰기와 대화는 오른쪽 코멘트 창에서만 한다. 코멘트는 서버(.spec/comments.json)에 쌓이고 에이전트가 명령으로 읽고 답한다.
 * @contract 화면 코드는 이 도구를 모르고, 눌러서 코멘트 대상이 될 곳에 data-ctarget(JSON)만 붙인다. 모델이 바뀌어도 이 도구는 다시 그려지지 않고 update(model)만 받는다.
 */
import { h, post, chip, tag, toast, errorText } from './util.js';
import type { Kid } from './util.js';
import { nav } from './route.js';
import type { Comment, CommentTarget, Model } from '../types.js';

type Mode = 'part' | 'region' | 'screen';
const MODES: [Mode, string][] = [['part', '부품 고르기'], ['region', '영역 그리기'], ['screen', '화면 전체']];
const STATUS: Record<Comment['status'], { label: string; tone: 'me' | 'ok' | 'dim' }> = { waiting: { label: '답 기다림', tone: 'me' }, answered: { label: '답함', tone: 'ok' }, closed: { label: '닫힘', tone: 'dim' } };

/** 지금 보는 곳(주소)의 이름 */
function viewLabel(hashText: string): { label: string; screen?: string } {
  const [pathPart] = hashText.slice(1).split('?');
  const p = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const v = p[0] || 'flow';
  if (v === 'screen') return { label: `화면 설계서 › ${p[1] ?? ''}`, screen: p[1] };
  if (v === 'flow') return { label: '사용 흐름' };
  if (v === 'info') return { label: p[1] ? `정보 흐름 › ${p[1]}` : '정보 흐름' };
  if (v === 'manage' && p[1] === 'reports') return { label: '리포트' };
  if (v === 'manage' && p[1] === 'designs') return { label: '시안 현황' };
  if (v === 'manage' && p[1] === 'glossary') return { label: '용어집' };
  if (v === 'manage') return { label: p[1] ? `요청 #${p[1]}` : '요청 목록' };
  return { label: v };
}

/** 화면 캡처: 화면 설계서에서는 실제 화면(프레임 안)을, 그 밖에는 설계서 보기 본문을 찍는다. 못 찍으면 빈 글(코멘트는 캡처 없이 간다) */
async function capture(target: CommentTarget): Promise<string> {
  try {
    const w = window as unknown as { htmlToImage?: { toPng: (n: HTMLElement, o?: object) => Promise<string> } };
    if (!w.htmlToImage) await new Promise<void>((ok, bad) => { const s = document.createElement('script'); s.src = '/__spec/vendor/html-to-image.js'; s.onload = () => ok(); s.onerror = () => bad(new Error('캡처 도구를 못 불러옴')); document.head.append(s); });
    const frame = document.querySelector<HTMLIFrameElement>('iframe');
    const node = (frame?.contentDocument?.documentElement ?? document.getElementById('app')) as HTMLElement;
    // 찍는 도구는 스크롤을 무시하고 맨 위부터 그리므로, 프레임은 스크롤 값을 좌표에 더하고 안쪽 스크롤 칸은 찍는 동안만 내용을 밀어 맞춘다
    const win = frame?.contentWindow;
    const scroll = { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 };
    const undo = unscroll(node, !!frame);
    let url: string;
    try { url = await (window as unknown as { htmlToImage: { toPng: (n: HTMLElement, o?: object) => Promise<string> } }).htmlToImage.toPng(node, { pixelRatio: 1, filter: (n: Node) => !(n instanceof HTMLElement && n.classList.contains('cm-ui')) }); }
    finally { undo.forEach((f) => f()); }
    return await mark(url, target, frame ? frame.getBoundingClientRect() : document.getElementById('app')?.getBoundingClientRect() ?? null, scroll);
  } catch { return ''; }
}

/** 스크롤된 칸의 내용을 스크롤 값만큼 밀어, 스크롤을 무시하는 캡처에도 지금 보이는 모습 그대로 찍히게 한다. 되돌리는 함수들을 준다 */
function unscroll(root: HTMLElement, skipRoot: boolean): (() => void)[] {
  const undo: (() => void)[] = [];
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (skipRoot && el === root) continue; // 프레임 문서 자체의 스크롤은 좌표에 더해 맞춘다
    const sl = el.scrollLeft, st = el.scrollTop;
    if (!sl && !st) continue;
    const kids = [...el.children].filter((k): k is HTMLElement => k instanceof HTMLElement), old = kids.map((k) => k.style.transform);
    kids.forEach((k) => { k.style.transform = `translate(${-sl}px, ${-st}px) ${k.style.transform}`; });
    undo.push(() => kids.forEach((k, i) => { k.style.transform = old[i]; }));
  }
  return undo;
}

/** 찍은 그림에 고른 부분을 표시한다: 영역은 그 자리만 잘라 내고(바깥은 어둡게 두지 않고 잘라서), 부품은 테두리를 그린다 */
async function mark(dataUrl: string, target: CommentTarget, base: DOMRect | null, scroll: { x: number; y: number }): Promise<string> {
  const box = target.rect ?? target.box;
  if (!box || !base) return dataUrl;
  const img = new Image(); img.src = dataUrl; await img.decode();
  const x = box.x - base.left + scroll.x, y = box.y - base.top + scroll.y, w = box.w, hh = box.h;
  const c = document.createElement('canvas');
  if (target.kind === 'region') {
    const sx = Math.max(0, x), sy = Math.max(0, y), cw = Math.min(img.width - sx, w), ch = Math.min(img.height - sy, hh);
    if (cw < 8 || ch < 8) return dataUrl;
    c.width = cw; c.height = ch; c.getContext('2d')?.drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch); return c.toDataURL('image/png');
  }
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); if (!g) return dataUrl;
  g.drawImage(img, 0, 0); g.lineWidth = 4; g.strokeStyle = '#5b6fb8'; g.strokeRect(x - 2, y - 2, w + 4, hh + 4); g.fillStyle = 'rgba(91,111,184,.12)'; g.fillRect(x, y, w, hh);
  return c.toDataURL('image/png');
}

/** 화면 틀이 쥐고 있는 코멘트 도구: 모델이 바뀌면 update로 알려 준다 */
export interface CommentTool {
  /** 새 모델을 받아 코멘트 목록만 다시 그린다 */
  update(model: Model): void;
}

/** 단추·코멘트 창·고르기 막대를 문서에 얹는다 */
export function commentTool(init: Model): CommentTool {
  let model = init, open = false, picking = false, mode: Mode = 'part', filter: 'here' | 'all' | 'waiting' = 'all';
  let draft: { target: CommentTarget; shot: string; text: string } | null = null;
  const replyText = new Map<number, string>();
  const replying = new Set<number>();
  let lastSig = '';

  const fab = h('button', { class: 'cm-ui cm-fab', onclick: () => { open = !open; if (!open) stopPick(); draw(); } });
  const bar = h('div', { class: 'cm-ui cm-bar hidden' });
  const dim = h('div', { class: 'cm-ui cm-dim hidden' });
  const drawer = h('aside', { class: 'cm-ui cm-drawer hidden' });
  document.body.append(fab, dim, bar, drawer);

  const here = (): string => viewLabel(location.hash).label;
  /** 코멘트를 남긴 곳이 지금 보는 곳과 같은가(쿼리·선택 상태는 빼고 주소의 앞 두 칸만 본다) */
  const sameView = (c: Comment): boolean => { const k = (u = ''): string => u.slice(1).split('?')[0].split('/').slice(0, 3).join('/'); return k(c.target.view) === k(location.hash); };
  const live = (): Comment[] => model.comments.filter((c) => c.status !== 'closed');

  function stopPick(): void { picking = false; document.body.classList.remove('cm-picking'); bar.classList.add('hidden'); dim.classList.add('hidden'); hover?.remove(); hover = null; }
  let hover: HTMLElement | null = null;
  const showHover = (r: { left: number; top: number; width: number; height: number } | null, text = ''): void => {
    if (!r) { hover?.remove(); hover = null; dim.classList.toggle('hidden', !picking); return; }
    if (!hover) { hover = h('div', { class: 'cm-ui cm-hover' }); document.body.append(hover); }
    hover.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`; hover.dataset.t = text;
    dim.classList.add('hidden');
  };
  function drawBar(): void {
    bar.replaceChildren(h('b', null, '코멘트 모드 · 화면에서 대상을 고르고, 글은 오른쪽에 쓰세요'),
      h('span', { class: 'cm-modes' }, MODES.map(([k, l]) => h('button', { class: k === mode ? 'on' : '', onclick: () => { mode = k; showHover(null); drawBar(); if (k === 'screen') pickScreen(); } }, l))),
      h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => { stopPick(); draw(); } }, '끝내기'));
  }
  function startPick(): void { open = true; picking = true; document.body.classList.add('cm-picking'); bar.classList.remove('hidden'); dim.classList.remove('hidden'); drawBar(); draw(); }

  /** 화면 설계서에서 점 위의 부품(가장 작은 번호표 틀)을 찾는다 */
  function partAt(x: number, y: number): { el: HTMLElement; target: CommentTarget } | null {
    const v = viewLabel(location.hash);
    let best: HTMLElement | null = null, area = Infinity;
    for (const e of document.querySelectorAll<HTMLElement>('.mbox')) {
      const r = e.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width * r.height < area) { best = e; area = r.width * r.height; }
    }
    if (best) {
      const sp = model.specs.find((s) => s.id === best?.dataset.id);
      const no = best.querySelector('.mbadge')?.textContent ?? '';
      const br = best.getBoundingClientRect();
      return { el: best, target: { kind: 'part', box: { x: br.left, y: br.top, w: br.width, h: br.height }, label: `${v.screen ?? v.label} › ${no ? `${no} ` : ''}${sp?.title ?? best.dataset.id ?? ''}`, view: location.hash, screen: v.screen, part: sp?.title ?? best.dataset.id, src: sp ? `${sp.file}:${sp.line}` : undefined } };
    }
    return null;
  }
  function targetAt(ev: MouseEvent): { box: DOMRect; target: CommentTarget } | null {
    const hit = partAt(ev.clientX, ev.clientY);
    if (hit) return { box: hit.el.getBoundingClientRect(), target: hit.target };
    const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-ctarget]');
    if (el?.dataset.ctarget) { try { return { box: el.getBoundingClientRect(), target: { ...(JSON.parse(el.dataset.ctarget) as CommentTarget), view: location.hash } }; } catch { return null; } }
    return looseAt(ev.clientX, ev.clientY);
  }
  /** 번호표·data-ctarget이 없는 곳: 누른 자리의 요소에서 위로 올라가, 글이 있고 화면 대부분을 덮지 않는 가장 가까운 덩어리를 대상으로 한다. 실제 화면(iframe) 안도 같다 */
  function looseAt(x: number, y: number): { box: DOMRect; target: CommentTarget } | null {
    const frame = document.querySelector<HTMLIFrameElement>('.stage iframe');
    const fr = frame?.getBoundingClientRect();
    const inFrame = !!fr && x >= fr.left && x <= fr.right && y >= fr.top && y <= fr.bottom;
    const doc = inFrame ? frame?.contentDocument : document;
    let el = doc?.elementFromPoint(x - (inFrame && fr ? fr.left : 0), y - (inFrame && fr ? fr.top : 0)) as HTMLElement | null | undefined;
    const root = (inFrame ? fr : document.getElementById('app')?.getBoundingClientRect()) as DOMRect;
    while (el && el !== doc?.body && el !== doc?.documentElement) {
      const r = el.getBoundingClientRect();
      if (el.closest('.cm-ui')) return null;
      if (r.width >= 24 && r.height >= 16 && r.width * r.height < root.width * root.height * 0.6 && (el.textContent ?? '').trim()) {
        const ox = inFrame && fr ? fr.left : 0, oy = inFrame && fr ? fr.top : 0, v = viewLabel(location.hash);
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
        const box = new DOMRect(r.left + ox, r.top + oy, r.width, r.height);
        return { box, target: { kind: 'item', label: `${v.label} › ${text}`, view: location.hash, screen: v.screen, box: { x: box.x, y: box.y, w: box.width, h: box.height } } };
      }
      el = el.parentElement;
    }
    return null;
  }
  async function pickTarget(target: CommentTarget): Promise<void> {
    stopPick(); open = true;
    draft = { target, shot: '', text: draft?.text ?? '' }; draw();
    if (target.kind === 'part' || target.kind === 'item') return; // 부품·항목은 이름과 소스 위치로 충분하다. 캡처는 영역 그리기·화면 전체에만 붙인다
    const shot = await capture(target);
    if (draft && draft.target === target) { draft.shot = shot; draw(); }
  }
  function pickScreen(): void { const v = viewLabel(location.hash); void pickTarget({ kind: 'screen', label: v.label, view: location.hash, screen: v.screen }); }

  // 고르기: 화면 위에서 마우스를 따라 후보를 보여 주고, 눌러서 정한다(드로어·막대는 제외)
  document.addEventListener('mousemove', (ev) => {
    if (!picking || mode !== 'part' || (ev.target as HTMLElement).closest('.cm-ui')) { if (picking && mode === 'part') showHover(null); return; }
    const t = targetAt(ev); showHover(t ? t.box : null, t?.target.label ?? '');
  }, true);
  let dragFrom: { x: number; y: number } | null = null;
  document.addEventListener('mousedown', (ev) => {
    if (!picking || mode !== 'region' || (ev.target as HTMLElement).closest('.cm-ui')) return;
    ev.preventDefault(); dragFrom = { x: ev.clientX, y: ev.clientY };
  }, true);
  document.addEventListener('mousemove', (ev) => {
    if (!dragFrom) return;
    showHover({ left: Math.min(dragFrom.x, ev.clientX), top: Math.min(dragFrom.y, ev.clientY), width: Math.abs(ev.clientX - dragFrom.x), height: Math.abs(ev.clientY - dragFrom.y) });
  }, true);
  document.addEventListener('mouseup', (ev) => {
    if (!dragFrom) return;
    const f = dragFrom; dragFrom = null;
    const rect = { x: Math.min(f.x, ev.clientX), y: Math.min(f.y, ev.clientY), w: Math.abs(ev.clientX - f.x), h: Math.abs(ev.clientY - f.y) };
    if (rect.w < 8 || rect.h < 8) { showHover(null); return; }
    const v = viewLabel(location.hash);
    void pickTarget({ kind: 'region', label: `${v.label} › 그려서 지정한 영역`, view: location.hash, screen: v.screen, rect });
  }, true);
  document.addEventListener('click', (ev) => {
    if (!picking || (ev.target as HTMLElement).closest('.cm-ui')) return;
    if (mode === 'part') { const t = targetAt(ev); ev.preventDefault(); ev.stopPropagation(); if (t) void pickTarget(t.target); else toast('여기는 고를 만한 덩어리가 없습니다. 글이 있는 곳을 눌러 보세요 — 영역 그리기나 화면 전체도 쓸 수 있습니다'); }
    else if (mode === 'region') { ev.preventDefault(); ev.stopPropagation(); }
  }, true);

  async function send(): Promise<void> {
    if (!draft) return;
    if (!draft.text.trim()) { toast('코멘트 글을 먼저 쓰세요'); return; }
    try { await post('/__spec/comment/add', { target: draft.target, text: draft.text, shot: draft.shot || undefined }); draft = null; toast('에이전트에게 보냈습니다'); } catch (e) { toast(errorText(e)); }
    refresh();
  }
  const refresh = (): void => { void fetch('/__spec/model.json', { cache: 'no-store' }).then((r) => r.json()).then((m: Model) => { model = m; draw(); }); };
  const act = async (url: string, body: object, ok: string): Promise<void> => { try { await post(url, body); toast(ok); } catch (e) { toast(errorText(e)); } refresh(); };

  function draftCard(): HTMLElement | null {
    if (!draft) return null;
    const d = draft, t = d.target;
    const ta = h('textarea', { class: 'cm-ta', placeholder: '무엇이 궁금하거나 바꾸고 싶은지 쓰세요', oninput: () => { d.text = ta.value; } }) as HTMLTextAreaElement;
    ta.value = d.text;
    return h('div', { class: 'cm-th new' },
      h('div', { class: 'cm-tg' }, chip('ag', '작성 중'), tag('c', t.label), t.kind === 'region' ? tag('', '영역 지정') : null),
      h('span', { class: 'hint' }, '자동으로 붙는 것: ', t.src ? h('span', { class: 'mono' }, `${t.src} · `) : null, '지금 화면 주소', d.shot ? ' · 화면 캡처' : t.kind === 'part' || t.kind === 'item' ? '' : ' · (캡처는 못 찍었습니다)'),
      ta, d.shot ? h('img', { class: 'cm-shot', src: d.shot, alt: '같이 보낼 캡처' }) : null,
      h('div', { class: 'cm-foot' }, h('button', { class: 'btn pri sm', onclick: () => { void send(); } }, '에이전트에게 보내기'), h('button', { class: 'btn sm', onclick: () => { draft = null; draw(); } }, '취소'),
        h('button', { class: 'btn sm', onclick: startPick }, '대상 다시 고르기')));
  }
  function threadCard(c: Comment): HTMLElement {
    const st = STATUS[c.status];
    const reply = h('textarea', { class: 'cm-ta', placeholder: '이어서 묻기', oninput: (e: Event) => { replyText.set(c.id, (e.target as HTMLTextAreaElement).value); } }) as HTMLTextAreaElement;
    reply.value = replyText.get(c.id) ?? '';
    return h('div', { class: 'cm-th' },
      h('div', { class: 'cm-tg' }, chip(st.tone, st.label), c.target.view ? h('a', { class: 'tag c', href: c.target.view, onclick: () => { nav(c.target.view as string); } }, c.target.label) : tag('c', c.target.label), c.request ? chip('ag', `요청 #${c.request}`) : null),
      c.thread.map((m) => h('div', { class: `cm-msg${m.who === 'agent' ? ' ag' : ''}` }, h('div', { class: 'cm-who' }, h('b', null, m.who === 'agent' ? '에이전트' : '나'), ` ${m.at.slice(5, 16).replace('T', ' ')}`, m.refs?.length ? chip('ag', `${m.refs.join(', ')} 확인함`) : null), m.text)),
      c.shot ? h('img', { class: 'cm-shot', src: `/__spec/comment-shots/${c.shot}`, alt: '같이 보낸 캡처' }) : null,
      c.status !== 'closed' ? h('div', { class: 'cm-foot' },
        replying.has(c.id) ? [reply, h('button', { class: 'btn pri sm', onclick: () => { const t = replyText.get(c.id) ?? ''; replyText.delete(c.id); replying.delete(c.id); void act('/__spec/comment/reply', { id: c.id, text: t }, '보냈습니다'); } }, '보내기')] : h('button', { class: 'btn sm', onclick: () => { replying.add(c.id); draw(); } }, '추가로 묻기'),
        c.status === 'answered' && !c.request ? h('button', { class: 'btn pri sm', onclick: () => { void act('/__spec/comment/to-request', { id: c.id, title: c.thread[0].text.slice(0, 60) }, '요청으로 만들었습니다'); } }, '이 일을 요청으로 만들기') : null,
        h('button', { class: 'btn sm', onclick: () => { void act('/__spec/comment/close', { id: c.id }, '닫았습니다'); } }, '닫기')) : null);
  }
  function draw(): void {
    const n = live().length, waiting = model.comments.filter((c) => c.status === 'waiting').length;
    fab.replaceChildren('코멘트 ', h('b', null, String(n)));
    fab.classList.toggle('moved', open);
    drawer.classList.toggle('hidden', !open);
    if (!open) return;
    const cur = here();
    const list = model.comments.filter((c) => (filter === 'waiting' ? c.status === 'waiting' : filter === 'here' ? sameView(c) : true)).sort((a, b) => b.id - a.id);
    const chips = ([['here', '이 화면'], ['all', '전체'], ['waiting', '답 기다림']] as const).map(([k, l]) => h('button', { class: `fc${filter === k ? ' on' : ''}`, onclick: () => { filter = k; draw(); } }, l, h('small', null, String(k === 'waiting' ? waiting : k === 'all' ? model.comments.length : model.comments.filter(sameView).length))));
    const kids: Kid[] = [
      h('div', { class: 'cm-head' }, h('h3', null, '코멘트 · 모든 화면'), h('button', { class: 'sp-x', 'aria-label': '닫기', onclick: () => { open = false; stopPick(); draw(); } }, '✕')),
      h('div', { class: 'fchips' }, chips),
      draft ? draftCard() : h('div', { class: 'cm-new' }, h('button', { class: 'btn pri', onclick: startPick }, '＋ 새 코멘트 — 화면에서 대상 고르기'), h('span', { class: 'hint' }, `지금 보는 곳: ${cur}`)),
      list.length ? list.map(threadCard) : h('div', { class: 'empty-note' }, '코멘트가 없습니다'),
    ];
    // 쓰는 중인 글이 지워지지 않게, 입력칸에 초점이 있으면 다시 그리지 않는다
    if (document.activeElement && drawer.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
    drawer.replaceChildren(...kids.flat() as Node[]);
  }
  /** 코멘트가 달린 부품·줄 위에 개수 점을 단다(없어진 것은 걷는다). 화면이 다시 그려져도 따라붙게 주기적으로 맞춘다 */
  function paintDots(): void {
    const want = new Map<HTMLElement, number>();
    const v = viewLabel(location.hash);
    for (const c of live()) {
      const t = c.target;
      let el: HTMLElement | null = null;
      if (t.part && t.screen && t.screen === v.screen) el = [...document.querySelectorAll<HTMLElement>('.mbox')].find((e) => model.specs.find((s) => s.id === e.dataset.id)?.title === t.part) ?? null;
      else if (t.kind === 'item') el = [...document.querySelectorAll<HTMLElement>('[data-ctarget]')].find((e) => { try { return (JSON.parse(e.dataset.ctarget ?? '{}') as CommentTarget).label === t.label; } catch { return false; } }) ?? null;
      const host = el && el.tagName === 'TR' ? (el.firstElementChild as HTMLElement | null) : el;
      if (host) want.set(host, (want.get(host) ?? 0) + 1);
    }
    for (const d of document.querySelectorAll<HTMLElement>('.cm-dot')) { const p = d.parentElement as HTMLElement; if (want.get(p) !== Number(d.textContent)) d.remove(); }
    for (const [el, n] of want) {
      if (el.querySelector(':scope > .cm-dot')) continue;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.append(h('span', { class: 'cm-dot cm-ui', title: `코멘트 ${n}건 — 눌러서 보기`, onclick: (e: Event) => { e.stopPropagation(); open = true; draw(); } }, String(n)));
    }
  }
  setInterval(paintDots, 1500);
  draw();
  return { update(m: Model): void {
    model = m;
    const sig = JSON.stringify(m.comments);
    if (sig !== lastSig) { lastSig = sig; draw(); paintDots(); }
  } };
}
