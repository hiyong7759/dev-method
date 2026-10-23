/**
 * @spec reports-view 리포트 화면
 * @why 에이전트가 작업 중이나 정기 점검에서 발견한 것과, 기계가 판단할 수 없어 올라온 확인 필요를 한 목록에 모아 사용자가 요청으로 등록하거나 무시하거나 의도한 것으로 남기게 한다. 요청으로 등록하기 전에는 아무것도 고치지 않는다.
 * @contract model.reports를 종류별 묶음(브리핑)으로 그린다. 묶음 단위로 결정하고, 건별로 고르게도 할 수 있다. 처리 단추는 review.ts의 것을 쓴다. 다른 화면에서 리포트 번호를 눌러 오면(no, from) 그 줄을 강조하고 돌아갈 곳을 보인다.
 */
import { h, post, pageHead, chip, tag, rv, fmt, buls, toast, errorText, type BulKind } from './util.js';
import { actionButtons, decisionText } from './review.js';
import { hash, nav } from './route.js';
import type { Kid } from './util.js';
import type { Model, ReportRow } from '../types.js';

/** 줄 하나: 제목과 분류, 어디서 왔는지, 관련 이름들, 처리 단추(처리했으면 결과) */
function row(r: ReportRow, onChange: () => void): HTMLElement {
  const areaChip = r.origin === 'agent' ? null : chip('dim', r.review?.screens.length ? '사용 흐름·정보 흐름' : '정보 흐름');
  /** 카드의 구분 점: 처리했으면 처리함, 아니면 에이전트 발견 / 확인 필요 (거르기 칩의 점과 짝) */
  const dot: { kind: BulKind; label: string } = r.decision ? { kind: 'fin', label: '처리함' } : r.origin === 'agent' ? { kind: 'fnd', label: '에이전트 발견' } : { kind: 'rev', label: '확인 필요' };
  const tone = r.label === '보안' ? 'bad' : 'dim';
  return h('div', { class: `rrow${r.origin === 'review' && !r.decision ? ' review' : ''}` },
    h('div', { class: 'rbody' },
      h('div', { class: 'rtitle' }, buls([dot]), h('span', { class: 'mono', style: 'color:var(--dim);margin-right:6px' }, `#${r.no}`), r.title, r.label ? chip(tone, r.label) : null, r.origin === 'review' && !r.decision ? rv() : null),
      h('div', { class: 'rmeta' }, areaChip, h('span', { class: 'hint' }, `${r.from}${r.at ? ` · ${fmt(r.at)}` : ''}`),
        r.where.slice(0, 3).map((w) => (w.kind === 'screen' ? h('a', { href: hash('screen', w.name), class: 'tag c' }, w.name) : tag(w.kind === 'info' ? 'i' : '', w.name))),
        r.where.length > 3 ? h('span', { class: 'tag' }, `외 ${r.where.length - 3}`) : null,
        r.detail ? h('span', { class: 'hint' }, r.detail) : null)),
    h('div', { class: 'ract' }, r.decision ? decisionText(r) : actionButtons(r, onChange)));
}

/** 묶음의 종류: 같은 판단을 한꺼번에 내릴 수 있는 것끼리 모은다 */
interface Group { key: string; kind: '소스 고치기' | '먼저 확인' | '에이전트 발견'; title: string; mean: string; opinion: string; rows: ReportRow[]; primary: string; second: string }

/** 처리 전 줄들을 묶음으로 나눈다. 판단 근거(코드로 확인한 정도)가 같은 것끼리 한 묶음이다 */
function groupsOf(open: ReportRow[]): Group[] {
  const rv2 = open.filter((r) => r.origin === 'review' && r.review);
  const whole = rv2.filter((r) => !r.review?.prop);
  const sure = rv2.filter((r) => r.review?.prop && r.review.tone === 'ok');
  const maybe = rv2.filter((r) => r.review?.prop && r.review.tone === 'warn');
  const agent = open.filter((r) => r.origin === 'agent');
  const gs: Group[] = [
    { key: 'whole', kind: '소스 고치기', title: '어디에서도 쓰지 않는 정보', rows: whole, primary: '고치기로 한다', second: '일부러 둔 것이다',
      mean: '정보 이름만 정의돼 있고 화면에도 코드에도 나오지 않습니다. 그대로 두면 정보 흐름이 실제보다 복잡해 보입니다.',
      opinion: '지우기를 권합니다. 코드에서 쓰는 곳을 찾지 못했습니다(확인한 범위: 코드 검색. 화면을 열어 확인하지는 않음).' },
    { key: 'sure', kind: '소스 고치기', title: '어디에서도 쓰지 않는 필드', rows: sure, primary: '고치기로 한다', second: '일부러 둔 것이다',
      mean: '정보 안에 정의만 있고, 코드로도 글자로도 쓰는 곳을 찾지 못한 필드입니다. 그대로 두면 정보가 실제보다 커 보입니다.',
      opinion: '지우기를 권합니다. 코드와 글자 모두에서 쓰는 곳을 찾지 못했습니다(확인한 범위: 코드 검색. 화면을 열어 확인하지는 않음).' },
    { key: 'maybe', kind: '먼저 확인', title: '쓰는 곳은 못 찾았지만 같은 이름이 다른 곳에 나오는 필드', rows: maybe, primary: '확인한 뒤 고치기로 한다', second: '일부러 둔 것이다',
      mean: '코드에서는 쓰는 곳을 못 찾았는데, 같은 이름이 다른 곳에 나옵니다. 값이 JSON이나 글자로 쓰이고 있을 수 있습니다.',
      opinion: '바로 지우지 말고 표의 소스 위치와 “같은 이름” 곳을 먼저 보기를 권합니다. 같은 이름이 다른 곳에 선언된 복사본이면 이 필드는 쓰는 것입니다.' },
    { key: 'agent', kind: '에이전트 발견', title: '에이전트가 작업 중 발견한 것', rows: agent, primary: '고치기로 한다', second: '무시',
      mean: '에이전트가 작업이나 정기 점검에서 발견했지만, 요청으로 등록하기 전에는 고치지 않은 것입니다.', opinion: '' },
  ];
  return gs.filter((g) => g.rows.length);
}

/** 묶음 안의 표 한 줄 */
function tableRow(r: ReportRow, g: Group, hitNo: number, onChange: () => void): HTMLElement {
  const rv3 = r.review;
  const cells: Kid[] = g.key === 'agent'
    ? [h('td', null, h('b', null, r.title), r.label ? [' ', chip(r.label === '보안' ? 'bad' : 'dim', r.label)] : null), h('td', null, `${r.from}${r.at ? ` · ${fmt(r.at)}` : ''}`), h('td', { class: 'mono' }, r.where.map((w) => w.name).join(', ') || '—')]
    : [h('td', null, h('b', null, rv3?.prop ? `${rv3.info}.${rv3.prop}` : (rv3?.info ?? r.title))), h('td', null, tag('i', rv3?.info ?? '')), h('td', { class: 'mono' }, rv3?.where ?? ''),
       h('td', null, rv3?.also.length ? `같은 이름: ${rv3.also.slice(0, 2).join(', ')}${rv3.also.length > 2 ? ` 외 ${rv3.also.length - 2}` : ''}` : (rv3?.tone === 'warn' ? '같은 이름이 다른 선언에 있음(복사본일 수 있음)' : '쓰는 곳 0'))];
  return h('tr', { class: r.no === hitNo ? 'hit' : '', dataset: { no: String(r.no), ctarget: JSON.stringify({ kind: 'item', label: `리포트 #${r.no} · ${r.title.slice(0, 40)}`, no: r.no }) } }, h('td', { class: 'mono' }, `#${r.no}`), cells, h('td', { class: 'eachact' }, actionButtons(r, onChange, ' sm')));
}

/** 묶음 한 칸: 뜻, 에이전트 의견, 표, 결정 단추 */
function groupCard(g: Group, hitNo: number, onChange: () => void): HTMLElement {
  const head = g.key === 'agent' ? ['번호', '발견', '언제 · 어디서', '관련'] : ['번호', '항목', '속한 정보', '소스 위치', '확인한 근거'];
  const SHOW = 5;
  const has = g.rows.some((r) => r.no === hitNo);
  const rowsAll = g.rows.map((r) => tableRow(r, g, hitNo, onChange));
  const first = rowsAll.slice(0, SHOW), rest = rowsAll.slice(SHOW);
  const card = h('div', { class: `grp2${g.key === 'agent' ? ' ag' : ''}` });
  const run = async (state: 'registered' | 'intended' | 'ignored', reason?: string): Promise<void> => {
    try {
      await post('/__spec/report/decide-many', { ids: g.rows.map((r) => r.id), state, reason, title: `${g.title} ${g.rows.length}건 정리` });
      toast(state === 'registered' ? '요청으로 등록했습니다' : state === 'intended' ? '의도한 것으로 남겼습니다' : '무시했습니다'); onChange();
    } catch (e) { toast(errorText(e)); }
  };
  const reason = h('input', { class: 'reason-in', placeholder: '이유 한 줄 (예: 다음 요청에서 쓸 예정)', 'aria-label': '이유' });
  const reasonRow = h('div', { class: 'hidden', style: 'display:flex;gap:8px;align-items:center' }, reason, h('button', { class: 'btn sm pri', onclick: () => { void run('intended', reason.value); } }, '남기기'));
  reasonRow.classList.add('hidden');
  const isAgent = g.key === 'agent';
  card.append(
    h('div', { class: 'gh' }, g.kind === '에이전트 발견' ? buls([{ kind: 'fnd', label: '에이전트 발견' }]) : rv(g.kind), h('b', null, g.title), h('span', { class: 'n' }, `${g.rows.length}건`)),
    h('div', { class: 'gmean' }, g.mean),
    g.opinion ? h('div', { class: `op${g.kind === '먼저 확인' ? ' q' : ''}` }, h('b', null, `에이전트 의견`), h('div', null, g.opinion)) : '',
    h('table', { class: 't' }, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)), h('th', { class: 'eachact' }, '결정'))), h('tbody', null, first,
      rest.length ? h('tr', null, h('td', { colspan: String(head.length + 1), class: 'hint' }, h('details', { open: has }, h('summary', { class: 'more' }, `외 ${rest.length}건 펼쳐서 보기`), h('table', { class: 't' }, h('tbody', null, rest))))) : null)),
    h('div', { class: 'dec' },
      h('button', { class: 'btn pri', onclick: () => { void run('registered'); } }, `${g.rows.length}건 ${g.primary}`),
      h('button', { class: 'btn', onclick: () => card.classList.toggle('each') }, '건별로 고른다'),
      h('button', { class: 'btn', onclick: () => { if (isAgent) void run('ignored'); else { reasonRow.classList.toggle('hidden'); reason.focus(); } } }, g.second),
      reasonRow,
      h('span', { class: 'hint' }, `“${g.primary}”를 누르면 고칠 일(요청) 하나가 만들어지고 맡을 에이전트가 정해집니다. 고치기 시작하는 것은 한 번 더 승인합니다.`)));
  return card;
}

/** 줄 하나: 처리한 것(처리함 목록용) */
function doneRow(r: ReportRow): HTMLElement {
  return h('div', { class: 'rrow' },
    h('div', { class: 'rbody' }, h('div', { class: 'rtitle' }, buls([{ kind: 'fin', label: '처리함' }]), h('span', { class: 'mono', style: 'color:var(--dim);margin-right:6px' }, `#${r.no}`), r.title),
      h('div', { class: 'rmeta' }, h('span', { class: 'hint' }, `${r.from}${r.at ? ` · ${fmt(r.at)}` : ''}`), r.where.slice(0, 3).map((w) => (w.kind === 'screen' ? h('a', { href: hash('screen', w.name), class: 'tag c' }, w.name) : tag(w.kind === 'info' ? 'i' : '', w.name))))),
    h('div', { class: 'ract' }, decisionText(r)));
}

/**
 * @screen 리포트
 * @route /__spec/#/manage/reports
 * @domain 관리
 * @why 에이전트가 발견한 것과 확인 필요를 종류별 묶음으로 브리핑해, 목록을 하나씩 보지 않고 묶음 단위로 결정하게 한다.
 * @to 화면 설계서 | 항목의 화면 이름을 누른다 | 화면 이름
 * @does 에이전트가 발견한 것과 확인 필요를 종류별 묶음으로 본다 | 묶음마다 뜻과 에이전트 의견과 소스 위치가 있다 | 리포트를 처리한다#1 | → 2
 * @does 묶음 단위로 요청으로 등록하거나 의도한 것·무시로 처리한다 | 처리한 항목이 처리함으로 옮겨간다 | 리포트를 처리한다#2 | → 1
 */
export function reportsView(root: HTMLElement, { model, onChange, no, from }: { model: Model; kind?: string; onChange: () => void; no?: number; from?: string }): void {
  const all = model.reports;
  const open = all.filter((r) => !r.decision), done = all.filter((r) => r.decision);
  const groups = groupsOf(open);
  const count = (state: string): number => done.filter((r) => r.decision?.state === state).length;
  const hitNo = no ?? 0;
  const arrive = hitNo ? h('div', { class: 'arrive' }, `← ${from || '다른 화면'}에서 넘어왔습니다 · 리포트 #${hitNo}을 강조해 두었습니다`, h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => history.back() }, '돌아가기')) : null;
  const summary = open.length
    ? h('div', { class: 'sum' }, h('span', { class: 'big' }, `결정이 필요한 것 ${groups.length}묶음 · ${open.length}건`), groups.map((g) => chip(g.kind === '에이전트 발견' ? 'ag' : 'me', `${g.kind} ${g.rows.length}`)))
    : h('div', { class: 'empty-note' }, '결정이 필요한 것이 없습니다.');
  root.append(h('div', { class: 'wrap' },
    pageHead({ title: '리포트', lead: '이번 점검에서 나온 것을 종류별로 묶어 보여 드립니다. 묶음마다 무슨 뜻인지, 에이전트의 의견, 어디를 보면 되는지가 있고, 결정은 묶음 단위로 합니다. 결정하기 전에는 아무것도 고치지 않습니다.' }),
    arrive, summary, groups.map((g) => groupCard(g, hitNo, onChange)),
    done.length ? h('details', { class: 'rdone' }, h('summary', null, buls([{ kind: 'fin', label: '처리함' }]), h('b', null, '처리함'), h('span', { class: 'hint' }, `요청으로 등록 ${count('registered')}건 · 의도한 것 ${count('intended')}건 · 무시 ${count('ignored')}건`)),
      h('div', { class: 'rlist', style: 'margin-top:10px' }, done.map((r) => doneRow(r)))) : null));
  if (hitNo) setTimeout(() => root.querySelector(`tr[data-no="${hitNo}"]`)?.scrollIntoView({ block: 'center' }), 50);
}
