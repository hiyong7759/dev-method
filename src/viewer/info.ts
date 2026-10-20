/**
 * @spec info-views 정보 상세 패널과 정보 흐름(관계도)
 * @why 정보가 어느 화면에서 입력되고 보이고 바뀌고 판단되는지를, 어디서 열든 같은 모양의 상세 패널과 한눈에 보는 관계도로 보여 준다. 정보를 따로 문서로 쓰지 않아도 코드에서 읽은 것이 그대로 보이게 한다.
 * @contract model.infos, model.relations, model.screens[].fields를 그대로 그린다. 관계도는 창 폭에 맞춰 상자를 줄바꿈해 놓으므로, 창 폭이 바뀌면 부르는 쪽(app.ts)이 다시 그려야 한다. 오른쪽 패널은 항상 열려 있다(고르기 전에는 한눈에 보기).
 */
import { h, ROLES, ROLE_LABEL } from './util.js';
import { hash, nav } from './route.js';
import type { InfoKind, Model, ModelInfo, RefKind } from '../types.js';

/** 정보 보기 구분: 전체 / 화면용 / 내부용 */
export type InfoFilter = 'all' | InfoKind;
const FILTER_LABEL: Record<InfoFilter, string> = { all: '전체', screen: '화면용', internal: '내부용' };
/** 구분에 맞는 정보만 */
export const infosOf = (model: Model, f: InfoFilter): ModelInfo[] => (f === 'all' ? model.infos : model.infos.filter((i) => i.kind === f));

/** 이 화면에서의 쓰임을 정보 상세 맨 위에 따로 보인다. 앱 전체의 쓰임과 섞이지 않게 한다 */
function thisScreen(model: Model, info: ModelInfo, screenName: string, focusField: string | undefined, locNote: string | undefined): HTMLElement {
  const sc = model.screens.find((x) => x.name === screenName);
  const mine = (sc?.fields || []).filter((f) => f.info === info.name);
  const row = (f: (typeof mine)[number]): HTMLElement => h('div', { style: `display:flex;align-items:center;gap:8px;padding:6px 0;${f.prop === focusField ? 'font-weight:700' : ''}` }, h('span', { class: 'mono', style: 'font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis' }, f.prop), h('span', { style: 'margin-left:auto;flex:none' }, f.roles.map((r) => h('span', { class: `role ${r}` }, ROLE_LABEL[r]))));
  return h('div', { class: 'thisscreen' }, h('div', { class: 'ts-head' }, h('span', { class: 'ts-badge' }, '이 화면'), h('b', null, screenName), h('span', { class: 'ts-sub' }, '에서는')),
    mine.length ? mine.map(row) : h('div', { style: 'font-size:12px;color:var(--dim2)' }, '이 화면에서 이 정보의 필드를 직접 쓰지는 않는다'),
    locNote ? h('div', { style: 'margin-top:8px;font-size:12px;color:var(--amber);line-height:1.5' }, locNote) : null,
    h('div', { style: 'margin-top:6px;font-size:11.5px;color:var(--dim)' }, '아래는 앱 전체에서의 쓰임이다'));
}

/** 필드를 쓰는 곳의 종류를 사람이 읽는 말로 */
const KIND: Record<RefKind, string> = { create: '새 객체를 만들어 씀', update: '있던 값을 고침(대입 또는 ...펼침)', read: '읽음', write: '씀', via: '계산해서 보여줌' };

/** 정보 상세 패널이 받는 값 */
export interface DrawerOptions {
  /** 지금 눈여겨보는 필드 이름 */
  focusField?: string;
  /** 이 정보를 연 화면(있으면 이 화면에서의 쓰임을 맨 위에 보인다) */
  currentScreen?: string;
  /** 화면에서 이 정보가 나오는 자리를 어떻게 표시했는지 알리는 글 */
  locNote?: string;
  /** 닫기 */
  onClose?: () => void;
  /** 다른 정보를 연다 */
  openInfo: (name: string) => void;
  /** 화면을 연다. 없으면 그 화면의 설계서 주소로 이동한다 */
  openScreen?: (name: string) => void;
}

/** 정보 상세 — 존재 이유, 관계, 정보의 흐름(입력·보여줌·수정·판단), 필드 */
export function infoDrawer(model: Model, name: string, { focusField, currentScreen, locNote, onClose, openInfo, openScreen = (n) => nav(hash('screen', n)) }: DrawerOptions): HTMLElement {
  const open = new Set<string>(focusField ? [focusField] : []);
  const info = model.infos.find((i) => i.name === name);
  const el = h('div', { class: 'side-in', style: 'display:flex;flex-direction:column;min-height:0;flex:1' });
  if (!info) { el.append(h('div', { class: 'empty-note' }, `정보 ${name}을 찾지 못했다`)); return el; }
  const flowKinds = ROLES.map((r) => [r, info.flow[r]] as const);
  const places = new Set(flowKinds.flatMap(([, l]) => l));
  const screens = new Set(model.screens.map((s) => s.name));
  const rels = model.relations.filter((r) => r.from === name || r.to === name);
  el.append(
    h('div', { class: 'drawer-head' }, h('div', null, h('b', null, info.name)), onClose ? h('button', { class: 'xbtn', onclick: onClose, 'aria-label': '닫기' }, '×') : null),
    h('div', { class: 'tbody' },
      h('div', { class: 'reason' }, h('div', { class: 'k' }, '존재 이유'),
        info.doc ? h('div', { class: 'v' }, info.doc) : h('div', { class: 'v', style: 'color:var(--dim2);font-style:italic' }, '미작성'),
        h('div', { class: 'w mono' }, `${info.file}:${info.line} · 필드 ${info.props.length} · 쓰는 곳 ${places.size}`)),
      currentScreen ? thisScreen(model, info, currentScreen, focusField, locNote) : null,
      h('div', { class: 'sec' }, h('h4', null, '관계'),
        rels.length ? rels.map((r) => {
          const mine = r.from === name, other = mine ? r.to : r.from;
          return h('div', { class: 'rel' }, h('span', { class: 'n', onclick: () => openInfo(other) }, other),
            h('span', { class: 'c' }, `${mine ? '1' : r.many} ${r.weak ? '┄' : '─'} ${mine ? r.many : '1'}`),
            h('span', null, `${r.field}${r.fieldDoc ? ` · ${r.fieldDoc.split(/[.。]/)[0]}` : ''}${r.weak ? ' (약한 연결)' : ''}`));
        }) : h('div', { style: 'font-size:12px;color:var(--dim)' }, '다른 정보와 이어진 곳이 없다')),
      h('div', { class: 'sec' }, h('h4', null, '정보의 흐름'),
        flowKinds.map(([r, list]) => h('div', { class: 'flowrow' }, h('span', { class: `lab role ${r}`, style: 'margin:0' }, ROLE_LABEL[r]),
          h('div', { class: 'chips', style: 'gap:6px' }, list.length ? list.map((p) => h('span', { class: 'tag', style: `cursor:${screens.has(p) ? 'pointer' : 'default'}${screens.has(p) ? '' : ';border-color:#6a5a99;border-radius:12px'}${p === currentScreen ? ';border-color:var(--accent);background:var(--accent-bg);font-weight:700' : ''}`, onclick: screens.has(p) ? () => openScreen(p) : undefined }, p + (screens.has(p) ? '' : ' (모듈)') + (p === currentScreen ? ' · 지금 화면' : ''))) : h('span', { style: 'font-size:12px;color:var(--dim2)' }, '없음'))))),
      h('div', { class: 'sec' }, h('h4', null, `필드 · ${info.props.length}`, info.flagged ? h('small', { style: 'color:var(--amber)' }, `확인 ${info.flagged}`) : null),
        h('div', { class: 'fld' }, info.props.map((p) => {
          const rolesOf = ROLES.filter((r) => p.roles[r].length);
          const flag = !p.doc ? '정리 후보 · 존재 이유 미작성' : (p.status !== 'rw' ? (p.status === 'none' ? '쓰는 곳 없음' : p.status === 'read-only' ? '쓰는 곳(입력) 없음' : '읽는 곳 없음') : '');
          const evBox = h('div', { style: `display:${open.has(p.name) ? '' : 'none'};margin-top:8px;padding:8px 10px;border-radius:6px;background:#14161f;font-size:11.5px;line-height:1.7` }, h('div', { style: 'color:var(--dim);margin-bottom:2px' }, '역할을 이렇게 읽었다 (근거)'), p.evidence && p.evidence.length ? p.evidence.map((e) => h('div', null, h('span', { class: `role ${e.role}` }, ROLE_LABEL[e.role]), `${e.who} · `, h('span', { class: 'mono' }, `${e.file}:${e.line}`), ` · ${KIND[e.kind] || e.kind}`)) : h('div', { style: 'color:var(--dim2)' }, '화면·모듈에서 쓰는 곳을 찾지 못했다'));
          const row = h('div', { class: `row${focusField === p.name ? ' focus' : ''}`, style: 'cursor:pointer', onclick: () => { if (open.has(p.name)) open.delete(p.name); else open.add(p.name); evBox.style.display = open.has(p.name) ? '' : 'none'; } });
          row.append(...[
            flag ? h('span', { class: 'flag' }, flag) : null,
            h('b', null, p.name), focusField === p.name ? h('span', { style: 'color:var(--accent);font-size:12px' }, ' · 지금 보던 필드') : null,
            h('div', { class: `d${p.doc ? '' : ' empty'}` }, p.doc || '존재 이유 미작성'),
            rolesOf.length ? h('div', { style: 'margin-top:6px' }, rolesOf.map((r) => h('span', { class: `role ${r}` }, `${ROLE_LABEL[r]} ${p.roles[r].length}`))) : null, evBox].filter((x): x is HTMLElement => x !== null));
          return row;
        })))));
  return el;
}

/** 정보 흐름 화면이 받는 값 */
export interface InfoMapOptions {
  /** 고른 정보 이름(없으면 빈 글) */
  selected: string;
  /** 보는 구분(전체/화면용/내부용) */
  filter: InfoFilter;
  /** 구분을 바꿀 때 */
  onFilter: (f: InfoFilter) => void;
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
 * @does 정보 상자를 눌러 필드와 쓰이는 화면을 본다 | 오른쪽 패널에 필드와 흐름이 나온다
 * @does 같은 상자를 다시 눌러 전체 요약으로 돌아간다 | 오른쪽 패널이 한눈에 보기로 바뀐다
 */
export function infoMap(root: HTMLElement, model: Model, { selected, onSelect, drawer, filter, onFilter }: InfoMapOptions): void {
  const infos = infosOf(model, filter);
  const level: Record<string, number> = {};
  const strong = model.relations.filter((r) => !r.weak);
  const lv = (n: string, seen: string[] = []): number => {
    if (level[n] !== undefined) return level[n];
    if (seen.includes(n)) return 0;
    const parents = strong.filter((r) => r.from === n).map((r) => r.to);
    return (level[n] = parents.length ? 1 + Math.max(...parents.map((p) => lv(p, [...seen, n]))) : 0);
  };
  infos.forEach((i) => lv(i.name));
  const W = 212, GAPX = 30, GAPY = 44;
  // 화면 폭에 맞춰 한 줄에 놓을 수 있는 만큼만 놓고, 넘치면 아래 줄로 접는다(옆으로 밀려 안 보이는 일이 없게)
  const availW = (root.clientWidth || window.innerWidth) - 420 - 40; // 오른쪽 패널은 항상 열려 있어 폭을 미리 뺀다(고르면 상자가 움직이는 일이 없게)
  const cols = Math.max(1, Math.floor((availW - 30 + GAPX) / (W + GAPX)));
  const byLevel: Record<number, ModelInfo[]> = {};
  infos.forEach((i) => (byLevel[level[i.name]] = byLevel[level[i.name]] || []).push(i));
  // 같은 줄 안에서는 서로 관계있는 것이 가까이 오게(관계 많은 순)
  const degree = (n: string): number => model.relations.filter((r) => r.from === n || r.to === n).length;
  const rowsList: ModelInfo[][] = [];
  Object.keys(byLevel).map(Number).sort((a, b) => a - b).forEach((l) => {
    const list = byLevel[l].slice().sort((x, y2) => degree(y2.name) - degree(x.name));
    for (let k = 0; k < list.length; k += cols) rowsList.push(list.slice(k, k + cols));
  });
  const pos: Record<string, { x: number; y: number; h: number }> = {};
  let maxX = 0, y = 30;
  const NODE_H = 74; // 상자는 이름·한 줄 설명·개수만 보여 모두 같은 크기(필드는 오른쪽 패널에서)
  const widest = Math.max(0, ...rowsList.map((r) => r.length));
  const innerW = widest * (W + GAPX) - GAPX;
  rowsList.forEach((row) => {
    const off = (innerW - (row.length * (W + GAPX) - GAPX)) / 2; // 줄마다 가운데 정렬
    row.forEach((i, k) => { pos[i.name] = { x: 30 + off + k * (W + GAPX), y, h: NODE_H }; });
    maxX = Math.max(maxX, 30 + innerW);
    y += NODE_H + GAPY;
  });
  const canvasW = maxX + 60, canvasH = y;
  const erd = h('div', { class: 'erd' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(canvasW)); svg.setAttribute('height', String(canvasH));
  const line = (d: string, weak: boolean, hl: boolean): void => {
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', hl ? '#9db4ff' : '#7a6f60'); p.setAttribute('stroke-width', hl ? '3' : '2');
    if (weak) p.setAttribute('stroke-dasharray', '5 4');
    if (selected && !hl) p.setAttribute('opacity', '.15');
    svg.append(p);
  };
  const text = (x: number, t: string, yy: number, hl: boolean): void => {
    const e = document.createElementNS(svgNS, 'text');
    e.setAttribute('x', String(x)); e.setAttribute('y', String(yy)); e.setAttribute('fill', hl ? '#9db4ff' : '#cfc6b8'); e.setAttribute('font-size', '12'); e.setAttribute('font-family', 'ui-monospace,Menlo,monospace');
    if (selected && !hl) e.setAttribute('opacity', '.15');
    e.textContent = t;
    svg.append(e);
  };
  for (const r of model.relations) {
    const a = pos[r.to], b = pos[r.from];
    if (!a || !b) continue;
    const hl = !!selected && (r.from === selected || r.to === selected);
    if (Math.abs(a.y - b.y) < 4) { // 같은 줄: 옆에서 옆으로
      const [l, rr] = a.x < b.x ? [a, b] : [b, a];
      const yy = l.y + 42;
      line(`M${l.x + W} ${yy} L${rr.x} ${yy}`, r.weak, hl);
      if (rr.x - l.x - W > 100) { text(l.x + W + 8, '1', yy - 6, hl); text(rr.x - 14, r.many, yy - 6, hl); text((l.x + W + rr.x) / 2 - 20, r.field, yy + 16, hl); }
    } else {
      const [top, bot] = a.y < b.y ? [a, b] : [b, a];
      const x1 = top.x + W / 2, y1 = top.y + top.h, x2 = bot.x + W / 2, y2 = bot.y;
      const my = y1 + 28;
      line(`M${x1} ${y1} L${x1} ${my} L${x2} ${my} L${x2} ${y2}`, r.weak, hl);
      text(x1 + 8, a === top ? '1' : r.many, y1 + 18, hl); text(x2 + 8, a === top ? r.many : '1', y2 - 8, hl);
      text(x2 + 10, r.field, (my + y2) / 2 + 4, hl);
    }
  }
  erd.append(svg);
  for (const i of infos) {
    const p = pos[i.name];
    const doc1 = i.doc ? i.doc.split(/[.。]/)[0] : '';
    const node = h('div', { class: `inode${i.unused ? ' unused' : ''}${selected === i.name ? ' sel' : ''}${selected && selected !== i.name ? ' dim' : ''}`, style: `left:${p.x}px;top:${p.y}px;height:${p.h}px`, title: `${i.name}${doc1 ? ' — ' + doc1 : ''}`, onclick: () => onSelect(i.name) },
      h('div', { class: 'h' }, h('b', null, i.name, i.kind === 'internal' ? h('em', { class: 'kind-tag' }, '내부') : null), h('span', null, i.unused ? '쓰는 곳 없음 · 정리 후보' : doc1)),
      h('div', { class: 'c' }, ROLES.map((r) => h('span', { class: `cnt-chip ${r}${i.flow[r].length ? '' : ' zero'}` }, `${ROLE_LABEL[r]} ${i.flow[r].length}`))));
    erd.append(node);
  }
  const spacer = h('div', { style: `width:${canvasW}px;height:${canvasH}px` });
  erd.append(spacer);
  if (!infos.length) erd.append(h('div', { class: 'empty-note' }, '정보를 찾지 못했다', h('br'), model.analysisError || '타입을 export한 정의가 있고 쓰이는 곳이 있어야 보인다'));
  const count = (f: InfoFilter): number => infosOf(model, f).length;
  root.append(h('div', { class: 'legend' },
    h('div', { class: 'seg' }, (['all', 'screen', 'internal'] as InfoFilter[]).map((f) => h('button', { class: filter === f ? 'on' : '', onclick: () => onFilter(f) }, `${FILTER_LABEL[f]} ${count(f)}`))),
    h('span', null, '관계선'), h('span', { class: 'mono' }, '──'), h('span', null, '소유 (실제 연결)'), h('span', { class: 'mono' }, '┄┄'), h('span', null, '약한 연결 (값으로만 가리킴)'),
    h('span', { style: 'margin-left:12px' }, '표시'), ROLES.map((r) => h('span', { class: `cnt-chip ${r}`, style: 'font-size:12px;padding:2px 10px' }, ROLE_LABEL[r])), h('span', { style: 'color:var(--dim)' }, '= 그 일을 하는 곳의 수')));
  root.append(h('div', { class: 'erd-wrap' }, erd, drawer ? h('aside', { class: 'side', style: 'width:420px' }, drawer) : null));
}

/** 정보 흐름 오른쪽 패널의 기본 내용(정보를 고르기 전): 읽는 법과 전체 요약 */
export function infoOverview(model: Model, { openInfo }: { openInfo: (name: string) => void }): HTMLElement {
  const infos = model.infos;
  const placesOf = (i: ModelInfo): number => new Set(ROLES.flatMap((r) => i.flow[r])).size;
  const link = (i: ModelInfo, note: string): HTMLElement => h('div', { class: 'rel' }, h('span', { class: 'n', onclick: () => openInfo(i.name) }, i.name), h('span', { style: 'color:var(--dim);font-size:12px' }, note));
  const unused = infos.filter((i) => i.unused);
  const flagged = infos.filter((i) => i.flagged).sort((a, b) => b.flagged - a.flagged);
  const busy = infos.slice().sort((a, b) => placesOf(b) - placesOf(a)).filter((i) => placesOf(i) > 0).slice(0, 5);
  const strong = model.relations.filter((r) => !r.weak).length;
  const sec = (title: string, body: HTMLElement | HTMLElement[]): HTMLElement => h('div', { class: 'sec' }, h('h4', null, title), body);
  return h('div', { class: 'side-in', style: 'display:flex;flex-direction:column;min-height:0;flex:1' },
    h('div', { class: 'drawer-head' }, h('div', null, h('b', null, '정보 흐름 한눈에'))),
    h('div', { class: 'tbody' },
      h('div', { class: 'reason' }, h('div', { class: 'k' }, '이 화면을 읽는 법'),
        h('div', { class: 'v' }, '상자 하나가 앱이 다루는 정보 하나입니다. 선은 정보끼리 이어진 관계이고, 실선은 실제 연결, 점선은 값으로만 가리키는 약한 연결입니다. 상자의 숫자는 입력·보여줌·수정·판단을 하는 곳의 수입니다.'),
        h('div', { class: 'w' }, '상자를 누르면 필드와 쓰이는 화면이 이 자리에 나옵니다. 같은 상자를 다시 누르면 이 요약으로 돌아옵니다.')),
      sec('전체', h('div', { style: 'font-size:13px;line-height:1.8' }, `정보 ${infos.length}개 (화면용 ${infos.filter((i) => i.kind === 'screen').length} · 내부용 ${infos.filter((i) => i.kind === 'internal').length}) · 필드 ${infos.reduce((n, i) => n + i.props.length, 0)}개`, h('br'), `관계 ${model.relations.length}개 (실제 연결 ${strong} · 약한 연결 ${model.relations.length - strong})`)),
      sec('여러 곳에서 쓰는 정보', busy.length ? busy.map((i) => link(i, `쓰는 곳 ${placesOf(i)}`)) : h('div', { style: 'font-size:12px;color:var(--dim)' }, '아직 없다')),
      sec('정리 후보 — 쓰는 곳이 없다', unused.length ? unused.map((i) => link(i, '쓰는 곳 없음')) : h('div', { style: 'font-size:12px;color:var(--dim)' }, '없다')),
      sec('확인이 필요한 필드가 있는 정보', flagged.length ? flagged.map((i) => link(i, `확인 ${i.flagged}`)) : h('div', { style: 'font-size:12px;color:var(--dim)' }, '없다'))));
}
