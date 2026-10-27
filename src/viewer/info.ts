/**
 * @spec info-views 정보 상세 패널과 정보 흐름(관계도)
 * @why 정보가 어느 화면에서 입력되고 보이고 바뀌고 판단되는지를, 어디서 열든 같은 모양의 상세 패널과 한눈에 보는 관계도로 보여 준다. 정보를 따로 문서로 쓰지 않아도 코드에서 읽은 것이 그대로 보이게 한다.
 * @contract model.infos, model.relations, model.screens[].fields를 그대로 그린다. 관계도는 창 폭에 맞춰 상자를 줄바꿈해 놓으므로, 창 폭이 바뀌면 부르는 쪽(app.ts)이 다시 그려야 한다. 오른쪽 패널은 항상 열려 있다(고르기 전에는 한눈에 보기).
 */
import { h, ROLES, ROLE_LABEL, filterChips, sideList, pageHead, sidePanel, chip, tag, rv, nameLabel, type BulKind } from './util.js';
import { reportLink } from './review.js';
import { buildErd } from './erd.js';
import { hash, nav } from './route.js';
import type { InfoKind, Model, ModelInfo, ModelProp, RefKind } from '../types.js';

/** 정보 보기 구분: 전체 / 화면용 / 내부용 */
export type InfoFilter = 'all' | InfoKind | 'review';
/** 정보 거르기 칩의 점(상자 이름 앞의 점과 짝) */
const FILTER_BUL: Partial<Record<InfoFilter, BulKind>> = { screen: 'scr', internal: 'int', review: 'rev' };
const FILTER_LABEL: Record<InfoFilter, string> = { all: '전체', screen: '화면용', internal: '내부용', review: '리포트 연결' };
/** 구분에 맞는 정보만 */
export const infosOf = (model: Model, f: InfoFilter): ModelInfo[] => (f === 'all' ? model.infos : f === 'review' ? model.infos.filter((i) => i.flagged > 0) : model.infos.filter((i) => i.kind === f));

/** 정보 상세 패널이 받는 값 */
export interface DrawerOptions {
  /** 지금 눈여겨보는 필드 이름 */
  focusField?: string;
  /** 이 정보를 연 화면(있으면 이 화면이 쓰는 필드를 맨 위에 강조한다) */
  currentScreen?: string;
  /** 화면에서 이 정보가 나오는 자리를 어떻게 표시했는지 알리는 글 */
  locNote?: string;
  /** 닫기 */
  onClose?: () => void;
  /** 다른 정보를 연다 */
  openInfo: (name: string) => void;
  /** 화면을 연다. 없으면 그 화면의 설계서 주소로 이동한다 */
  openScreen?: (name: string) => void;
  /** 이 정보의 확인 필요 패널을 연다 */
}

/** 정보 상세 — 존재 이유, 필드(역할 이름표와 확인 필요), 쓰이는 화면. 오른쪽 패널(sidepanel) 하나로 만든다 */
export function infoDrawer(model: Model, name: string, { focusField, currentScreen, locNote, onClose, openScreen = (n) => nav(hash('screen', n)) }: DrawerOptions): HTMLElement {
  const info = model.infos.find((i) => i.name === name);
  if (!info) return sidePanel({ title: name, onClose, body: h('div', { class: 'empty-note' }, `정보 ${name}을 찾지 못했다`) });
  const screenNames = new Set(model.screens.map((s) => s.name));
  const used = [...new Set(ROLES.flatMap((r) => info.flow[r]))].filter((n) => screenNames.has(n));
  const flaggedProps = new Set(model.reports.filter((r) => r.review && !r.decision && !r.tool &&r.review.info === name).map((r) => r.review?.prop));
  const flagged = info.flagged;
  const mine = new Set((model.screens.find((x) => x.name === currentScreen)?.fields ?? []).filter((f) => f.info === name).map((f) => f.prop));
  const sorted = [...info.props].sort((x, y) => Number(flaggedProps.has(y.name)) - Number(flaggedProps.has(x.name)));
  return sidePanel({
    title: h('span', { style: 'display:flex;align-items:center;gap:8px' }, nameLabel(model, 'infos', info.name), tag('', info.kind === 'screen' ? '화면용' : '내부용')), onClose,
    body: [
      h('div', { class: 'card' }, info.doc ? h('div', null, info.doc) : h('div', { style: 'color:var(--dim2);font-style:italic' }, '존재 이유 미작성'), h('div', { class: 'hint mono' }, `${info.fileSrc}:${info.line}`)),
      locNote ? h('div', { class: 'warn' }, locNote) : null,
      h('div', { class: 'card' }, h('h3', null, '필드 ', h('small', null, `${info.props.length}개${flagged ? ` · 리포트 ${flagged}건` : ''}`)),
        h('div', { class: 'frows' }, sorted.map((p) => {
          const roles = ROLES.filter((r) => p.roles[r].length);
          return h('div', { class: `frow${focusField === p.name ? ' focus' : ''}${mine.has(p.name) ? ' mine' : ''}`, title: `${p.name}${p.doc ? ' — ' + p.doc : ''}` },
            h('span', { class: 'fname' }, nameLabel(model, 'props', p.name)),
            h('span', { class: 'froles' }, p.external ? [h('button', { class: 'role ext', title: `코드 밖에서 읽는다: ${p.external}`, onclick: (e: Event) => toggleExternalNote(e.currentTarget as HTMLElement, p.external) }, '바깥이 읽음'), h('span', { class: 'hint', style: 'font-size:11px' }, '눌러 보면 누가 읽는지 나옵니다')] : null, roles.map((r) => h('span', { class: `role ${r}` }, ROLE_LABEL[r])), reportLink(model.reports.filter((r) => r.review && !r.decision && !r.tool &&r.review.info === name && r.review.prop === p.name), `정보 흐름 · ${name}`)));
        }))),
      h('div', { class: 'card' }, h('h3', null, '쓰이는 화면'),
        used.length ? h('div', { class: 'tagrow' }, used.map((n) => h('button', { class: `tag c${n === currentScreen ? ' here' : ''}`, onclick: () => openScreen(n) }, n))) : h('div', { class: 'hint' }, '화면에서 쓰이지 않는다(내부용)')),
    ],
  });
}

/** '바깥이 읽음' 이름표를 누르면 그 필드 줄 아래에 읽는 쪽 설명을 펼치고, 다시 누르면 접는다 */
function toggleExternalNote(badge: HTMLElement, text: string): void {
  const row = badge.closest('.frow');
  if (!row) return;
  const old = row.querySelector('.ext-note');
  if (old) { old.remove(); row.classList.remove('ext-open'); return; }
  row.classList.add('ext-open');
  row.append(h('div', { class: 'hint ext-note' }, `코드 밖에서 읽는다: ${text}`));
}

/** 정보 흐름 화면이 받는 값 */
export interface InfoMapOptions {
  /** 고른 정보 이름(없으면 빈 글) */
  selected: string;
  /** 보는 구분(전체/화면용/내부용) */
  filter: InfoFilter;
  /** 구분을 바꿀 때 */
  onFilter: (f: InfoFilter) => void;
  /** 보는 도메인(없으면 전체) */
  domain: string;
  /** 도메인을 바꿀 때 */
  onDomain: (d: string) => void;
  /** 열려 있는 확인 필요 패널(없으면 null) */
  /** 상자의 확인 필요 표시를 눌렀을 때 */
  /** 상자를 눌렀을 때 */
  onSelect: (name: string) => void;
  /** 오른쪽 패널에 보일 내용(항상 있다) */
  drawer: HTMLElement | null;
}

/**
 * @screen 정보 흐름
 * @route /__spec/#/info
 * @domain 현행
 * @why 앱이 다루는 정보와 그 관계, 어느 화면이 입력·보여줌·수정·판단을 하는지를 한눈에 보게 한다. 가리키는 정보(1)를 위에, 가리키는 쪽(N)을 아래에 놓는다.
 * @to 화면 설계서 | 오른쪽 패널의 "쓰이는 화면" 이름을 누른다 | 화면 이름
 * @to 리포트 | 확인 필요 패널의 "리포트" 링크를 누른다 |
 * @does 정보를 전체·화면용·내부용으로 거른다 | 고른 구분의 상자만 남는다 | 정보를 살펴본다#1 | → 2
 * @does 정보 상자를 눌러 필드와 쓰이는 화면을 본다 | 오른쪽 패널에 필드와 흐름이 나온다 | 정보를 살펴본다#2 | → 3, 2b
 * @does 오른쪽 패널의 "쓰이는 화면" 이름을 눌러 그 화면의 설계서를 연다 | 화면 설계서가 열린다 | 정보를 살펴본다#3 | → 화면 설계서를 열어 본다#3
 * @does 오른쪽 패널의 필드에서 "바깥이 읽음" 이름표에 마우스를 올린다 | 누가 어떻게 읽는지 적어 둔 설명이 나온다 | 정보를 살펴본다#2c | → 2 | 코드 밖에서 읽는다고 선언한 필드가 있으면
 * @does 같은 상자를 다시 눌러 전체 요약으로 돌아간다 | 오른쪽 패널이 한눈에 보기로 바뀐다 | 정보를 살펴본다#2b | → 1 | 같은 상자를 다시 누르면
 */
export function infoMap(root: HTMLElement, model: Model, { selected, onSelect, drawer, filter, onFilter, domain, onDomain }: InfoMapOptions): void {
  const domOf = (i: ModelInfo): string[] => (i.domains.length ? i.domains : ['기타']);
  const infos = infosOf(model, filter).filter((i) => !domain || domOf(i).includes(domain));
  const availW = (root.clientWidth || window.innerWidth) - 200 - 380 - 56 - 2; // 왼쪽 목록·오른쪽 패널(항상 있어 미리 뺀다)과 페이지 좌우 여백만 뺀다. 화면이 넓으면 그만큼 열이 늘어 안쪽 스크롤이 생기지 않는다
  const erd = buildErd(model, { infos, selected, availW, onSelect, bullets: true });
  const count = (f: InfoFilter): number => infosOf(model, f).filter((i) => !domain || domOf(i).includes(domain)).length;
  const allDomains = [...new Set(model.infos.flatMap(domOf))];
  const list = sideList('도메인으로 보기', [{ key: '', label: '전체', count: model.infos.length }, ...allDomains.map((d) => ({ key: d, label: d, count: model.infos.filter((i) => domOf(i).includes(d)).length }))], domain, onDomain);
  const chips = filterChips((['all', 'screen', 'internal', 'review'] as InfoFilter[]).filter((f) => f !== 'review' || count(f) > 0 || filter === 'review').map((f) => ({ key: f, label: FILTER_LABEL[f], count: count(f), bul: FILTER_BUL[f] })), filter, onFilter);
  const legend = h('div', { class: 'legend2' }, h('span', { class: 'sw-box' }), h('span', null, '화면용 정보'), h('span', { class: 'sw-box dashed' }), h('span', null, '내부용 정보(어느 화면에도 보이지 않음)'), rv('리포트 #번호'), h('span', null, '눌러서 리포트로 이동'));
  const panel = drawer;
  root.append(h('div', { class: 'map-body' }, list,
    h('div', { class: 'flow-center' }, h('div', { class: 'pg info-pg' },
      pageHead({ title: '정보 흐름', lead: '정보가 어느 화면에서 입력되고 보이고 바뀌고 판단되는지를 관계도로 봅니다. 도메인은 그 정보를 쓰는 화면의 도메인에서 계산합니다.' }),
      chips, h('div', { class: 'erd-wrap' }, erd), legend)),
    panel));
  // 고른 상자가 화면 밖이면 보이는 자리로 옮긴다
  requestAnimationFrame(() => erd.parentElement?.querySelector('.inode.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}

/** 정보 흐름 오른쪽 패널의 기본 내용(정보를 고르기 전): 읽는 법과 전체 요약 */
export function infoOverview(model: Model, { openInfo }: { openInfo: (name: string) => void }): HTMLElement {
  const infos = model.infos;
  const placesOf = (i: ModelInfo): number => new Set(ROLES.flatMap((r) => i.flow[r])).size;
  const link = (i: ModelInfo, note: string): HTMLElement => h('div', { class: 'rel' }, h('span', { class: 'n', onclick: () => openInfo(i.name) }, nameLabel(model, 'infos', i.name)), h('span', { style: 'color:var(--dim);font-size:12px' }, note));
  const unused = infos.filter((i) => i.unused);
  const flagged = infos.filter((i) => i.flagged).sort((a, b) => b.flagged - a.flagged);
  const busy = infos.slice().sort((a, b) => placesOf(b) - placesOf(a)).filter((i) => placesOf(i) > 0).slice(0, 5);
  const strong = model.relations.filter((r) => !r.weak).length;
  const sec = (title: string, body: HTMLElement | HTMLElement[]): HTMLElement => h('div', { class: 'card' }, h('h3', null, title), body);
  const none = (t: string): HTMLElement => h('div', { class: 'hint' }, t);
  return sidePanel({ title: '정보 흐름 한눈에', body: [
    h('div', { class: 'card' }, h('h3', null, '이 화면을 읽는 법'),
      h('div', null, '상자 하나가 앱이 다루는 정보 하나입니다. 선은 정보끼리 이어진 관계이고, 실선은 실제 연결, 점선은 값으로만 가리키는 약한 연결입니다.'),
      h('div', { class: 'hint' }, '상자를 누르면 필드와 쓰이는 화면이 이 자리에 나옵니다. 같은 상자를 다시 누르면 이 요약으로 돌아옵니다.')),
    sec('전체', h('div', { class: 'hint' }, `정보 ${infos.length}개 (화면용 ${infos.filter((i) => i.kind === 'screen').length} · 내부용 ${infos.filter((i) => i.kind === 'internal').length}) · 필드 ${infos.reduce((n, i) => n + i.props.length, 0)}개`, h('br'), `관계 ${model.relations.length}개 (실제 연결 ${strong} · 약한 연결 ${model.relations.length - strong})`)),
    sec('여러 곳에서 쓰는 정보', busy.length ? busy.map((i) => link(i, `쓰는 곳 ${placesOf(i)}`)) : none('아직 없다')),
    sec('정리 후보 — 쓰는 곳이 없다', unused.length ? unused.map((i) => link(i, '쓰는 곳 없음')) : none('없다')),
    sec('확인이 필요한 필드가 있는 정보', flagged.length ? flagged.map((i) => link(i, `확인 ${i.flagged}`)) : none('없다')),
  ] });
}