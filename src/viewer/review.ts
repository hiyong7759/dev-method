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
  registered: '고칠 일(요청)이 만들어지고 담당 에이전트가 정해집니다. 시작은 한 번 더 승인합니다.',
  kept: '이유 한 줄을 남기고, 같은 건이 다시 올라오지 않습니다.',
  analyze: '의견을 한 줄 달면 에이전트가 더 조사해 이 카드 밑에 결과를 붙입니다.',
};

/** 결정이 이미 있으면 그 결과를 한 줄로 */
export function decisionText(row: ReportRow): Kid {
  const d = row.decision;
  if (!d) return null;
  if (d.state === 'registered') return [chip('ag', `요청 #${d.request} 으로 처리`)];
  if (d.state === 'tool') return [chip('dim', '도구 개선으로 전달'), row.toolRequest ? chip('ag', `개선 요청 #${row.toolRequest}`) : null];
  return [chip('ok', '그냥 둠'), d.reason ? h('span', { class: 'hint' }, ` 이유: ${d.reason}`) : null];
}

/**
 * 세 갈래 상자: 요청으로 처리 / 그냥 둠 / 더 분석. 상자마다 단추와 '누르면 일어나는 일'이 들어 있고, 에이전트 추천 상자는 테두리와 '추천' 표시로 강조한다.
 * 그냥 둠은 이유, 더 분석은 의견을 입력칸에 선택으로 받는다. 추천이 더 분석이면 의견칸이 처음부터 열려 있다.
 */
export function actionButtons(row: ReportRow, onDone: () => void): HTMLElement {
  const done = (msg: string): void => { toast(msg); onDone(); };
  const fail = (e: unknown): void => toast(errorText(e));
  const input = h('textarea', { class: 'opinion-in', rows: '2', 'aria-label': '내 의견' });
  const sendBtn = h('button', { class: 'btn pri' }, '');
  const hint = h('span', { class: 'hint' }, '');
  const inputRow = h('div', { class: 'opinion hidden' }, input, h('div', { class: 'opinion-act' }, sendBtn, hint));
  let mode: 'kept' | 'analyze' = 'analyze';
  sendBtn.onclick = () => {
    if (mode === 'kept') decideRow(row.id, 'kept', input.value).then(() => done('그냥 두기로 했습니다')).catch(fail);
    else analyzeRow(row.id, input.value).then(() => done('에이전트에게 더 분석을 맡겼습니다')).catch(fail);
  };
  const open = (m: 'kept' | 'analyze'): void => {
    mode = m;
    input.placeholder = m === 'kept' ? '이유를 한 줄 적어 주세요 (생략 가능)' : '내 의견을 한 줄 적어 주세요 (생략 가능 — 예: 이건 다음 달에 쓸 예정이야)';
    sendBtn.textContent = m === 'kept' ? '그냥 두기' : '에이전트에게 맡기기';
    hint.textContent = m === 'kept' ? '누르면 처리함으로 옮겨가고 다시 올라오지 않습니다.' : '맡기면 이 카드는 확인 중이 되고, 결과가 붙으면 결정 대기로 바뀝니다.';
    inputRow.classList.remove('hidden');
  };
  const box = (c: Choice, onclick: () => void): HTMLElement => {
    const rec = row.recommend.pick === c;
    return h('div', { class: `choice${rec ? ' rec' : ''}` }, rec ? h('span', { class: 'choice-rec' }, '추천') : null, h('button', { class: `btn${rec ? ' pri' : ''}`, onclick }, CHOICE_LABEL[c]), h('div', { class: 'choice-fx' }, CHOICE_EFFECT[c]));
  };
  if (row.recommend.pick === 'analyze') open('analyze');
  return h('div', { class: 'choices-wrap' },
    h('div', { class: 'choices' },
      box('registered', () => { decideRow(row.id, 'registered').then(() => done('요청으로 처리합니다')).catch(fail); }),
      box('kept', () => open('kept')),
      box('analyze', () => open('analyze'))),
    inputRow);
}

/** 이 항목들과 이어진 리포트 번호 표시(#31). 눌러서 리포트 화면의 그 줄로 간다. 그 자리에서 판단하지 않는다 */
export function reportLink(rows: ReportRow[], from: string): HTMLElement | null {
  if (!rows.length) return null;
  const first = rows[0];
  return h('a', { class: 'rv lnk', href: hash('manage', 'reports', { no: String(first.no), from }), title: `리포트 #${first.no} · ${first.title}`, onclick: (e: Event) => e.stopPropagation() }, `리포트 #${first.no}${rows.length > 1 ? ` 외 ${rows.length - 1}` : ''}`);
}
