/**
 * @spec comment-tool 공통 코멘트 도구
 * @shell
 * @anchor dom:.cm-foot-bar
 * @why 어느 화면에서든 오른쪽 코멘트 창 하나로, 화면의 어느 부분인지 정해 에이전트에게 묻거나 요청할 수 있어야 한다. 설명이 애매할 때는 부품을 고르거나 화면 캡처를 같이 담는 것이 가장 정확하다. 화면마다 코멘트 기능을 따로 만들지 않고, 모든 화면 옆에 얹히는 도구 하나로 둔다. 코멘트는 하나씩 보내지 않고 담아 두었다가 한번에 보낸다.
 * @basis 대상은 세 방식으로 정하고 그 단추는 코멘트 창 안에 있다: 부품 고르기(화면 위 번호표나 data-ctarget이 붙은 곳), 영역 그리기(끌어서 네모), 화면 전체. 담은 코멘트는 comment-basket.ts에 쌓이고, 아래 고정 줄의 "한번에 보내기"로 서버(.spec/comments.json)에 한꺼번에 쌓여 에이전트가 명령으로 읽고 답한다. 테스트 승인 경로(요청 상세의 "첫 화면 열기")로 들어오면 같은 창에 경로 단계와 승인·반려가 붙는다.
 * @contract 화면 코드는 이 도구를 모르고, 눌러서 코멘트 대상이 될 곳에 data-ctarget(JSON)만 붙인다. 모델이 바뀌어도 이 도구는 다시 그려지지 않고 update(model)만 받는다. 아래 고정 줄(.cm-foot-bar)은 코멘트 창이 열려도 닫혀도 같은 자리다.
 */
import { h, post, chip, tag, toast, errorText } from './util.js';
import type { Kid } from './util.js';
import { kst } from '../kst.js';
import { nav, hash, liveAt } from './route.js';
import { basket, onBasket, addToBasket, editBasket, removeFromBasket, sendBasket } from './comment-basket.js';
import type { BasketItem } from './comment-basket.js';
import type { Comment, CommentTarget, Model, Scenario, ScenarioStep } from '../types.js';

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

/** 테스트 승인 경로(요청 상세에서 "첫 화면 열기"로 들어온 길): 어느 요청의 어느 시나리오를 어느 단계까지 따라왔나 */
interface Path { req: number; sc: string; step: string }

/** 코멘트 창·고정 줄을 문서에 얹는다 */
export function commentTool(init: Model): CommentTool {
  let model = init, open = false, picking = false, mode: Mode = 'part', tab: 'here' | 'all' = 'here', onlyWaiting = false;
  type Draft = { target: CommentTarget; shot: string; text: string };
  let draft: Draft | null = null;
  const replyText = new Map<number, string>();
  const replying = new Set<number>();
  const editing = new Map<string, string>();
  let reason = '';
  let lastSig = '';

  const bar = h('div', { class: 'cm-ui cm-foot-bar' });
  const drawer = h('aside', { class: 'cm-ui cm-drawer hidden' });
  document.body.append(drawer, bar);

  // 테스트 경로: 주소의 tr·ts·tn(요청·시나리오·단계)로 들어오면 이 창(탭)이 기억한다. 화면 안에서 주소가 바뀌어도 이어지고, "경로 끝내기"로 지운다
  // 경로는 주소에만 산다: 주소에 tr·ts가 있는 동안만 경로이고, 다른 곳으로 나가 주소에서 빠지면 바로 끝난다(승인·반려를 안 하고 나가도 마찬가지)
  let path: Path | null = null;
  const pathFromUrl = (): void => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? ''), req = Number(q.get('tr')), sc = q.get('ts');
    if (req && sc) { const wasOpen = path?.req === req && path.sc === sc; path = { req, sc, step: q.get('tn') ?? path?.step ?? '' }; if (!wasOpen) open = true; } else path = null;
  };
  /** 경로 끝내기: 주소에서 경로 표시를 뺀다(새로 고쳐도 되살아나지 않게) */
  const endPath = (): void => {
    const [base, qs = ''] = location.hash.split('?'), q = new URLSearchParams(qs);
    ['tr', 'ts', 'tn'].forEach((k) => q.delete(k));
    history.replaceState(null, '', `${location.pathname}${base}${q.toString() ? `?${q}` : ''}`);
    path = null; draw();
  };
  pathFromUrl();
  /** 경로 안의 요청·시나리오·확인할 단계들(요청 상세의 확인표와 같은 기준) */
  function pathInfo(): { r: NonNullable<Model['requests'][number]>; sc: Scenario; steps: ScenarioStep[] } | null {
    if (!path) return null;
    const r = model.requests.find((x) => x.id === path?.req), sc = model.scenarios.find((s) => s.name === path?.sc);
    if (!r || !sc) return null;
    const picked = new Set(r.scope.steps ?? []), impact = (r.scope.impactOnly ?? []).includes(sc.name);
    return { r, sc, steps: sc.steps.filter((st) => (impact ? picked.has(`${sc.name}#${st.id}`) : st.main || picked.has(`${sc.name}#${st.id}`))) };
  }

  const here = (): string => viewLabel(location.hash).label;
  /** 코멘트를 남긴 곳이 지금 보는 곳과 같은가(쿼리·선택 상태는 빼고 주소의 앞 두 칸만 본다) */
  const sameView = (c: { target: CommentTarget }): boolean => { const k = (u = ''): string => u.slice(1).split('?')[0].split('/').slice(0, 3).join('/'); return k(c.target.view) === k(location.hash); };
  const live = (): Comment[] => model.comments.filter((c) => c.status !== 'closed');

  function stopPick(): void { picking = false; document.body.classList.remove('cm-picking'); hover?.remove(); hover = null; }
  let hover: HTMLElement | null = null;
  const showHover = (r: { left: number; top: number; width: number; height: number } | null, text = ''): void => {
    if (!r) { hover?.remove(); hover = null; return; }
    if (!hover) { hover = h('div', { class: 'cm-ui cm-hover' }); document.body.append(hover); }
    hover.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`; hover.dataset.t = text;
  };
  /** 대상 고르기를 시작한다(코멘트 창의 대상 단추에서). 화면 전체는 바로 정해진다 */
  function startPick(k: Mode = mode): void {
    open = true; mode = k; showHover(null);
    if (k === 'screen') { stopPick(); pickScreen(); return; }
    picking = true; document.body.classList.add('cm-picking'); draw();
  }

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
        const text = (el.innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
        const box = new DOMRect(r.left + ox, r.top + oy, r.width, r.height);
        return { box, target: { kind: 'item', label: `${v.label} › ${text}`, view: location.hash, screen: v.screen, box: { x: box.x, y: box.y, w: box.width, h: box.height } } };
      }
      el = el.parentElement;
    }
    return null;
  }
  async function pickTarget(picked: CommentTarget): Promise<void> {
    stopPick(); open = true;
    const stepId = path ? path.step || pathInfo()?.steps[0]?.id || '' : '';
    const target: CommentTarget = path && stepId ? { ...picked, step: `${path.sc}#${stepId}`, testOf: path.req } : picked;
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

  /** 쓰던 코멘트를 담는다(보내지 않는다) */
  function stash(): void {
    if (!draft) return;
    if (!draft.text.trim()) { toast('코멘트 글을 먼저 쓰세요'); return; }
    addToBasket({ target: draft.target, text: draft.text.trim(), shot: draft.shot });
    draft = null; toast('코멘트를 담았습니다. 아직 보내지 않았습니다'); draw();
  }
  /** 담은 코멘트를 한번에 보낸다. 경로 안이면 그 테스트 요청의 반려가 된다 */
  async function sendAll(asReject: boolean): Promise<void> {
    const n = basket().length;
    if (asReject && !n && !reason.trim()) { toast('담은 코멘트가 없습니다. 반려 이유를 한 줄 적어 주세요'); open = true; draw(); return; }
    try { await sendBasket(asReject && path ? { request: path.req, note: n ? '' : reason.trim() } : {}); reason = ''; toast(asReject ? '한번에 보내고 반려했습니다. 같은 요청에서 고칩니다' : `코멘트 ${n}건을 한번에 보냈습니다`); } catch (e) { toast(errorText(e)); }
    refresh();
  }
  const refresh = (): void => { void fetch('/__spec/model.json', { cache: 'no-store' }).then((r) => r.json()).then((m: Model) => { model = m; draw(); }); };
  const act = async (url: string, body: object, ok: string): Promise<void> => { try { await post(url, body); if (ok) toast(ok); } catch (e) { toast(errorText(e)); } refresh(); };

  function draftCard(): HTMLElement | null {
    if (!draft) return null;
    const d = draft, t = d.target;
    const ta = h('textarea', { class: 'cm-ta', placeholder: '무엇이 궁금하거나 바꾸고 싶은지 쓰세요', oninput: () => { d.text = ta.value; } }) as HTMLTextAreaElement;
    ta.value = d.text;
    return h('div', { class: 'cm-th new' },
      h('div', { class: 'cm-tg' }, chip('ag', '작성 중'), tag('c', t.label), t.kind === 'region' ? tag('', '영역 지정') : null),
      h('span', { class: 'hint' }, '자동으로 붙는 것: ', t.src ? h('span', { class: 'mono' }, `${t.src} · `) : null, '지금 화면 주소', d.shot ? ' · 화면 캡처' : t.kind === 'part' || t.kind === 'item' ? '' : ' · (캡처는 못 찍었습니다)'),
      ta, d.shot ? h('img', { class: 'cm-shot', src: d.shot, alt: '같이 보낼 캡처' }) : null,
      h('div', { class: 'cm-foot' }, h('button', { class: 'btn pri sm', onclick: stash }, '코멘트 담기'), h('button', { class: 'btn sm', onclick: () => { draft = null; draw(); } }, '취소'), h('span', { class: 'hint' }, '(아직 안 보내짐)')));
  }
  /** 담아 둔 코멘트 한 건: 보내기 전에 고치거나 지울 수 있다 */
  function basketCard(it: BasketItem): HTMLElement {
    const t = it.target, edit = editing.get(it.key);
    const ta = h('textarea', { class: 'cm-ta', oninput: (e: Event) => { editing.set(it.key, (e.target as HTMLTextAreaElement).value); } }) as HTMLTextAreaElement;
    ta.value = edit ?? it.text;
    return h('div', { class: 'cm-th' },
      h('div', { class: 'cm-tg' }, chip('dim', '담음'), t.step ? tag('', t.step.replace('#', ' · ')) : null, t.view ? h('a', { class: 'tag c', href: t.view, onclick: () => { nav(t.view as string); } }, t.label) : tag('c', t.label)),
      edit !== undefined ? ta : h('div', { class: 'cm-msg' }, it.text),
      it.shot ? h('img', { class: 'cm-shot', src: it.shot, alt: '같이 보낼 캡처' }) : null,
      h('div', { class: 'cm-foot' },
        edit !== undefined ? [h('button', { class: 'btn pri sm', onclick: () => { editBasket(it.key, ta.value.trim() || it.text); editing.delete(it.key); } }, '저장'), h('button', { class: 'btn sm', onclick: () => { editing.delete(it.key); draw(); } }, '취소')]
          : [h('button', { class: 'btn sm', onclick: () => { editing.set(it.key, it.text); draw(); } }, '고치기'), h('button', { class: 'btn sm', onclick: () => { removeFromBasket(it.key); } }, '지우기')]));
  }
  /** 테스트 경로 칸: 단계 목록(체크)과 다음 화면. 단계를 따라가며 코멘트를 담는다 */
  function pathCard(): HTMLElement | null {
    const info = pathInfo();
    if (!info || !path) return null;
    const { r, sc, steps } = info, cur = Math.max(0, steps.findIndex((s) => s.id === path?.step)), checks = r.test?.checks ?? {};
    const go = (i: number): void => {
      const st = steps[i]; if (!st || !path) return;
      path = { ...path, step: st.id }; stopPick(); draft = null;
      const scr = st.screens[0];
      if (scr && viewLabel(location.hash).screen !== scr) nav(hash('screen', scr, { tr: String(path.req), ts: sc.name, tn: st.id, at: liveAt(model, scr, path.req) })); else draw();
    };
    const row = (st: ScenarioStep, i: number): HTMLElement => {
      const key = `${sc.name}#${st.id}`;
      const box = h('input', { type: 'checkbox', checked: checks[key] ? true : null, 'aria-label': st.title, onchange: () => { void act('/__spec/request/test-check', { id: r.id, key, done: box.checked }, ''); } });
      return h('div', { class: `cm-step${i === cur ? ' cur' : ''}` }, box, h('div', { class: 'grow' }, h('small', { class: 'hint' }, `${st.cond ? st.cond : `${st.id}단계`}${i === cur ? ' · 지금 여기' : ''}`), h('div', null, st.title), st.check ? h('small', { class: 'hint' }, `확인 기준: ${st.check}`) : null),
        i !== cur ? h('button', { class: 'btn sm', onclick: () => go(i) }, '가기') : null);
    };
    return h('div', { class: 'cm-path' },
      h('div', { class: 'cm-tg' }, h('b', null, sc.name), chip('ag', `요청 #${r.id} 테스트`), h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => { endPath(); nav(hash('manage', String(r.id))); } }, `‹ 요청 #${r.id} 상세로`), h('button', { class: 'btn sm', onclick: endPath }, '경로 끝내기')),
      steps.map(row),
      h('div', { class: 'cm-foot' }, h('button', { class: 'btn sm', disabled: cur <= 0, onclick: () => go(cur - 1) }, '‹ 이전 화면'), h('button', { class: 'btn sm', disabled: cur >= steps.length - 1, onclick: () => go(cur + 1) }, '다음 화면 ›')));
  }
  /** 대상 고르기 단추들(코멘트 창 안): 눌러서 화면에서 고른다 */
  function modeRow(): HTMLElement {
    return h('div', { class: 'cm-modes' }, MODES.map(([k, l]) => h('button', { class: (picking || draft) && k === mode ? 'on' : '', onclick: () => startPick(k) }, l)));
  }
  function threadCard(c: Comment): HTMLElement {
    const st = STATUS[c.status];
    const reply = h('textarea', { class: 'cm-ta', placeholder: '이어서 묻기', oninput: (e: Event) => { replyText.set(c.id, (e.target as HTMLTextAreaElement).value); } }) as HTMLTextAreaElement;
    reply.value = replyText.get(c.id) ?? '';
    return h('div', { class: 'cm-th' },
      h('div', { class: 'cm-tg' }, chip(st.tone, st.label), c.target.view ? h('a', { class: 'tag c', href: c.target.view, onclick: () => { nav(c.target.view as string); } }, c.target.label) : tag('c', c.target.label), c.request ? chip('ag', `요청 #${c.request}`) : null),
      c.thread.map((m) => h('div', { class: `cm-msg${m.who === 'agent' ? ' ag' : ''}` }, h('div', { class: 'cm-who' }, h('b', null, m.who === 'agent' ? '에이전트' : '나'), ` ${kst(m.at)}`, m.refs?.length ? chip('ag', `${m.refs.join(', ')} 확인함`) : null), m.text)),
      c.shot ? h('img', { class: 'cm-shot', src: `/__spec/comment-shots/${c.shot}`, alt: '같이 보낸 캡처' }) : null,
      c.status !== 'closed' ? h('div', { class: 'cm-foot' },
        replying.has(c.id) ? [reply, h('button', { class: 'btn pri sm', onclick: () => { const t = replyText.get(c.id) ?? ''; replyText.delete(c.id); replying.delete(c.id); void act('/__spec/comment/reply', { id: c.id, text: t }, '보냈습니다'); } }, '보내기')] : h('button', { class: 'btn sm', onclick: () => { replying.add(c.id); draw(); } }, '추가로 묻기'),
        c.status === 'answered' && !c.request ? h('button', { class: 'btn pri sm', onclick: () => { void act('/__spec/comment/to-request', { id: c.id, title: c.thread[0].text.slice(0, 60) }, '요청으로 만들었습니다'); } }, '이 일을 요청으로 만들기') : null,
        h('button', { class: 'btn sm', onclick: () => { void act('/__spec/comment/close', { id: c.id }, '닫았습니다'); } }, '닫기')) : null);
  }
  /** 아래 고정 줄: 코멘트 창이 열려도 닫혀도 같은 자리. 개수를 눌러 창을 열고, 담은 것을 한번에 보낸다(테스트 경로에서는 반려·승인도 여기서) */
  function drawBar(): void {
    const mine = basket(), nHere = mine.filter(sameView).length + model.comments.filter(sameView).length, nAll = mine.length + model.comments.length;
    const info = path ? pathInfo() : null, canAct = !!info && info.r.step === 'requested' && info.r.stage === 'test' && !model.testEnv;
    const allDone = !!info && info.steps.every((st) => info.r.test?.checks[`${info.sc.name}#${st.id}`]);
    // 평소 화면에서는 담아 둔 코멘트가 있거나 창이 열려 있을 때만 줄을 보인다(늘 떠 있으면 의미가 없다). 테스트 경로에서는 늘 보인다
    bar.style.display = path || open || mine.length ? '' : 'none';
    const count = (k: 'here' | 'all', label: string, n: number): HTMLElement => h('button', { class: `cnt${open && tab === k ? ' on' : ''}`, onclick: () => { open = !(open && tab === k); tab = k; if (!open) stopPick(); draw(); } }, `${label} ${n}`);
    bar.replaceChildren(count('here', '이 화면', nHere), count('all', '전체', nAll), h('span', { class: 'grow' }),
      ...canAct ? [h('button', { class: 'btn bad', onclick: () => { void sendAll(true); } }, `한번에 보내기(반려)${mine.length ? ` ${mine.length}` : ''}`),
        h('button', { class: `btn ok${allDone ? '' : ' off'}`, disabled: !allDone, title: allDone ? '' : '모든 단계를 확인(체크)해야 승인할 수 있습니다', onclick: () => { void act('/__spec/request/test-approve', { id: info!.r.id, none: false }, '테스트를 승인했습니다'); } }, '승인')]
        : model.testEnv ? [h('span', { class: 'hint', title: '이 서버는 테스트 데이터용 복사본이라 여기서 보낸 것은 진짜 요청에 닿지 않습니다' }, '승인·반려·코멘트 보내기는 운영 요청 상세에서')]
        : [h('button', { class: `btn pri${mine.length ? '' : ' off'}`, disabled: !mine.length, onclick: () => { void sendAll(false); } }, `한번에 보내기${mine.length ? ` ${mine.length}` : ''}`)]);
  }
  function draw(): void {
    drawBar();
    drawer.classList.toggle('hidden', !open);
    if (!open) return;
    const cur = here(), mine = basket();
    const waiting = model.comments.filter((c) => c.status === 'waiting').length;
    const sent = model.comments.filter((c) => (tab === 'here' ? sameView(c) : onlyWaiting ? c.status === 'waiting' : true)).sort((a, b) => b.id - a.id);
    const stashed = mine.filter((i) => tab === 'all' || sameView(i));
    const tabs = h('div', { class: 'cm-tabs' }, ...([['here', '이 화면'], ['all', '전체']] as const).map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; draw(); } }, l)),
      tab === 'all' ? h('button', { class: `fc${onlyWaiting ? ' on' : ''}`, onclick: () => { onlyWaiting = !onlyWaiting; draw(); } }, '답 기다림', h('small', null, String(waiting))) : null);
    const info = path ? pathInfo() : null;
    const kids: Kid[] = [
      h('div', { class: 'cm-head' }, h('h3', null, '코멘트'), h('button', { class: 'sp-x', 'aria-label': '닫기', onclick: () => { open = false; stopPick(); draw(); } }, '✕')),
      tabs,
      pathCard(),
      draft ? [modeRow(), draftCard()] : h('div', { class: 'cm-new' }, modeRow(),
        h('span', { class: 'hint' }, picking ? (mode === 'part' ? '화면에서 부품을 누르세요(글이 있는 덩어리도 됩니다)' : '화면에서 끌어서 영역을 그리세요') : '대상을 먼저 고르세요', ` · 지금 보는 곳: ${cur}`)),
      info && info.r.step === 'requested' && !mine.length ? h('div', { class: 'cm-th' }, h('span', { class: 'hint' }, '담은 코멘트가 없으면 반려 이유를 한 줄 적습니다'),
        h('textarea', { class: 'cm-ta', placeholder: '반려 이유 한 줄', oninput: (e: Event) => { reason = (e.target as HTMLTextAreaElement).value; } }, reason)) : null,
      stashed.length ? [h('div', { class: 'hint' }, '담은 코멘트 — 아직 안 보내짐. 아래 [한번에 보내기]로 모두 함께 보냅니다'), stashed.map(basketCard)] : null,
      sent.length ? sent.map(threadCard) : stashed.length ? null : h('div', { class: 'empty-note' }, '코멘트가 없습니다'),
    ];
    // 쓰는 중인 글이 지워지지 않게, 입력칸에 초점이 있으면 다시 그리지 않는다
    if (document.activeElement && drawer.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
    drawer.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined) as Node[]);
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
  // 쓰던 초안(고른 대상·글)은 화면마다 따로 둔다: 다른 화면에서는 새로 시작하고, 돌아오면 거기서 쓰던 것이 다시 나온다
  const viewKey = (u = location.hash): string => u.slice(1).split('?')[0].split('/').slice(0, 3).join('/');
  const drafts = new Map<string, Draft>();
  let curKey = viewKey();
  onBasket(() => draw());
  window.addEventListener('hashchange', () => {
    pathFromUrl();
    const k = viewKey();
    if (k === curKey) { draw(); return; }
    if (draft) drafts.set(curKey, draft); else drafts.delete(curKey);
    curKey = k; draft = drafts.get(k) ?? null; drafts.delete(k);
    stopPick(); draw();
  });
  draw();
  return { update(m: Model): void {
    model = m;
    const sig = JSON.stringify([m.comments, m.requests.map((r) => [r.id, r.stage, r.step, r.test?.checks])]);
    if (sig !== lastSig) { lastSig = sig; draw(); paintDots(); }
  } };
}
