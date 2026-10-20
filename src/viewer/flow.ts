/**
 * @spec flow-view 사용 흐름
 * @why 사용자가 앱을 어떤 순서로 쓰는지(어느 화면에서 무엇을 하고 어디로 가는지)를, 도메인과 시작 화면별로 나눠 보게 한다. 앞으로 나아가는 길은 단계로, 이미 지난 칸으로 돌아오는 길은 순환으로 구분해 보인다.
 * @contract model.flows(model.ts가 @start, @to, @does에서 계산)를 그대로 그린다. 여기서는 순서를 새로 계산하지 않는다.
 */
import { h, statusChip } from './util.js';
import { hash, nav } from './route.js';
import type { FlowStep, Model, UsageFlow } from '../types.js';

const SVG = 'http://www.w3.org/2000/svg';

/** 칸 하나: 화면 이름·상태와, 그 안에서 사용자가 하는 일들(일마다 한 줄) */
function stepBox(model: Model, step: FlowStep): HTMLElement {
  const sc = model.screens.find((s) => s.name === step.screen);
  const hot = !!sc && ['test-requested', 'approved-changed'].includes(sc.status.status);
  return h('div', { class: `fstep${hot ? ' focus' : ''}`, dataset: { screen: step.screen } },
    h('button', { class: 'fhead', onclick: () => nav(hash('screen', step.screen)) }, h('span', { class: 'nm' }, step.screen), sc ? statusChip(sc.status, hot ? ' pulse' : '') : null),
    step.actions.map((a, i) => h('div', { class: `fact${a.to && a.to !== step.screen ? ' go' : ''}${a.loop ? ' loop' : ''}${a.verified ? '' : ' warn'}`, dataset: { from: step.screen, i: String(i) }, title: a.check },
      h('span', null, a.title), a.to === step.screen ? h('small', null, '같은 화면에서 이어짐') : null, a.crossDomain ? h('small', null, `다른 영역 · ${a.to}`) : null, a.verified ? null : h('small', null, '코드에서 못 찾음'))),
    step.extra.map((o) => h('div', { class: `fact go${o.loop ? ' loop' : ''}${o.verified ? '' : ' warn'}`, dataset: { from: step.screen, i: `x${o.to}` } }, h('span', null, o.action || `${o.to}로 간다`))));
}

/** 일에서 가는 화면으로 화살표를 긋는다. 앞으로 가는 길은 실선, 돌아오는 길(순환)은 점선으로 뒤로 휜다 */
function drawArrows(lane: HTMLElement, flow: UsageFlow): void {
  lane.querySelector('svg.farrows')?.remove();
  const box = lane.getBoundingClientRect();
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'farrows');
  svg.setAttribute('width', String(lane.scrollWidth)); svg.setAttribute('height', String(lane.scrollHeight));
  const defs = document.createElementNS(SVG, 'defs');
  defs.innerHTML = '<marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#9db4ff"/></marker><marker id="ahl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#8a8272"/></marker>';
  svg.append(defs);
  const pt = (el: Element, side: 'l' | 'r'): [number, number] => { const r = el.getBoundingClientRect(); return [(side === 'r' ? r.right : r.left) - box.left, r.top + r.height / 2 - box.top]; };
  for (const st of flow.steps) {
    const outs = [...st.actions.map((a, i) => ({ to: a.to, loop: a.loop, key: String(i) })), ...st.extra.map((o) => ({ to: o.to, loop: o.loop, key: `x${o.to}` }))];
    for (const o of outs) {
      if (!o.to || o.to === st.screen) continue;
      const from = lane.querySelector(`[data-from="${CSS.escape(st.screen)}"][data-i="${CSS.escape(o.key)}"]`);
      const target = lane.querySelector(`.fstep[data-screen="${CSS.escape(o.to)}"] .fhead`);
      if (!from || !target) continue;
      const [x1, y1] = o.loop ? pt(from, 'l') : pt(from, 'r');
      const [x2, y2] = o.loop ? pt(target, 'r') : pt(target, 'l');
      const dx = Math.max(40, Math.abs(x2 - x1) / 2);
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', o.loop ? `M${x1} ${y1} C${x1 - dx} ${y1 + 36}, ${x2 + dx} ${y2 + 36}, ${x2} ${y2}` : `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', o.loop ? '#8a8272' : '#9db4ff'); path.setAttribute('stroke-width', '2');
      if (o.loop) path.setAttribute('stroke-dasharray', '5 4');
      path.setAttribute('marker-end', `url(#${o.loop ? 'ahl' : 'ah'})`);
      svg.append(path);
    }
  }
  lane.append(svg);
}

/** 한 갈래: 칸을 깊이별 열로 놓고, 칸 사이에 화살표를 긋는다 */
function laneView(model: Model, flow: UsageFlow): HTMLElement {
  const depths = [...new Set(flow.steps.map((s) => s.depth))].sort((a, b) => a - b);
  const stages = h('div', { class: 'stages' }, depths.map((d) => h('div', { class: 'stage-col' }, h('h5', null, d === 0 ? '시작' : `${d + 1}단계`),
    flow.steps.filter((s) => s.depth === d).map((s) => stepBox(model, s)))));
  const lane = h('div', { class: 'lane' }, h('h3', null, flow.start, h('small', null, `에서 시작 · 화면 ${flow.steps.length}개`)), stages);
  // 화면에 붙은 뒤(크기가 정해진 뒤)에 선을 긋고, 폭이 바뀌면 다시 긋는다
  requestAnimationFrame(() => { drawArrows(lane, flow); new ResizeObserver(() => drawArrows(lane, flow)).observe(stages); });
  return lane;
}

/**
 * @screen 사용 흐름
 * @route /__spec/#/flow
 * @domain 현행
 * @start
 * @why 사용자가 앱을 어떻게 쓰는지(어느 화면에서 무엇을 하고 어디로 가는지)를 도메인별로 한눈에 보게 한다. 설계서 보기의 첫 화면이다.
 * @does 도메인별 사용 흐름을 본다 | 도메인마다 시작 화면에서 이어지는 칸과 나가는 길이 나온다
 * @does 화면 칸을 눌러 그 화면의 설계서를 연다 | 화면 설계서가 열린다 | → 화면 설계서
 * @does 도메인으로 흐름을 거른다 | 고른 도메인의 흐름만 남는다
 */
export function flowView(root: HTMLElement, { model, domain }: { model: Model; domain: string }): void {
  const doms = [...new Set(model.flows.map((f) => f.domain).filter(Boolean))];
  const shown = model.flows.filter((f) => !domain || f.domain === domain);
  const setDomain = (d: string): void => nav(hash('flow', '', { domain: d }));
  const side = h('div', { class: 'side-nav' }, h('h4', null, '도메인으로 보기'),
    h('button', { class: `dom-btn${!domain ? ' sel' : ''}`, onclick: () => setDomain('') }, '전체', h('span', null, model.flows.length)),
    doms.map((d) => h('button', { class: `dom-btn${domain === d ? ' sel' : ''}`, onclick: () => setDomain(d) }, d, h('span', null, model.flows.filter((f) => f.domain === d).length))));
  const groups = [...new Set(shown.map((f) => f.domain))];
  root.append(h('div', { class: 'map-body' }, side, h('div', { class: 'map-main' },
    h('p', { class: 'map-help' }, '사용자가 앱을 쓰는 순서입니다. 도메인마다, 시작 화면마다 한 갈래로 나눴습니다. 칸 하나가 화면이고, 그 안의 한 줄이 사용자가 하는 일입니다. 화살표가 붙은 일을 하면 그 화면으로 갑니다. 실선은 앞으로 나아가는 길(단계), 점선은 이미 지난 칸으로 돌아오는 길(순환)입니다. 화면 이름을 누르면 그 화면의 설계서가 열립니다.'),
    shown.length ? groups.map((g) => h('section', { class: 'flow-sec' }, g ? h('h2', null, g) : null, shown.filter((f) => f.domain === g).map((f) => laneView(model, f))))
      : h('div', { class: 'empty-note' }, '@screen을 쓴 화면이 아직 없다'),
    model.notes.length ? h('details', { class: 'flow-notes' }, h('summary', null, `확인 필요 ${model.notes.length}건`), model.notes.map((n) => h('div', { class: 'note' }, n.text))) : null)));
}
