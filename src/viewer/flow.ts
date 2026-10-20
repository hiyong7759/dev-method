/**
 * @spec flow-view 사용 흐름
 * @why 사용자가 앱을 어떤 순서로 쓰는지(어느 화면에서 무엇을 하고 어디로 가는지)를, 도메인과 시작 화면별로 나눠 보게 한다. 앞으로 나아가는 길은 단계로, 이미 지난 칸으로 돌아오는 길은 순환으로 구분해 보인다.
 * @contract model.flows(model.ts가 @start, @to, @does에서 계산)를 그대로 그린다. 여기서는 순서를 새로 계산하지 않는다.
 */
import { h, statusChip } from './util.js';
import { hash, nav } from './route.js';
import type { FlowOut, FlowStep, Model, UsageFlow } from '../types.js';

/** 칸 하나: 화면 이름과 상태, 사용자가 하는 일, 나가는 길 */
function stepCard(model: Model, step: FlowStep): HTMLElement {
  const sc = model.screens.find((s) => s.name === step.screen);
  const hot = !!sc && ['test-requested', 'approved-changed'].includes(sc.status.status);
  const line = (o: FlowOut, mark: string): HTMLElement =>
    h('div', { class: `mv${o.verified ? '' : ' warn'}${o.loop ? ' loop' : ''}` }, `${mark} ${o.to} · ${o.action || ''}${o.pass ? ` (${o.pass} 넘김)` : ''}${o.crossDomain ? ' · 다른 영역' : ''}${o.verified ? '' : ' · 코드에서 못 찾음'}`);
  return h('button', { class: `scard${hot ? ' focus' : ''}`, onclick: () => nav(hash('screen', step.screen)) },
    h('div', { class: 'st-top' }, h('span', { class: 'nm' }, step.screen), sc ? statusChip(sc.status, hot ? ' pulse' : '') : null),
    step.does.map((d) => h('div', { class: 'does' }, d)),
    step.out.filter((o) => !o.loop).map((o) => line(o, '→')),
    step.out.filter((o) => o.loop).map((o) => line(o, '↺ 돌아감')));
}

/** 한 갈래: 칸을 깊이별 열로 놓는다 */
function laneView(model: Model, flow: UsageFlow): HTMLElement {
  const depths = [...new Set(flow.steps.map((s) => s.depth))].sort((a, b) => a - b);
  return h('div', { class: 'lane' },
    h('h3', null, flow.start, h('small', null, `에서 시작 · 화면 ${flow.steps.length}개`)),
    h('div', { class: 'stages' }, depths.map((d) => h('div', { class: 'stage-col' }, h('h5', null, d === 0 ? '시작' : `${d + 1}단계`),
      flow.steps.filter((s) => s.depth === d).map((s) => stepCard(model, s))))));
}

/**
 * @screen 사용 흐름
 * @route /__spec/#/flow
 * @domain 현행
 * @start
 * @to 화면 설계서 | 칸(화면)을 누른다 | 화면 이름
 * @why 사용자가 앱을 어떻게 쓰는지(어느 화면에서 무엇을 하고 어디로 가는지)를 도메인별로 한눈에 보게 한다. 설계서 보기의 첫 화면이다.
 * @does 도메인별 사용 흐름을 본다 | 도메인마다 시작 화면에서 이어지는 칸과 나가는 길이 나온다
 * @does 칸을 눌러 그 화면의 설계서를 연다 | 화면 설계서가 열린다
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
    h('p', { class: 'map-help' }, '사용자가 앱을 쓰는 순서입니다. 도메인마다, 시작 화면마다 한 갈래로 나눴습니다. → 는 앞으로 나아가는 길(단계), ↺ 는 이미 지난 칸으로 돌아오는 길(순환)입니다. 칸을 누르면 그 화면의 설계서가 열립니다.'),
    shown.length ? groups.map((g) => h('section', { class: 'flow-sec' }, g ? h('h2', null, g) : null, shown.filter((f) => f.domain === g).map((f) => laneView(model, f))))
      : h('div', { class: 'empty-note' }, '@screen을 쓴 화면이 아직 없다'),
    model.notes.length ? h('details', { class: 'flow-notes' }, h('summary', null, `확인 필요 ${model.notes.length}건`), model.notes.map((n) => h('div', { class: 'note' }, n.text))) : null)));
}
