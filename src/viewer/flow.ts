/**
 * @spec flow-view 사용 흐름
 * @why 사용자가 앱으로 이루려는 일(사용 시나리오)을 단계 순서대로, 갈라지는 길과 되돌아가는 길까지 한눈에 보게 한다. 화면이 아니라 일이 기준이라, 한 화면 안의 패널이나 오버레이, 여러 화면에 걸친 일을 같은 모양으로 그린다.
 * @contract model.scenarios(extract가 @does의 시나리오#단계·다음 단계·조건에서 계산)를 그대로 그린다. 기본 흐름은 가로 한 줄, 갈래는 갈라지는 단계 아래, 되돌아가는 길은 위쪽 점선 곡선이다. 여기서는 흐름을 새로 계산하지 않는다.
 */
import { h, filterChips, sideList, pageHead, chip, tag, sidePanel, buls, nameLabel, type BulKind } from './util.js';
import { reportLink } from './review.js';
import { hash, nav } from './route.js';
import type { Model, ReportRow, RequestView, Scenario, ScenarioStep } from '../types.js';

const SVG = 'http://www.w3.org/2000/svg';

/** 단계 한 칸: 번호, 하는 일, 일이 일어나는 자리. 갈래면 위에 조건 */
function stepBox(sc: Scenario, st: ScenarioStep): HTMLElement {
  return h('div', { class: `fs${st.main ? '' : ' alt'}`, dataset: { sc: sc.name, id: st.id }, title: st.check ? `확인 기준: ${st.check}` : '' },
    st.cond ? h('span', { class: 'cond' }, st.cond) : null,
    h('span', { class: 'sn' }, st.id),
    h('span', { class: 'sx' }, st.title),
    h('span', { class: 'where' }, h('i'), st.owner));
}

/** 이 기본 흐름 단계에서 갈라져 나온 갈래 단계들을 차례로 모은다(갈래의 갈래도 따라간다) */
function branchesOf(sc: Scenario, main: ScenarioStep): ScenarioStep[] {
  const out: ScenarioStep[] = [];
  const seen = new Set<string>([main.id]);
  const walk = (from: ScenarioStep): void => {
    for (const e of from.edges) {
      const t = e.kind === 'forward' ? sc.steps.find((x) => x.id === e.to) : undefined;
      if (t && !t.main && !seen.has(t.id)) { seen.add(t.id); out.push(t); walk(t); }
    }
  };
  walk(main);
  return out;
}

/** 단계 사이에 화살표를 긋는다: 앞으로 가는 길은 실선, 되돌아가는 길은 위쪽 점선 곡선 */
function drawArrows(area: HTMLElement, sc: Scenario): void {
  area.querySelector('svg.farrows')?.remove();
  const base = area.getBoundingClientRect();
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'farrows');
  svg.setAttribute('width', String(area.scrollWidth)); svg.setAttribute('height', String(area.scrollHeight));
  svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" style="fill:var(--accent)"/></marker><marker id="ahl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" style="fill:var(--dim2)"/></marker><marker id="aha" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" style="fill:var(--pink)"/></marker></defs>';
  const el = (id: string): DOMRect | null => area.querySelector(`[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null;
  const put = (d: string, color: string, marker: string, dashed: boolean): void => {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.style.stroke = color; p.setAttribute('stroke-width', '2');
    if (dashed) p.setAttribute('stroke-dasharray', '5 4');
    p.setAttribute('marker-end', `url(#${marker})`);
    svg.append(p);
  };
  const X = (v: number): number => v - base.left, Y = (v: number): number => v - base.top;
  for (const st of sc.steps) {
    const a = el(st.id);
    if (!a) continue;
    for (const e of st.edges) {
      if (e.kind === 'other') continue;
      const b = el(e.to);
      if (!b) continue;
      if (e.kind === 'loop' && !st.main) {
        // 갈래에서 돌아가는 길: 갈래 칸의 왼쪽에서 나와 앞 단계의 아랫면으로 들어간다
        const x1 = X(a.left), y1 = Y(a.top + a.height / 2), x2 = X(b.left + b.width / 2), y2 = Y(b.bottom), r = 10;
        put(`M${x1} ${y1} H${x2 + r} Q${x2} ${y1} ${x2} ${y1 - r} V${y2}`, 'var(--dim2)', 'ahl', true);
      } else if (e.kind === 'loop') {
        // 시안처럼 위로 곧게 올라가 옆으로 가서 앞 단계의 윗면으로 곧게 내려온다(위쪽 모서리만 둥글다)
        const x1 = X(a.left + a.width / 2), x2 = X(b.left + b.width / 2), top = Math.min(Y(a.top), Y(b.top)) - 22, r = 10, d = x1 >= x2 ? 1 : -1;
        put(`M${x1} ${Y(a.top)} V${top + r} Q${x1} ${top} ${x1 - d * r} ${top} H${x2 + d * r} Q${x2} ${top} ${x2} ${top + r} V${Y(b.top)}`, 'var(--dim2)', 'ahl', true);
      } else if (Math.abs(a.left - b.left) < 6) {
        // 같은 열(갈래): 바로 아래 칸이면 곧게 내려가고, 사이에 다른 칸이 끼면 오른쪽 틈으로 돌아 들어간다
        const between = [...area.querySelectorAll('[data-id]')].some((o) => { const r = o.getBoundingClientRect(); return o !== area.querySelector(`[data-id="${CSS.escape(e.to)}"]`) && Math.abs(r.left - a.left) < 6 && r.top > a.bottom - 1 && r.bottom < b.top + 1; });
        if (between) {
          const gx = X(a.right) + 20, y1 = Y(a.top + a.height / 2), y2 = Y(b.top + b.height / 2);
          put(`M${X(a.right)} ${y1} L${gx} ${y1} L${gx} ${y2} L${X(b.right)} ${y2}`, 'var(--pink)', 'aha', false);
        } else put(`M${X(a.left + a.width / 2)} ${Y(a.bottom)} L${X(b.left + b.width / 2)} ${Y(b.top)}`, 'var(--pink)', 'aha', false);
      } else if (b.left > a.left) {
        // 오른쪽 열로 간다(기본 흐름이거나 갈래에서 합류)
        const x1 = X(a.right), y1 = Y(a.top + a.height / 2), x2 = X(b.left), y2 = Y(b.top + b.height / 2), dx = Math.max(24, (x2 - x1) / 2);
        put(`M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, st.main ? 'var(--accent)' : 'var(--pink)', st.main ? 'ah' : 'aha', false);
      }
    }
  }
  area.append(svg);
}

/** 이 시나리오가 건드리는 것들: 화면, 컴포넌트(단계가 일어나는 자리), 정보 */
function touches(model: Model, sc: Scenario): { screens: string[]; components: string[]; infos: string[] } {
  const screens = [...new Set(sc.steps.flatMap((s) => s.screens))];
  const components = [...new Set(sc.steps.map((s) => s.owner))];
  const infos = model.infos.filter((i) => (['shown', 'input', 'modify'] as const).some((r) => i.flow[r].some((n) => screens.includes(n)))).map((i) => i.name);
  return { screens, components, infos };
}
/** 이 시나리오에 걸린 확인 필요(처리 전) */
const reviewsOf = (model: Model, sc: Scenario): ReportRow[] => model.reports.filter((r) => r.review && !r.decision && !r.tool &&r.review.scenarios.includes(sc.name));
/** 이 시나리오를 범위로 하는 진행 중인 요청 */
const requestsOf = (model: Model, sc: Scenario): RequestView[] => model.requests.filter((r) => r.turn !== null || (r.stage !== 'done' && r.stage !== 'cancelled')).filter((r) => (r.scope.scenarios ?? []).includes(sc.name));
const hasBranch = (sc: Scenario): boolean => sc.steps.some((s) => !s.main);

/** 시나리오 한 개: 이름, 요청·확인 필요 표시, 첫 화면 열기, 단계들과 화살표, 이어서 할 수 있는 일 */
function scenarioCard(model: Model, sc: Scenario, picked: boolean, pick: () => void): HTMLElement {
  const mains = sc.steps.filter((s) => s.main);
  const area = h('div', { class: `farea${sc.steps.some((s) => s.edges.some((e) => e.kind === 'loop')) ? ' loops' : ''}` },
    h('div', { class: 'fcols' }, mains.map((m) => h('div', { class: 'fcol' }, stepBox(sc, m), branchesOf(sc, m).map((b) => stepBox(sc, b))))));
  const nexts = [...new Set(sc.steps.flatMap((s) => s.edges.filter((e) => e.kind === 'other').map((e) => e.scenario)))];
  const first = sc.firstScreens[0];
  const reviews = reviewsOf(model, sc);
  const reqs = requestsOf(model, sc);
  const card = h('div', { class: `scn${picked ? ' picked' : ''}`, onclick: pick, dataset: { ctarget: JSON.stringify({ kind: 'item', label: `사용 흐름 › ${sc.name}` }) } },
    h('div', { class: 'scn-h' },
      buls([...(reqs.length ? [{ kind: 'ing' as BulKind, label: '요청 진행 중' }] : []), ...(reviews.length ? [{ kind: 'rev' as BulKind, label: '확인 필요' }] : []), ...(hasBranch(sc) ? [{ kind: 'br' as BulKind, label: '갈래 있음' }] : [])]),
      h('span', { class: 'scn-t' }, sc.name),
      reqs.map((r) => chip(r.turn === 'user' ? 'me' : 'ag', `요청 #${r.id} ${r.stepLabel}`)),
      chip('dim', `단계 ${mains.length}${sc.steps.length > mains.length ? ` · 갈래 ${sc.steps.length - mains.length}` : ''}`),
      h('span', { class: 'grow' }),
      reportLink(reviews, `사용 흐름 · ${sc.name}`),
      first ? h('a', { class: 'open', href: `${location.pathname}${hash('screen', first)}`, target: '_blank', rel: 'noopener', onclick: (e: Event) => e.stopPropagation() }, '첫 화면 열기 ↗') : chip('dim', '직접 열 수 없음')),
    area,
    nexts.length ? h('div', { class: 'next' }, '이어서 할 수 있는 일 ', nexts.map((n) => h('b', null, n))) : null);
  // 화면에 붙어 크기가 정해진 뒤에 선을 긋고, 폭이 바뀌면 다시 긋는다
  requestAnimationFrame(() => { drawArrows(area, sc); new ResizeObserver(() => drawArrows(area, sc)).observe(area); });
  return card;
}

/** 고른 시나리오를 설명하는 오른쪽 패널: 요청, 건드리는 것(코드에서 계산), 겹침 */
function scenarioPanel(model: Model, sc: Scenario, onClose: () => void): HTMLElement {
  const t = touches(model, sc);
  const reqs = requestsOf(model, sc);
  const others = model.scenarios.filter((o) => o.name !== sc.name && o.steps.some((s) => t.components.includes(s.owner)));
  const overlaps = reqs.flatMap((r) => r.overlaps.filter((o) => o.components.some((c) => t.components.includes(c))));
  const reviews = reviewsOf(model, sc);
  const screen = t.screens[0];
  return sidePanel({
    title: sc.name, onClose,
    body: [
      reqs.length ? h('div', { class: 'card' }, reqs.map((r) => [chip(r.turn === 'user' ? 'me' : 'ag', `요청 #${r.id} ${r.stepLabel}`), h('div', null, r.title)])) : null,
      h('h4', { class: 'sp-sec' }, '이 시나리오가 건드리는 것 (코드에서 계산)'),
      h('div', { class: 'card' },
        h('div', { class: 'tagrow' }, t.components.map((c) => tag('c', c)), t.infos.map((i) => tag('i', nameLabel(model, 'infos', i)))),
        h('div', { class: 'hint' }, t.screens.length ? `화면 ${t.screens.join(', ')}에 속합니다.` : '속한 화면을 찾지 못했습니다.', others.length ? ` 같은 컴포넌트를 쓰는 다른 시나리오: ${others.map((o) => o.name).join(', ')}` : '')),
      overlaps.length ? [h('h4', { class: 'sp-sec' }, '다른 요청과 겹침'), overlaps.map((o) => h('div', { class: 'card' }, h('div', null, h('b', null, `#${o.id}`), ` · 같은 컴포넌트 ${o.components.join(', ')}을 함께 건드립니다.`),
        h('a', { class: 'lnk', href: hash('manage', String(o.id)) }, `#${o.id} 열기 ›`)))] : null,
      h('div', { class: 'box dash' }, h('span', { class: 'hint' }, `컴포넌트 ${t.components.length} · 정보 ${t.infos.length}`), reviews.length ? [' ', reportLink(reviews, `사용 흐름 · ${sc.name}`)] : null,
        screen ? h('a', { class: 'lnk', style: 'margin-left:auto', href: hash('screen', screen) }, '자세히 보기 ›') : null),
    ],
  });
}

/**
 * @screen 사용 흐름
 * @route /__spec/#/flow
 * @domain 현행
 * @start
 * @to 화면 설계서 | "첫 화면 열기"를 누른다 | 화면 이름
 * @to 요청 상세 | 오른쪽 패널의 겹치는 요청 "열기"를 누른다 | 요청 번호
 * @to 리포트 | 확인 필요 패널의 "리포트" 링크를 누른다 |
 * @why 사용자가 앱으로 이루려는 일을 도메인별로 한눈에 보게 한다. 설계서 보기의 첫 화면이다.
 * @does 도메인으로 시나리오를 거른다 | 고른 도메인의 시나리오만 남는다 | 화면 설계서를 열어 본다#1 | → 2
 * @does 시나리오의 첫 화면을 새 창으로 연다 | 첫 단계가 있는 화면의 설계서가 새 창에서 열린다 | 화면 설계서를 열어 본다#2 | → 3
 */
export function flowView(root: HTMLElement, { model, domain, kind, selected }: { model: Model; domain: string; kind: string; selected: string; onChange: () => void }): void {
  const go = (p: Record<string, string | undefined>): void => nav(hash('flow', '', { domain: domain || undefined, kind: kind || undefined, sc: selected || undefined, ...p }));
  const doms = [...new Set(model.scenarios.map((s) => s.domain).filter(Boolean))];
  const KINDS: { key: string; label: string; bul?: BulKind; test: (s: Scenario) => boolean }[] = [
    { key: '', label: '전체', test: () => true },
    { key: 'request', label: '요청 진행 중', bul: 'ing', test: (s) => requestsOf(model, s).length > 0 },
    { key: 'review', label: '리포트 연결', bul: 'rev', test: (s) => reviewsOf(model, s).length > 0 },
    { key: 'branch', label: '갈래 있음', bul: 'br', test: hasBranch },
  ];
  const byDomain = model.scenarios.filter((s) => !domain || s.domain === domain);
  const test = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  const shown = byDomain.filter(test.test);
  const groups = [...new Set(shown.map((s) => s.domain))];
  const list = sideList('도메인으로 보기', [{ key: '', label: '전체', count: model.scenarios.length }, ...doms.map((d) => ({ key: d, label: d, count: model.scenarios.filter((s) => s.domain === d).length }))], domain, (d) => go({ domain: d || undefined, sc: undefined }));
  const chips = filterChips(KINDS.map((k) => ({ key: k.key, label: k.label, bul: k.bul, count: byDomain.filter(k.test).length })), kind, (k) => go({ kind: k || undefined }));
  const picked = model.scenarios.find((s) => s.name === selected);
  const panel = picked ? scenarioPanel(model, picked, () => go({ sc: undefined })) : null;
  root.append(h('div', { class: 'map-body' }, list,
    h('div', { class: 'flow-center' }, h('div', { class: 'pg' },
      pageHead({ title: '사용 흐름', lead: '사용자가 앱으로 이루려는 일(사용 시나리오)을 단계 순서대로 보여줍니다. 화면이 몇 개 걸쳐 있어도, 한 화면 안의 패널이나 팝업이어도 같은 방식으로 한 줄에 놓입니다. 단계 아래 작은 이름표는 그 일이 일어나는 자리(컴포넌트)입니다.' }),
      chips,
      shown.length ? groups.map((g) => h('section', { class: 'flow-sec' }, g ? h('h2', null, g, h('small', null, `사용 시나리오 ${shown.filter((s) => s.domain === g).length}개`)) : null,
        shown.filter((s) => s.domain === g).map((s) => scenarioCard(model, s, s.name === selected, () => go({ sc: s.name === selected ? undefined : s.name })))))
        : h('div', { class: 'empty-note' }, model.scenarios.length ? '이 거르기에 맞는 시나리오가 없습니다 — 다른 구분을 눌러 보세요' : '사용 시나리오가 없다 — @does의 셋째 칸에 "시나리오#단계"를 쓰면 여기 나온다'))),
    panel));
}
