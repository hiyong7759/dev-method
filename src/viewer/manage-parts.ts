/**
 * @spec manage-parts 관리 화면이 함께 쓰는 조각
 * @why 요청 목록과 요청 상세가 같은 상태 이름표·범위 이름표를 쓰고, 요청 상세가 접수부터 완료까지 진행 표시를 그리므로, 두 화면이 다르게 보이지 않게 한 곳에 둔다.
 * @contract model.requests의 항목 모양(types.ts의 RequestView: 요청 파일 + describeRequests가 붙이는 stepLabel, turn, overlaps)에 기대어 그린다. 그 모양이 바뀌면 이 파일도 고친다.
 */
import { h, chip, tag, bul, fmt, type BulKind, type Kid } from './util.js';
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
export const chipFor = (r: RequestView): HTMLSpanElement => chip(r.delivery?.state === 'failed' ? 'bad' : r.turn === 'user' ? 'me' : r.turn === 'agent' ? 'ag' : r.stage === 'done' ? 'ok' : 'dim', r.stepLabel);
/** 요청이 건드리는 화면과 정보를 이름표로 보인다 */
export const scopeTags = (r: RequestView): HTMLSpanElement[] => [...r.scope.screens.map((s) => tag('c', `화면 ${s}`)), ...r.scope.infos.map((s) => tag('i', `정보 ${s}`))];

/** 결정이 전달 안 됐거나 읽기 전인가(요청 목록·상세가 같은 기준으로 강조한다) */
export const notDelivered = (r: RequestView): boolean => r.delivery?.state === 'failed';
export const unread = (r: RequestView): boolean => !!r.delivery && ['sending', 'hook-wait', 'failed'].includes(r.delivery.state);

/** 전달 상태 한 줄 이유(목록 줄에 붙인다) */
export function deliveryReason(r: RequestView): string {
  const v = r.delivery;
  if (!v) return '';
  const what = r.stage === 'design' ? '설계 다시 쓰기 전' : '결정 반영 전';
  return v.state === 'failed' ? `${what} · 자동으로 ${v.resent}번 다시 보냈지만 ${v.waitMin}분째 안 읽음` : v.state === 'hook-wait' ? `${what} · 담당 세션이 움직일 때 전달됨` : `${what} · 읽기 대기 ${v.waitMin}분`;
}

/**
 * 결정을 누른 뒤 오른쪽 패널에 남는 카드: 눌림→보냄→읽음→반영 네 칸과 지금 다시 보내기.
 * 반영까지 끝났으면 접힌 한 줄만 보이고, 전달 안 됨이면 빨갛게 바꿔 목록의 이름표와 같은 강도로 알린다
 */
export function deliveryCard(r: RequestView, resend: () => void): HTMLElement | null {
  const v = r.delivery;
  if (!v) return null;
  const hm = (iso: string): string => fmt(iso).slice(6);
  if (v.state === 'applied') return h('div', { class: 'hint dlv-done' }, `${v.decision} · ${hm(v.applied!)} 반영됨`);
  const failed = v.state === 'failed';
  const cells: { label: string; at: string | null; bad: boolean }[] = [
    { label: '눌림', at: v.pressed, bad: false }, { label: '보냄', at: v.sent, bad: false }, { label: '읽음', at: v.read, bad: failed }, { label: '반영', at: v.applied, bad: false },
  ];
  const next = v.nextResendAt ? ` · 다음 자동 재전송 ${hm(v.nextResendAt)}` : '';
  const sub = failed ? `${v.waitMin}분째 안 읽음 · 자동 재전송 ${v.resent}/${v.maxResend}번 끝남`
    : v.state === 'hook-wait' ? '자동으로 깨우는 장치가 꺼져 있어, 담당 세션이 움직일 때 전달됩니다'
    : v.state === 'read' ? '읽었고 곧 반영합니다' : `${v.waitMin}분째 안 읽음 · 자동 재전송 ${v.resent}/${v.maxResend}번${next}`;
  return h('div', { class: `card dlv${failed ? ' bad' : ''}` },
    h('h3', null, failed ? '내 결정이 전달되지 않았습니다' : '내 결정이 전달됐나', h('small', null, v.decision)),
    h('div', { class: 'dlv-steps' }, cells.map((c, i) => h('div', { class: `dlv-c${c.at ? ' on' : ''}${c.bad ? ' bad' : ''}` },
      h('i', null, c.bad ? '!' : c.at ? '✓' : String(i + 1)), h('b', null, c.label), h('small', null, c.at ? hm(c.at) : c.bad ? '안 읽음' : '대기')))),
    h('div', { class: 'hint' }, sub),
    v.state === 'read' ? null : h('div', { class: 'sp-foot' }, h('button', { class: `btn${failed ? ' pri' : ''}`, onclick: resend }, '지금 다시 보내기')));
}

/** 요청 상세용 큰 진행 표시: 접수부터 완료까지 단계 점과 이름, 사이를 잇는 줄. 지난 단계는 보통, 지금 단계는 굵게, 앞 단계는 흐리게 */
export function stepperBig(r: RequestView): HTMLDivElement {
  const cur = stageIndex(r);
  return h('div', { class: 'stepper-lg' }, STAGES.map((st, i) => [i ? h('u') : null, h('span', { class: `st ${r.stage === 'done' || cur > i ? 'd' : cur === i ? 'c' : ''}` }, bul(st.dot), st.label)]));
}

/** 본문(왼쪽, 스크롤) + 늘 떠 있는 오른쪽 패널을 한 줄에 놓는다. 요청 상세·정보 변경·비교·테스트가 같은 배치를 쓴다 */
export function withPanel(main: Kid, panel: HTMLElement): HTMLElement {
  return h('div', { class: 'with-panel' }, h('div', { class: 'wp-main' }, main), panel);
}
