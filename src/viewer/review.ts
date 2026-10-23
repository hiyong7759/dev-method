/**
 * @spec review-link 확인 필요의 리포트 연결
 * @why 확인 필요는 기계가 판단할 수 없어 사람이 정해야 하는 것만 올라온다. 사용 흐름·정보 흐름·화면 설계서 어디서 눌러도 같은 모양의 항목과 같은 패널로 열리고, 결정(요청으로 등록 / 의도한 것)은 한 목록(리포트)에 모이게 한다.
 * @contract model.reports(origin이 review인 줄)를 그린다. 결정은 서버의 /__spec/report/decide로 보내고, 끝나면 부른 쪽이 준 onDone으로 화면을 다시 그린다.
 */
import { h, post, chip, errorText, toast } from './util.js';
import type { Kid } from './util.js';
import { hash } from './route.js';
import type { ReportRow } from '../types.js';

/** 리포트 줄 하나에 결정을 남긴다 */
export async function decideRow(id: string, state: 'registered' | 'intended' | 'ignored', reason?: string): Promise<void> {
  await post('/__spec/report/decide', { id, state, reason });
}

/** 결정이 이미 있으면 그 결과를 한 줄로 */
export function decisionText(row: ReportRow): Kid {
  const d = row.decision;
  if (!d) return null;
  if (d.state === 'registered') return [chip('ag', `요청 #${d.request} 으로 등록됨`)];
  if (d.state === 'intended') return [chip('ok', '의도한 것'), h('span', { class: 'hint' }, ` 이유: ${d.reason}`)];
  return [chip('dim', '무시함')];
}

/** 처리 단추들: 요청으로 등록 / (확인 필요면) 의도한 것 / (에이전트 발견이면) 무시. 의도한 것은 이유 한 줄을 받는다 */
export function actionButtons(row: ReportRow, onDone: () => void, size = ''): HTMLElement {
  const wrap = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' });
  const run = (state: 'registered' | 'intended' | 'ignored', reason?: string): void => {
    decideRow(row.id, state, reason).then(() => { toast(state === 'registered' ? '요청으로 등록했습니다' : state === 'intended' ? '의도한 것으로 남겼습니다' : '무시했습니다'); onDone(); }).catch((e: unknown) => toast(errorText(e)));
  };
  const second = row.origin === 'review' ? '의도한 것' : '무시';
  const reasonRow = h('div', { class: 'hidden', style: 'display:flex;gap:8px;width:100%;align-items:center' });
  const input = h('input', { class: 'reason-in', placeholder: '이유 한 줄 (예: 다음 요청에서 쓸 예정인 필드)', 'aria-label': '이유' });
  reasonRow.append(input, h('button', { class: 'btn sm pri', onclick: () => run('intended', input.value) }, '남기기'));
  reasonRow.classList.add('hidden');
  wrap.append(
    h('button', { class: `btn pri${size}`, onclick: () => run('registered') }, '요청으로 등록'),
    h('button', { class: `btn${size}`, onclick: () => { if (row.origin === 'review') { reasonRow.classList.toggle('hidden'); input.focus(); } else run('ignored'); } }, second),
    reasonRow);
  return wrap;
}

/** 이 항목들과 이어진 리포트 번호 표시(#31). 눌러서 리포트 화면의 그 줄로 간다. 그 자리에서 판단하지 않는다 */
export function reportLink(rows: ReportRow[], from: string): HTMLElement | null {
  if (!rows.length) return null;
  const first = rows[0];
  return h('a', { class: 'rv lnk', href: hash('manage', 'reports', { no: String(first.no), from }), title: `리포트 #${first.no} · ${first.title}`, onclick: (e: Event) => e.stopPropagation() }, `리포트 #${first.no}${rows.length > 1 ? ` 외 ${rows.length - 1}` : ''}`);
}
