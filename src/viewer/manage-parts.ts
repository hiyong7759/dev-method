/**
 * @spec manage-parts 관리 화면이 함께 쓰는 조각
 * @why 요청 목록과 요청 상세가 같은 진행 표시·상태 이름표·범위 이름표를 쓰므로, 두 화면이 다르게 보이지 않게 한 곳에 둔다.
 * @contract model.requests의 항목 모양(types.ts의 RequestView: 요청 파일 + describeRequests가 붙이는 stepLabel, turn, overlaps)에 기대어 그린다. 그 모양이 바뀌면 이 파일도 고친다.
 */
import { h } from './util.js';
import type { RequestStage, RequestView } from '../types.js';

/** 요청이 거치는 네 단계(진행 표시의 순서) */
const STAGES: [RequestStage, string][] = [['design', '설계'], ['impl', '구현'], ['test', '테스트'], ['done', '완료']];

/** 요청이 어느 단계까지 왔는지 한눈에 보이게 한다: 지난 단계 초록, 지금 단계 노랑 */
export function stepper(r: RequestView): HTMLDivElement {
  const cur = STAGES.findIndex(([k]) => k === r.stage);
  return h('div', { class: 'mg-st' }, STAGES.map(([, l], i) => [i ? h('u') : null, h('span', { class: r.stage === 'done' || cur > i ? 'd' : cur === i ? 'c' : '' }, h('i'), l)]));
}
/** 지금 상태와 누구 차례인지를 색으로 알린다(사용자 차례는 노랑) */
export const chipFor = (r: RequestView): HTMLSpanElement => h('span', { class: `chip ${r.turn === 'user' ? 'me' : r.turn === 'agent' ? 'ag' : r.stage === 'done' ? 'ok' : 'dim'}` }, r.stepLabel);
/** 요청이 건드리는 화면과 정보를 이름표로 보인다 */
export const scopeTags = (r: RequestView): HTMLSpanElement[] => [...r.scope.screens.map((s) => h('span', { class: 'tag' }, `화면 ${s}`)), ...r.scope.infos.map((s) => h('span', { class: 'tag' }, `정보 ${s}`))];
