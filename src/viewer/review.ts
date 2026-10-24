/**
 * @spec review-link 리포트 줄의 결정 단추와 리포트 연결
 * @why 모든 문제는 리포트로 모이고 사용자는 세 갈래(요청으로 처리 / 그냥 둠 / 더 분석) 중 하나만 고른다. 사용 흐름·정보 흐름·화면 설계서 어디서 눌러도 같은 리포트 번호로 이어지고, 결정은 리포트 한 곳에서만 한다.
 * @contract model.reports의 줄을 그린다. 결정은 서버의 /__spec/report/decide, 더 분석은 /__spec/report/analyze로 보내고, 끝나면 부른 쪽이 준 onDone으로 화면을 다시 그린다.
 */
import { h, post, chip, errorText, toast } from './util.js';
import type { Kid } from './util.js';
import { hash } from './route.js';
import type { Choice, ReportRow } from '../types.js';

/** 리포트 줄 하나에 결정을 남긴다 */
export async function decideRow(id: string, state: 'registered' | 'kept' | 'tool', reason?: string): Promise<void> {
  await post('/__spec/report/decide', { id, state, reason });
}

/** 더 분석을 맡긴다. 의견은 생략할 수 있다 */
export async function analyzeRow(id: string, opinion: string): Promise<void> {
  await post('/__spec/report/analyze', { id, opinion });
}

/** 갈래 이름과, 그 갈래를 누르면 일어나는 일 */
export const CHOICE_LABEL: Record<Choice, string> = { registered: '요청으로 처리', kept: '그냥 둠', analyze: '더 분석' };
export const CHOICE_EFFECT: Record<Choice, string> = {
  registered: '고칠 일(요청)이 하나 만들어지고 맡을 에이전트가 정해집니다. 고치기 시작하는 것은 한 번 더 승인합니다.',
  kept: '아무것도 고치지 않고, 같은 건이 다시 올라오지 않습니다.',
  analyze: '에이전트가 의견을 전제로 더 조사해, 결과와 새 추천을 이 카드에 붙여 다시 올립니다. 그동안 카드는 확인 중입니다.',
};

/** 결정이 이미 있으면 그 결과를 한 줄로 */
export function decisionText(row: ReportRow): Kid {
  const d = row.decision;
  if (!d) return null;
  if (d.state === 'registered') return [chip('ag', `요청 #${d.request} 으로 처리`)];
  if (d.state === 'tool') return [chip('dim', '도구 개선으로 전달')];
  return [chip('ok', '그냥 둠'), d.reason ? h('span', { class: 'hint' }, ` 이유: ${d.reason}`) : null];
}

/**
 * 세 갈래 단추: 요청으로 처리 / 그냥 둠 / 더 분석. 에이전트 추천이 있으면 그 단추를 강조한다.
 * 더 분석은 의견 입력칸을 열고, 그냥 둠은 이유를 선택으로 받는다.
 */
export function actionButtons(row: ReportRow, onDone: () => void, size = ''): HTMLElement {
  const wrap = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' });
  const done = (msg: string): void => { toast(msg); onDone(); };
  const fail = (e: unknown): void => toast(errorText(e));
  const input = h('input', { class: 'reason-in', placeholder: '', 'aria-label': '한 줄' });
  let mode: 'kept' | 'analyze' = 'kept';
  const sendBtn = h('button', { class: 'btn sm pri', onclick: () => {
    if (mode === 'kept') decideRow(row.id, 'kept', input.value).then(() => done('그냥 두기로 했습니다')).catch(fail);
    else analyzeRow(row.id, input.value).then(() => done('에이전트에게 더 분석을 맡겼습니다')).catch(fail);
  } }, '');
  const inputRow = h('div', { class: 'hidden', style: 'display:flex;gap:8px;width:100%;align-items:center' }, input, sendBtn);
  inputRow.classList.add('hidden');
  const open = (m: 'kept' | 'analyze'): void => {
    mode = m;
    input.placeholder = m === 'kept' ? '이유 한 줄 (생략 가능)' : '내 의견 한 줄 (생략 가능 — 예: 이건 다음 달에 쓸 예정이야)';
    sendBtn.textContent = m === 'kept' ? '그냥 두기' : '에이전트에게 맡기기';
    inputRow.classList.remove('hidden'); input.focus();
  };
  const cls = (c: Choice): string => `btn${row.recommend.pick === c ? ' pri' : ''}${size}`;
  wrap.append(
    h('button', { class: cls('registered'), title: CHOICE_EFFECT.registered, onclick: () => { decideRow(row.id, 'registered').then(() => done('요청으로 처리합니다')).catch(fail); } }, CHOICE_LABEL.registered),
    h('button', { class: cls('kept'), title: CHOICE_EFFECT.kept, onclick: () => open('kept') }, CHOICE_LABEL.kept),
    h('button', { class: cls('analyze'), title: CHOICE_EFFECT.analyze, onclick: () => open('analyze') }, CHOICE_LABEL.analyze),
    inputRow);
  return wrap;
}

/** 이 항목들과 이어진 리포트 번호 표시(#31). 눌러서 리포트 화면의 그 줄로 간다. 그 자리에서 판단하지 않는다 */
export function reportLink(rows: ReportRow[], from: string): HTMLElement | null {
  if (!rows.length) return null;
  const first = rows[0];
  return h('a', { class: 'rv lnk', href: hash('manage', 'reports', { no: String(first.no), from }), title: `리포트 #${first.no} · ${first.title}`, onclick: (e: Event) => e.stopPropagation() }, `리포트 #${first.no}${rows.length > 1 ? ` 외 ${rows.length - 1}` : ''}`);
}
