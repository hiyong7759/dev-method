/**
 * @spec manage-parts 관리 화면이 함께 쓰는 조각
 * @why 요청 목록과 요청 상세가 같은 상태 이름표·범위 이름표를 쓰고, 요청 상세가 접수부터 완료까지 진행 표시를 그리므로, 두 화면이 다르게 보이지 않게 한 곳에 둔다.
 * @contract model.requests의 항목 모양(types.ts의 RequestView: 요청 파일 + describeRequests가 붙이는 stepLabel, turn, overlaps)에 기대어 그린다. 그 모양이 바뀌면 이 파일도 고친다.
 */
import { h, chip, tag, bul, type BulKind, type Kid } from './util.js';
import type { RequestView } from '../types.js';

/** 요청이 거치는 다섯 단계(진행 표시의 순서). 접수는 설계 단계 안의 "아직 시작 전" 상태다 */
const STAGES: { label: string; dot: BulKind }[] = [{ label: '접수', dot: 'que' }, { label: '설계', dot: 'des' }, { label: '구현', dot: 'imp' }, { label: '테스트', dot: 'tst' }, { label: '완료', dot: 'cmp' }];
/** 요청이 지금 몇 번째 단계인가(0 접수 · 1 설계 · 2 구현 · 3 테스트 · 4 완료). 취소는 접수 앞에서 멈춘 것으로 본다 */
const stageIndex = (r: RequestView): number => (r.stage === 'design' ? (r.step === 'queued' ? 0 : 1) : r.stage === 'impl' ? 2 : r.stage === 'test' ? 3 : r.stage === 'done' ? 4 : 0);

/** 지금 유효한 설계 승인 기록. 설계 단계에 있으면(되돌려졌거나 다시 올라온 설계) 옛 승인은 무효이고, 승인 뒤에 설계가 다시 제출됐어도 마찬가지다 */
export function currentDesignApproval(r: RequestView): RequestView['events'][number] | undefined {
  if (r.stage === 'design') return undefined;
  const last = (kind: string): number => r.events.reduce((n, e, i) => (e.kind === kind ? i : n), -1);
  const ap = last('design-approved');
  return ap >= 0 && ap > last('design-submitted') ? r.events[ap] : undefined;
}

/** 지금 상태와 누구 차례인지를 색으로 알린다(사용자 차례는 노랑) */
export const chipFor = (r: RequestView): HTMLSpanElement => chip(r.turn === 'user' ? 'me' : r.turn === 'agent' ? 'ag' : r.stage === 'done' ? 'ok' : 'dim', r.stepLabel);
/** 요청이 건드리는 화면과 정보를 이름표로 보인다 */
export const scopeTags = (r: RequestView): HTMLSpanElement[] => [...r.scope.screens.map((s) => tag('c', `화면 ${s}`)), ...r.scope.infos.map((s) => tag('i', `정보 ${s}`))];

/** 요청 상세용 큰 진행 표시: 접수부터 완료까지 단계 점과 이름, 사이를 잇는 줄. 지난 단계는 보통, 지금 단계는 굵게, 앞 단계는 흐리게 */
export function stepperBig(r: RequestView): HTMLDivElement {
  const cur = stageIndex(r);
  return h('div', { class: 'stepper-lg' }, STAGES.map((st, i) => [i ? h('u') : null, h('span', { class: `st ${r.stage === 'done' || cur > i ? 'd' : cur === i ? 'c' : ''}` }, bul(st.dot), st.label)]));
}

/** 본문(왼쪽, 스크롤) + 늘 떠 있는 오른쪽 패널을 한 줄에 놓는다. 요청 상세·정보 변경·비교·테스트가 같은 배치를 쓴다 */
export function withPanel(main: Kid, panel: HTMLElement): HTMLElement {
  return h('div', { class: 'with-panel' }, h('div', { class: 'wp-main' }, main), panel);
}
