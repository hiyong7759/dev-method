/**
 * @spec manage-parts 관리 화면이 함께 쓰는 조각
 * @why 요청 목록과 요청 상세가 같은 진행 표시·상태 이름표·범위 이름표를 쓰므로, 두 화면이 다르게 보이지 않게 한 곳에 둔다.
 * @contract model.requests의 항목 모양(types.ts의 RequestView: 요청 파일 + describeRequests가 붙이는 stepLabel, turn, overlaps)에 기대어 그린다. 그 모양이 바뀌면 이 파일도 고친다.
 */
import { h, chip, tag, bul, type BulKind, type Kid } from './util.js';
import type { RequestStage, RequestView } from '../types.js';

/** 요청이 거치는 네 단계(진행 표시의 순서) */
const STAGES: [RequestStage, string][] = [['design', '설계'], ['impl', '구현'], ['test', '테스트'], ['done', '완료']];
/** 단계마다의 구분 점(요청 목록의 거르기 칩·카드 점과 같은 점) */
const STAGE_DOT: BulKind[] = ['des', 'imp', 'tst', 'cmp'];

/** 요청이 어느 단계까지 왔는지 한눈에 보이게 한다: 단계마다 자기 점, 지난 단계는 보통·지금 단계는 굵게·앞 단계는 흐리게 */
export function stepper(r: RequestView): HTMLDivElement {
  const cur = STAGES.findIndex(([k]) => k === r.stage);
  return h('div', { class: 'mg-st' }, STAGES.map(([, l], i) => [i ? h('u') : null, h('span', { class: r.stage === 'done' || cur > i ? 'd' : cur === i ? 'c' : '' }, bul(STAGE_DOT[i]), l)]));
}
/** 지금 상태와 누구 차례인지를 색으로 알린다(사용자 차례는 노랑) */
export const chipFor = (r: RequestView): HTMLSpanElement => chip(r.turn === 'user' ? 'me' : r.turn === 'agent' ? 'ag' : r.stage === 'done' ? 'ok' : 'dim', r.stepLabel);
/** 요청이 건드리는 화면과 정보를 이름표로 보인다 */
export const scopeTags = (r: RequestView): HTMLSpanElement[] => [...r.scope.screens.map((s) => tag('c', `화면 ${s}`)), ...r.scope.infos.map((s) => tag('i', `정보 ${s}`))];

/** 요청 상세용 큰 진행 표시: 번호 동그라미와 단계 이름, 사이를 잇는 줄. 지난 단계 초록, 지금 단계 노랑 */
export function stepperBig(r: RequestView): HTMLDivElement {
  const cur = STAGES.findIndex(([k]) => k === r.stage);
  return h('div', { class: 'stepper-lg' }, STAGES.map(([, l], i) => [i ? h('u') : null, h('span', { class: `st ${r.stage === 'done' || cur > i ? 'd' : cur === i ? 'c' : ''}` }, h('i', null, i + 1), l)]));
}

/** 본문(왼쪽, 스크롤) + 늘 떠 있는 오른쪽 패널을 한 줄에 놓는다. 요청 상세·정보 변경·비교·테스트가 같은 배치를 쓴다 */
export function withPanel(main: Kid, panel: HTMLElement): HTMLElement {
  return h('div', { class: 'with-panel' }, h('div', { class: 'wp-main' }, main), panel);
}
