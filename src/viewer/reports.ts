/**
 * @spec reports-view 리포트 화면
 * @why 모든 문제를 같은 모양의 카드로 모으고, 에이전트가 문제 한 줄·이유·추천·갈래별 결과를 정리해 올려, 사용자가 소스를 열지 않고 세 갈래(요청으로 처리 / 그냥 둠 / 더 분석) 중 하나만 고르게 한다. 요청으로 처리하기 전에는 아무것도 고치지 않는다.
 * @contract model.reports를 카드로 그린다. 카드 상태는 처리 전 · 확인 중 · 결정 대기이고, 도구가 못 읽는 모양은 결정 대상에서 빼 맨 아래 접힌 줄로, 처리한 것은 처리함 접힌 줄로 모은다. 추천이 같은 처리 전 카드는 한꺼번에 처리할 수 있다. 처리 단추는 review.ts의 것을 쓴다. 다른 화면에서 리포트 번호를 눌러 오면(no, from) 그 카드를 강조하고 돌아갈 곳을 보인다.
 */

/**
 * @spec reports-done-fold 처리함 접힘 영역
 * @anchor dom:details.rdone
 * @open 누르기 처리함
 * @why 이미 처리한 리포트는 새로 올라온 것을 가리지 않도록 접어 두고, 사용자가 누르면 펼쳐 본다.
 */
import { h, post, pageHead, chip, tag, rv, fmt, buls, toast, errorText } from './util.js';
import { actionButtons, decisionText, CHOICE_LABEL, CHOICE_EFFECT } from './review.js';
import { hash } from './route.js';
import type { Choice, Model, ReportRow } from '../types.js';

const CHOICES: Choice[] = ['registered', 'kept', 'analyze'];
const where = (r: ReportRow): (HTMLElement)[] => r.where.slice(0, 3).map((w) => (w.kind === 'screen' ? h('a', { href: hash('screen', w.name), class: 'tag c' }, w.name) : tag(w.kind === 'info' ? 'i' : '', w.name)));

/** 카드 한 장: 문제 한 줄 · 이유 · 에이전트 추천 · 갈래마다 일어나는 일 · 접힌 근거 */
function card(r: ReportRow, hitNo: number, onChange: () => void): HTMLElement {
  const rev = r.review;
  const rec = r.recommend;
  const stageKind = r.stage === '확인 중' ? 'rev' : r.stage === '결정 대기' ? 'fnd' : r.origin === 'agent' ? 'fnd' : 'rev';
  const stageChip = chip(r.stage === '결정 대기' ? 'ok' : r.stage === '확인 중' ? 'ag' : 'dim', r.stage);
  const evidence = h('details', { class: 'revid' }, h('summary', { class: 'more' }, '근거 보기'),
    h('div', { class: 'hint' }, `${r.from}${r.at ? ` · ${fmt(r.at)}` : ''}`),
    rev ? h('div', { class: 'mono' }, `정의된 곳 ${rev.where}`) : null,
    rev?.also.length ? h('div', { class: 'mono' }, `같은 이름이 나오는 곳 ${rev.also.slice(0, 5).join(', ')}${rev.also.length > 5 ? ` 외 ${rev.also.length - 5}` : ''}`) : null,
    r.where.length ? h('div', { class: 'rmeta' }, where(r), r.where.length > 3 ? h('span', { class: 'tag' }, `외 ${r.where.length - 3}`) : null) : null);
  return h('div', { class: `rcard ${r.stage === '확인 중' ? 'wait' : ''}${r.no === hitNo ? ' hit' : ''}`, dataset: { no: String(r.no), ctarget: JSON.stringify({ kind: 'item', label: `리포트 #${r.no} · ${r.title.slice(0, 40)}`, no: r.no }) } },
    h('div', { class: 'rtitle' }, buls([{ kind: stageKind, label: r.stage }]), h('span', { class: 'mono', style: 'color:var(--dim);margin-right:6px' }, `#${r.no}`), r.title, r.label ? chip(r.label === '보안' ? 'bad' : 'dim', r.label) : null, stageChip, r.notes.filter((n) => n.by === 'agent').length ? chip('dim', `분석 ${r.notes.filter((n) => n.by === 'agent').length}번`) : null),
    r.detail ? h('div', { class: 'gmean' }, r.detail) : null,
    r.notes.length ? h('div', { class: 'rlog' }, r.notes.map((n) => h('div', { class: `note ${n.by}` }, h('b', null, n.by === 'user' ? '내 의견' : '에이전트 조사'), h('span', { class: 'hint' }, ` ${fmt(n.at)} `), n.text || '(의견 없이 맡김)'))) : null,
    r.stage === '확인 중' ? h('div', { class: 'op q' }, h('b', null, '에이전트가 확인 중입니다'), h('div', null, '남긴 의견을 전제로 에이전트가 더 조사하면 결과와 새 추천이 여기에 붙고 결정 대기로 바뀝니다.')) : null,
    r.stage !== '확인 중' ? h('div', { class: 'op' }, h('b', null, rec.pick ? `에이전트 추천 · ${CHOICE_LABEL[rec.pick]}` : '에이전트 추천'), h('div', null, rec.why || '아직 에이전트가 추천을 정리하지 않았습니다. 판단이 어려우면 더 분석을 맡길 수 있습니다.')) : null,
    r.stage !== '확인 중' ? h('div', { class: 'effects' }, CHOICES.map((c) => h('div', { class: rec.pick === c ? 'on' : '' }, h('b', null, CHOICE_LABEL[c]), ` — ${CHOICE_EFFECT[c]}`))) : null,
    r.stage !== '확인 중' ? h('div', { class: 'dec' }, actionButtons(r, onChange)) : null,
    evidence);
}

/** 도구가 못 읽는 모양 한 줄: 프로젝트가 할 일은 없고, 모아서 도구 개선으로 전달한다 */
function toolFold(rows: ReportRow[], onChange: () => void): HTMLElement {
  const send = async (): Promise<void> => {
    try { await post('/__spec/report/decide-many', { ids: rows.map((r) => r.id), state: 'tool', title: `도구 개선으로 전달 ${rows.length}건` }); toast('도구 개선으로 전달했습니다'); onChange(); } catch (e) { toast(errorText(e)); }
  };
  return h('details', { class: 'rdone tool' }, h('summary', null, rv('도구 몫'), h('b', null, '도구가 아직 못 읽는 모양'), h('span', { class: 'hint' }, `${rows.length}건 · 이 프로젝트가 할 일은 없습니다`)),
    h('div', { class: 'rlist', style: 'margin-top:10px' },
      h('div', { class: 'gmean' }, '손으로 다시 정의한 복사본이나 글자 이름으로 다루는 필드처럼, 설계서 보기 도구가 읽지 못해 “안 쓰는 것”으로 잘못 보이는 것입니다. 이 프로젝트에서는 고칠 것이 없습니다. 누르면 처리된 것으로 남고, 도구(dev-method) 개선 후보로 모입니다.'),
      rows.map((r) => h('div', { class: 'rrow' }, h('div', { class: 'rbody' }, h('div', { class: 'rtitle' }, h('span', { class: 'mono', style: 'color:var(--dim);margin-right:6px' }, `#${r.no}`), r.title), h('div', { class: 'rmeta' }, h('span', { class: 'hint' }, r.review?.where ?? ''), r.review?.also.length ? h('span', { class: 'hint' }, `같은 이름: ${r.review.also.slice(0, 2).join(', ')}`) : null)))),
      h('div', { class: 'dec' }, h('button', { class: 'btn', onclick: () => { void send(); } }, `${rows.length}건 도구 개선으로 전달`))));
}

/** 줄 하나: 처리한 것(처리함 목록용) */
function doneRow(r: ReportRow): HTMLElement {
  return h('div', { class: 'rrow' },
    h('div', { class: 'rbody' }, h('div', { class: 'rtitle' }, buls([{ kind: 'fin', label: '처리함' }]), h('span', { class: 'mono', style: 'color:var(--dim);margin-right:6px' }, `#${r.no}`), r.title),
      h('div', { class: 'rmeta' }, h('span', { class: 'hint' }, `${r.from}${r.at ? ` · ${fmt(r.at)}` : ''}`), where(r))),
    h('div', { class: 'ract' }, decisionText(r)));
}

/** 추천이 같은 처리 전 카드를 한꺼번에 처리하는 줄. 추천대로 한 번만 누르면 된다 */
function bulkBar(rows: ReportRow[], onChange: () => void): HTMLElement | null {
  const same = (c: Choice): ReportRow[] => rows.filter((r) => r.stage === '처리 전' && r.recommend.pick === c);
  const regs = same('registered'), kept = same('kept');
  if (regs.length < 2 && kept.length < 2) return null;
  const run = async (list: ReportRow[], state: 'registered' | 'kept'): Promise<void> => {
    try { await post('/__spec/report/decide-many', { ids: list.map((r) => r.id), state, title: `${list[0].title} 외 ${list.length - 1}건 정리` }); toast(state === 'registered' ? '요청으로 처리합니다' : '그냥 두기로 했습니다'); onChange(); } catch (e) { toast(errorText(e)); }
  };
  return h('div', { class: 'bulk' }, h('b', null, '추천이 같은 카드를 한꺼번에'),
    regs.length >= 2 ? h('button', { class: 'btn', onclick: () => { void run(regs, 'registered'); } }, `추천대로 ${regs.length}건 요청으로 처리(요청 하나로 모읍니다)`) : null,
    kept.length >= 2 ? h('button', { class: 'btn', onclick: () => { void run(kept, 'kept'); } }, `추천대로 ${kept.length}건 그냥 둠`) : null);
}

/**
 * @screen 리포트
 * @route /__spec/#/manage/reports
 * @domain 관리
 * @why 모든 문제를 같은 카드로 모아, 에이전트가 정리한 추천을 보고 세 갈래 중 하나만 고르게 한다. 애매하면 의견을 달아 에이전트에게 더 분석시킨 뒤 결정한다.
 * @to 화면 설계서 | 항목의 화면 이름을 누른다 | 화면 이름
 * @does 에이전트가 정리한 카드(문제 한 줄·이유·추천·갈래마다 일어나는 일)를 본다 | 카드마다 근거는 접혀 있고 소스를 열어 보라는 안내는 없다 | 리포트를 처리한다#1 | → 2
 * @does 요청으로 처리 · 그냥 둠 · 더 분석 중 하나를 누른다 | 처리한 카드가 처리함으로 옮겨가고, 더 분석은 확인 중이 된다 | 리포트를 처리한다#2 | → 1
 */
export function reportsView(root: HTMLElement, { model, onChange, no, from }: { model: Model; kind?: string; onChange: () => void; no?: number; from?: string }): void {
  const all = model.reports;
  const done = all.filter((r) => r.decision);
  const tools = all.filter((r) => !r.decision && r.tool && r.stage !== '확인 중');
  const live = all.filter((r) => !r.decision && !(r.tool && r.stage !== '확인 중'));
  const need = live.filter((r) => r.stage !== '확인 중'), waiting = live.filter((r) => r.stage === '확인 중');
  const count = (state: string): number => done.filter((r) => r.decision?.state === state).length;
  const hitNo = no ?? 0;
  const arrive = hitNo ? h('div', { class: 'arrive' }, `← ${from || '다른 화면'}에서 넘어왔습니다 · 리포트 #${hitNo}을 강조해 두었습니다`, h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => history.back() }, '돌아가기')) : null;
  const summary = live.length
    ? h('div', { class: 'sum' }, h('span', { class: 'big' }, `결정이 필요한 것 ${need.length}건`), waiting.length ? chip('ag', `확인 중 ${waiting.length}건`) : null, need.filter((r) => r.stage === '결정 대기').length ? chip('ok', `결정 대기 ${need.filter((r) => r.stage === '결정 대기').length}건`) : null)
    : h('div', { class: 'empty-note' }, '결정이 필요한 것이 없습니다.');
  root.append(h('div', { class: 'wrap' },
    pageHead({ title: '리포트', lead: '문제로 올라온 것을 에이전트가 먼저 정리해 보여 드립니다. 카드마다 추천과 “누르면 일어나는 일”이 있고, 요청으로 처리 · 그냥 둠 · 더 분석 중 하나만 고르면 됩니다. 애매하면 의견을 달아 더 분석을 맡기세요. 결정하기 전에는 아무것도 고치지 않습니다.' }),
    arrive, summary, bulkBar(need, onChange), live.map((r) => card(r, hitNo, onChange)),
    tools.length ? toolFold(tools, onChange) : null,
    done.length ? h('details', { class: 'rdone' }, h('summary', null, buls([{ kind: 'fin', label: '처리함' }]), h('b', null, '처리함'), h('span', { class: 'hint' }, `요청으로 처리 ${count('registered')}건 · 그냥 둠 ${count('kept')}건 · 도구 개선으로 전달 ${count('tool')}건`)),
      h('div', { class: 'rlist', style: 'margin-top:10px' }, done.map((r) => doneRow(r)))) : null));
  if (hitNo) setTimeout(() => root.querySelector(`[data-no="${hitNo}"]`)?.scrollIntoView({ block: 'center' }), 50);
}
