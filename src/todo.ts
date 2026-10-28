/**
 * @spec todo 할 일 읽기
 * @why 사용자가 "할 일 뭐있지"라고 물을 때, 요청 목록과 코멘트·리포트를 한 번에 읽어 누구 차례인지로 나눠 보여 주고 다음에 무엇을 할지 정하게 한다. 접수한 요청을 바로 설계하지 않고, 우선순위에 따라 설계할지 구현할지를 이때 정한다.
 * @basis 읽기만 한다(아무것도 바꾸지 않는다). 승인은 사용자의 몫이라 여기서 하지 않고, 시작은 사용자가 순서를 정한 뒤 `request start`로 한다.
 * @contract 출력은 사람이 읽는 글이다. 에이전트는 이 글을 그대로 정리해 사용자에게 보이고, "제안 순서"를 확인받은 뒤 진행한다.
 */
import path from 'node:path';
import { buildModel } from './model.js';
import { parseArgs, errorText } from './cli.js';
import type { Model, RequestView } from './types.js';

/** 요청 한 줄: 번호, 제목, 상태, 마지막 진행 */
const line = (r: RequestView): string => `  #${r.id} ${r.title.length > 60 ? r.title.slice(0, 60) + '…' : r.title} — ${r.stageLabel} · ${r.stepLabel}`;

/** 모델에서 할 일을 글로 풀어 쓴다 */
export function describeTodo(m: Model): string {
  const open = m.requests.filter((r) => r.stage !== 'done' && r.stage !== 'cancelled');
  const mine = open.filter((r) => r.turn === 'user');
  const queued = open.filter((r) => r.stage === 'design' && r.step === 'queued');
  const designing = open.filter((r) => r.stage === 'design' && r.step !== 'queued' && r.step !== 'submitted');
  const impl = open.filter((r) => r.stage === 'impl');
  const fixing = open.filter((r) => r.stage === 'test' && r.turn === 'agent');
  const waitingComments = m.comments.filter((c) => c.status === 'waiting');
  const reports = m.reports.filter((r) => !r.decision && !r.tool && r.stage !== '확인 중');
  const analyzing = m.reports.filter((r) => !r.decision && r.stage === '확인 중');
  const out: string[] = ['할 일'];
  const sec = (title: string, rows: string[], empty = ''): void => { if (rows.length) out.push('', title, ...rows); else if (empty) out.push('', `${title} — ${empty}`); };
  sec(`■ 내 차례 — 승인해 주세요 (${mine.length}건)`, mine.map(line), '없음');
  sec(`■ 리포트 결정 대기 (${reports.length}건) — 설계서 보기 관리 › 리포트`, reports.length ? [`  ${reports.slice(0, 5).map((r) => `#${r.no}`).join(' ')}${reports.length > 5 ? ' …' : ''}`] : []);
  sec(`■ 리포트 확인 중 (${analyzing.length}건) — 사용자가 더 분석을 맡김, 에이전트 차례`, analyzing.map((r) => `  리포트 #${r.no} ${r.title.slice(0, 40)} — 의견: ${r.notes[r.notes.length - 1]?.text.slice(0, 40) || '(없음)'} → \`report show ${r.no}\`로 읽고 \`report note ${r.no} --text …\`로 조사 결과를 붙인다`));
  sec(`■ 답을 기다리는 코멘트 (${waitingComments.length}건) — 에이전트 차례`, waitingComments.map((c) => `  코멘트 #${c.id} ${c.target.label} — ${c.thread[0].text.slice(0, 40)}`));
  sec(`■ 에이전트가 진행 중 (${designing.length + impl.length + fixing.length}건)`, [...designing, ...impl, ...fixing].map(line));
  sec(`■ 시작 전 — 우선순위를 정해 주세요 (${queued.length}건)`, queued.map(line));
  sec(`■ 요청 없는 변경 (${m.untracked.length}건)`, m.untracked.length ? ['  요청 번호 없이 남은 커밋입니다. 설계서 보기 관리 › 요청 › 요청 없는 변경에서 요청으로 기록할지 정합니다'] : []);
  const order: string[] = [];
  if (analyzing.length) order.push(`리포트 ${analyzing.length}건을 더 분석한다`);
  if (waitingComments.length) order.push(`코멘트 ${waitingComments.length}건에 답한다`);
  [...designing, ...impl, ...fixing].forEach((r) => order.push(`#${r.id} 이어서 진행(${r.stepLabel})`));
  queued.forEach((r) => order.push(`#${r.id} 설계를 시작할지 정한다`));
  if (mine.length) order.push(`내 차례 ${mine.length}건은 사용자 승인을 기다린다(에이전트는 승인하지 않는다)`);
  out.push('', '■ 제안 순서', ...(order.length ? order.map((o, i) => `  ${i + 1}. ${o}`) : ['  할 일이 없다']), '', '순서와 "설계할지 구현할지"를 사용자가 정하면, 시작 전 요청은 `request start --id N`으로 시작한다.');
  return out.join('\n');
}

/** 명령: todo --src <소스 폴더> */
export async function main(argv: string[]): Promise<number | undefined> {
  const { opts } = parseArgs(argv);
  try { console.log(describeTodo(buildModel(path.resolve(opts.src || 'src')))); } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
