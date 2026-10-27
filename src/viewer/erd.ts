/**
 * @spec info-erd 정보 관계도 그리기
 * @why 정보 흐름 화면과 요청의 "정보 변경 겹쳐 보기"가 같은 관계도(같은 배치, 같은 상자)를 쓰게 한다. 겹쳐 보기는 같은 그림 위에 추가·삭제·바뀜만 더 얹는다.
 * @contract 정보 목록과 관계를 받아 상자를 줄바꿈해 놓고 선을 긋는다. 창 폭이 바뀌면 부르는 쪽이 다시 부른다. 상자 모양은 시안의 정보 상자(이름, 한 줄 설명, 필드 이름표, 확인 필요 표시)다.
 */
import { h, tag, buls, nameLabel, type BulKind } from './util.js';
import { reportLink } from './review.js';
import type { Model, ModelInfo } from '../types.js';

/** 상자 하나의 자리 */
interface Pos { x: number; y: number; h: number }

/** 관계도를 그릴 때 받는 값 */
export interface ErdOptions {
  /** 그릴 정보들 */
  infos: ModelInfo[];
  /** 고른 정보 이름(없으면 빈 글) */
  selected?: string;
  /** 쓸 수 있는 가로 폭 */
  availW: number;
  /** 상자를 눌렀을 때 */
  onSelect?: (name: string) => void;
  /** 확인 필요 표시를 눌렀을 때 */
  /** 상자마다 더 얹을 것(겹쳐 보기에서 쓴다). 상자 이름표와 필드 이름표 바꾸기 */
  decorate?: (i: ModelInfo) => { cls?: string; sub?: string; fields?: { name: string; kind: '' | 'add' | 'del' | 'flag' }[]; badge?: string } | null;
  /** 상자 아래에 흐리게 처리할지(고른 것 말고 흐리게) */
  dimOthers?: (i: ModelInfo) => boolean;
  /** 더 그을 연결선(겹쳐 보기의 새 연결) */
  extraLinks?: { from: string; to: string; label: string }[];
  /** 상자 이름 앞에 구분 점(화면용·내부용·확인 필요)을 둘지. 정보 흐름에서만 켠다 */
  bullets?: boolean;
}

const W = 212, GAPX = 30, GAPY = 52, NODE_H = 104, SHOWN = Infinity;

/** 정보 관계도 한 장을 만든다 */
export function buildErd(model: Model, o: ErdOptions): HTMLElement {
  const { infos, selected = '' } = o;
  const level: Record<string, number> = {};
  const strong = model.relations.filter((r) => !r.weak);
  const lv = (n: string, seen: string[] = []): number => {
    if (level[n] !== undefined) return level[n];
    if (seen.includes(n)) return 0;
    const parents = strong.filter((r) => r.from === n).map((r) => r.to);
    return (level[n] = parents.length ? 1 + Math.max(...parents.map((p) => lv(p, [...seen, n]))) : 0);
  };
  model.infos.forEach((i) => lv(i.name));
  const cols = Math.max(1, Math.floor((o.availW - 30 + GAPX) / (W + GAPX)));
  const byLevel: Record<number, ModelInfo[]> = {};
  infos.forEach((i) => (byLevel[level[i.name] ?? 0] = byLevel[level[i.name] ?? 0] || []).push(i));
  const degree = (n: string): number => model.relations.filter((r) => r.from === n || r.to === n).length;
  const rowsList: ModelInfo[][] = [];
  /** 줄마다 몇 층인지(층의 첫 줄에만 표시한다) */
  const rowLayer: { layer: number; first: boolean }[] = [];
  Object.keys(byLevel).map(Number).sort((a, b) => a - b).forEach((l) => {
    const list = byLevel[l].slice().sort((x, y) => degree(y.name) - degree(x.name));
    for (let k = 0; k < list.length; k += cols) { rowsList.push(list.slice(k, k + cols)); rowLayer.push({ layer: l + 1, first: k === 0 }); }
  });
  const makeNode = (i: ModelInfo): HTMLElement => {
    const deco = o.decorate?.(i) ?? null;
    const doc1 = i.doc ? i.doc.split(/[.。]/)[0] : '';
    const flaggedProps = new Set(model.reports.filter((r) => r.review && !r.decision && !r.tool &&r.review.info === i.name).map((r) => r.review?.prop));
    const fields = deco?.fields ?? i.props.map((pr) => ({ name: pr.name, kind: (flaggedProps.has(pr.name) ? 'flag' : '') as '' | 'flag' }));
    const shownFields = fields.slice(0, SHOWN);
    const hidden = fields.length - shownFields.length;
    const dim = o.dimOthers ? o.dimOthers(i) : false;
    const node = h('div', { class: `inode${i.kind === 'internal' ? ' internal' : ''}${selected === i.name ? ' sel' : ''}${dim ? ' dim' : ''}${deco?.cls ? ` ${deco.cls}` : ''}`, dataset: { ctarget: JSON.stringify({ kind: 'item', label: `정보 흐름 › ${i.name}`, info: i.name }) }, title: `${i.name}${doc1 ? ' — ' + doc1 : ''}`, onclick: () => o.onSelect?.(i.name) },
      h('div', { class: 'h' }, h('b', null, o.bullets ? buls([{ kind: (i.kind === 'internal' ? 'int' : 'scr') as BulKind, label: i.kind === 'internal' ? '내부용' : '화면용' }, ...(i.flagged ? [{ kind: 'rev' as BulKind, label: '확인 필요' }] : [])]) : null, nameLabel(model, 'infos', i.name)), h('span', null, deco?.sub ?? (i.unused ? '쓰는 곳 없음 · 정리 후보' : doc1))),
      h('div', { class: 'ftags' }, shownFields.map((f) => h('span', { class: `tag${f.kind === 'flag' ? ' flag' : f.kind === 'add' ? ' add' : f.kind === 'del' ? ' del' : ''}`, title: f.name }, f.kind === 'add' ? `+ ${nameLabel(model, 'props', f.name)}` : nameLabel(model, 'props', f.name))), hidden > 0 ? h('span', { class: 'tag more' }, `+${hidden}`) : null),
      deco?.badge ? h('span', { class: 'rv-pos' }, h('span', { class: 'rv ok' }, deco.badge)) : (i.flagged ? h('span', { class: 'rv-pos' }, reportLink(model.reports.filter((r) => r.review && !r.decision && !r.tool &&r.review.info === i.name), `정보 흐름 · ${i.name}`)) : null));
    return node;
  };
  // 상자 높이는 안의 내용(설명 줄·필드 이름표 줄 수)만큼 커진다. 같은 줄의 상자는 가장 큰 높이로 맞춰 연결선이 어긋나지 않게 한다
  const nodeEls = new Map<string, HTMLElement>(infos.map((i) => [i.name, makeNode(i)]));
  const probe = h('div', { style: 'position:absolute;left:-9999px;top:0;visibility:hidden' }, [...nodeEls.values()]);
  document.body.append(probe);
  const natural: Record<string, number> = {};
  nodeEls.forEach((el, name) => { natural[name] = Math.max(NODE_H, el.offsetHeight); });
  probe.remove();
  const pos: Record<string, Pos> = {};
  let maxX = 0, y = 30;
  const widest = Math.max(0, ...rowsList.map((r) => r.length));
  const innerW = widest * (W + GAPX) - GAPX;
  const layerMarks: { layer: number; y: number }[] = [];
  rowsList.forEach((row, ri) => {
    if (rowLayer[ri].first) layerMarks.push({ layer: rowLayer[ri].layer, y });
    const off = (innerW - (row.length * (W + GAPX) - GAPX)) / 2;
    const rowH = Math.max(...row.map((i) => natural[i.name]));
    row.forEach((i, k) => { pos[i.name] = { x: 30 + off + k * (W + GAPX), y, h: rowH }; });
    maxX = Math.max(maxX, 30 + innerW);
    y += rowH + GAPY;
  });
  const canvasW = maxX + 60, canvasH = y;
  const erd = h('div', { class: 'erd' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(canvasW)); svg.setAttribute('height', String(canvasH));
  const line = (d: string, weak: boolean, hl: boolean, color = ''): void => {
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.style.stroke = color || (hl ? 'var(--accent)' : 'var(--line2)'); p.setAttribute('stroke-width', hl || color ? '3' : '2');
    if (weak) p.setAttribute('stroke-dasharray', '5 4');
    if (selected && !hl && !color) p.setAttribute('opacity', '.15');
    svg.append(p);
  };
  const text = (x: number, t: string, yy: number, hl: boolean, color = ''): void => {
    if (!hl && !color) return; // 시안처럼 선 위 글(1·N·이어주는 필드)은 정보를 골라 그 관계를 볼 때만 보인다
    const e = document.createElementNS(svgNS, 'text');
    e.setAttribute('x', String(x)); e.setAttribute('y', String(yy)); e.style.fill = color || (hl ? 'var(--accent)' : 'var(--text2)'); e.setAttribute('font-size', '12'); e.setAttribute('font-family', 'ui-monospace,Menlo,monospace');
    if (selected && !hl && !color) e.setAttribute('opacity', '.15');
    e.textContent = t;
    svg.append(e);
  };
  for (const r of model.relations) {
    const a = pos[r.to], b = pos[r.from];
    if (!a || !b) continue;
    const hl = !!selected && (r.from === selected || r.to === selected);
    if (Math.abs(a.y - b.y) < 4) {
      const [l, rr] = a.x < b.x ? [a, b] : [b, a];
      const yy = l.y + l.h / 2;
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
  for (const l of o.extraLinks ?? []) {
    const a = pos[l.from], b = pos[l.to];
    if (!a || !b) continue;
    const [top, bot] = a.y <= b.y ? [a, b] : [b, a];
    const x1 = top.x + W / 2 + 18, y1 = top.y + top.h, x2 = bot.x + W / 2 + 18, y2 = bot.y, my = y1 + 22;
    line(`M${x1} ${y1} L${x1} ${my} L${x2} ${my} L${x2} ${y2}`, true, false, 'var(--green)');
    text(Math.min(x1, x2) + 12, l.label, my + 16, false, 'var(--green)');
  }
  erd.append(svg);
  for (const i of infos) {
    const p = pos[i.name];
    const node = nodeEls.get(i.name) as HTMLElement;
    node.style.left = `${p.x}px`; node.style.top = `${p.y}px`; node.style.height = `${p.h}px`;
    erd.append(node);
  }
  if (o.bullets) for (const m of layerMarks) erd.append(h('span', { class: 'erd-layer', style: `top:${m.y + 8}px`, title: m.layer === 1 ? '1층: 다른 정보를 가리키지 않는 맨 위 정보' : `${m.layer}층: ${m.layer - 1}층 이상의 정보를 가리키는 정보(가리킨 사슬이 ${m.layer - 1}번 이어짐)` }, `${m.layer}층`));
  erd.append(h('div', { style: `width:${canvasW}px;height:${canvasH}px` }));
  if (!infos.length) erd.append(h('div', { class: 'empty-note' }, '정보를 찾지 못했다', h('br'), model.analysisError || '타입을 export한 정의가 있고 쓰이는 곳이 있어야 보인다'));
  return erd;
}
export { tag };
