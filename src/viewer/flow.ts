/**
 * @spec flow-view 사용 흐름
 * @why 사용자가 앱으로 이루려는 일(사용 시나리오)을 단계 순서대로, 갈라지는 길과 되돌아가는 길까지 한눈에 보게 한다. 화면이 아니라 일이 기준이라, 한 화면 안의 패널이나 오버레이, 여러 화면에 걸친 일을 같은 모양으로 그린다.
 * @contract model.scenarios(extract가 @does의 시나리오#단계·다음 단계·조건에서 계산)를 그대로 그린다. 기본 흐름은 가로 한 줄, 갈래는 갈라지는 단계 아래, 되돌아가는 길은 위쪽 점선 곡선이다. 여기서는 흐름을 새로 계산하지 않는다.
 */
import { h } from './util.js';
import { hash, nav } from './route.js';
import type { Model, Scenario, ScenarioStep } from '../types.js';

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
  svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#9db4ff"/></marker><marker id="ahl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#8a8272"/></marker><marker id="aha" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#e0b25a"/></marker></defs>';
  const el = (id: string): DOMRect | null => area.querySelector(`[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null;
  const put = (d: string, color: string, marker: string, dashed: boolean): void => {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', '2');
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
        const x1 = X(a.left), y1 = Y(a.top + a.height / 2), x2 = X(b.left + b.width / 2), y2 = Y(b.bottom);
        put(`M${x1} ${y1} C${x1 - 50} ${y1}, ${x2} ${y2 + 50}, ${x2} ${y2}`, '#8a8272', 'ahl', true);
      } else if (e.kind === 'loop') {
        // 위쪽으로 휘어 앞 단계의 윗면으로 돌아온다
        const x1 = X(a.left + a.width / 2), x2 = X(b.left + b.width / 2), top = Math.min(Y(a.top), Y(b.top));
        put(`M${x1} ${Y(a.top)} C${x1} ${top - 34}, ${x2} ${top - 34}, ${x2} ${Y(b.top)}`, '#8a8272', 'ahl', true);
      } else if (Math.abs(a.left - b.left) < 6) {
        // 같은 열(갈래): 바로 아래 칸이면 곧게 내려가고, 사이에 다른 칸이 끼면 오른쪽 틈으로 돌아 들어간다
        const between = [...area.querySelectorAll('[data-id]')].some((o) => { const r = o.getBoundingClientRect(); return o !== area.querySelector(`[data-id="${CSS.escape(e.to)}"]`) && Math.abs(r.left - a.left) < 6 && r.top > a.bottom - 1 && r.bottom < b.top + 1; });
        if (between) {
          const gx = X(a.right) + 20, y1 = Y(a.top + a.height / 2), y2 = Y(b.top + b.height / 2);
          put(`M${X(a.right)} ${y1} L${gx} ${y1} L${gx} ${y2} L${X(b.right)} ${y2}`, '#e0b25a', 'aha', false);
        } else put(`M${X(a.left + a.width / 2)} ${Y(a.bottom)} L${X(b.left + b.width / 2)} ${Y(b.top)}`, '#e0b25a', 'aha', false);
      } else if (b.left > a.left) {
        // 오른쪽 열로 간다(기본 흐름이거나 갈래에서 합류)
        const x1 = X(a.right), y1 = Y(a.top + a.height / 2), x2 = X(b.left), y2 = Y(b.top + b.height / 2), dx = Math.max(24, (x2 - x1) / 2);
        put(`M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, st.main ? '#9db4ff' : '#e0b25a', st.main ? 'ah' : 'aha', false);
      }
    }
  }
  area.append(svg);
}

/** 시나리오 한 개: 이름, 첫 화면 열기, 단계들과 화살표, 이어서 할 수 있는 일 */
function scenarioCard(sc: Scenario): HTMLElement {
  const mains = sc.steps.filter((s) => s.main);
  const area = h('div', { class: 'farea' },
    h('div', { class: 'fcols' }, mains.map((m) => h('div', { class: 'fcol' }, stepBox(sc, m), branchesOf(sc, m).map((b) => stepBox(sc, b))))));
  const nexts = [...new Set(sc.steps.flatMap((s) => s.edges.filter((e) => e.kind === 'other').map((e) => e.scenario)))];
  const first = sc.firstScreens[0];
  const card = h('div', { class: 'scn' },
    h('div', { class: 'scn-h' }, h('span', { class: 'scn-t' }, sc.name), h('span', { class: 'chip dim' }, `${mains.length}단계${sc.steps.length > mains.length ? ` · 갈래 ${sc.steps.length - mains.length}` : ''}`),
      first ? h('a', { class: 'open', href: `${location.pathname}${hash('screen', first)}`, target: '_blank', rel: 'noopener' }, '첫 화면 열기 ↗') : h('span', { class: 'chip dim', style: 'margin-left:auto' }, '직접 열 수 없음')),
    area,
    nexts.length ? h('div', { class: 'next' }, '이어서 할 수 있는 일 ', nexts.map((n) => h('b', null, n))) : null);
  // 화면에 붙어 크기가 정해진 뒤에 선을 긋고, 폭이 바뀌면 다시 긋는다
  requestAnimationFrame(() => { drawArrows(area, sc); new ResizeObserver(() => drawArrows(area, sc)).observe(area); });
  return card;
}

/**
 * @screen 사용 흐름
 * @route /__spec/#/flow
 * @domain 현행
 * @start
 * @to 화면 설계서 | "첫 화면 열기"를 누른다 | 화면 이름
 * @why 사용자가 앱으로 이루려는 일을 도메인별로 한눈에 보게 한다. 설계서 보기의 첫 화면이다.
 * @does 도메인으로 시나리오를 거른다 | 고른 도메인의 시나리오만 남는다 | 화면 설계서를 열어 본다#1 | → 2
 * @does 시나리오의 첫 화면을 새 창으로 연다 | 첫 단계가 있는 화면의 설계서가 새 창에서 열린다 | 화면 설계서를 열어 본다#2 | → 3
 */
export function flowView(root: HTMLElement, { model, domain }: { model: Model; domain: string }): void {
  const doms = [...new Set(model.scenarios.map((s) => s.domain).filter(Boolean))];
  const shown = model.scenarios.filter((s) => !domain || s.domain === domain);
  const side = h('div', { class: 'side-nav' }, h('h4', null, '도메인으로 보기'),
    h('button', { class: `dom-btn${!domain ? ' sel' : ''}`, onclick: () => nav(hash('flow')) }, '전체', h('span', null, model.scenarios.length)),
    doms.map((d) => h('button', { class: `dom-btn${domain === d ? ' sel' : ''}`, onclick: () => nav(hash('flow', '', { domain: d })) }, d, h('span', null, model.scenarios.filter((s) => s.domain === d).length))));
  const groups = [...new Set(shown.map((s) => s.domain))];
  root.append(h('div', { class: 'map-body' }, side, h('div', { class: 'map-main' },
    h('p', { class: 'map-help' }, '사용자가 앱으로 이루려는 일(사용 시나리오)을 단계 순서대로 보여 줍니다. 파란 선은 기본 흐름, 노란 선은 조건에 따라 갈라지는 길, 점선은 앞 단계로 되돌아오는 길입니다. 칸 아래 이름은 그 일이 일어나는 자리(컴포넌트)입니다.'),
    shown.length ? groups.map((g) => h('section', { class: 'flow-sec' }, g ? h('h2', null, g) : null, shown.filter((s) => s.domain === g).map(scenarioCard)))
      : h('div', { class: 'empty-note' }, '사용 시나리오가 없다 — @does의 셋째 칸에 "시나리오#단계"를 쓰면 여기 나온다'),
    model.notes.length ? h('details', { class: 'flow-notes' }, h('summary', null, `확인 필요 ${model.notes.length}건`), model.notes.map((n) => h('div', { class: 'note' }, n.text))) : null)));
}
