/**
 * @spec reports-view 리포트 화면
 * @why 에이전트가 작업 중이나 정기 점검에서 발견한 것과, 기계가 판단할 수 없어 올라온 확인 필요를 한 목록에 모아 사용자가 요청으로 등록하거나 무시하거나 의도한 것으로 남기게 한다. 요청으로 등록하기 전에는 아무것도 고치지 않는다.
 * @contract model.reports를 그대로 그린다. 처리 단추는 확인 필요 패널과 같은 부품(review.ts)을 쓴다.
 */
import { h, pageHead, filterChips, chip, tag, rv, fmt, buls, type BulKind } from './util.js';
import { actionButtons, decisionText } from './review.js';
import { hash, nav } from './route.js';
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

/**
 * @screen 리포트
 * @route /__spec/#/manage/reports
 * @domain 관리
 * @why 에이전트가 발견한 것과 확인 필요를 한 목록에 모아, 요청으로 등록하거나 무시하거나 의도한 것으로 남기게 한다.
 * @to 화면 설계서 | 항목의 화면 이름을 누른다 | 화면 이름
 * @does 에이전트가 발견한 것과 확인 필요를 한 목록에서 본다 | 처리 전 항목이 위에 모여 있다 | 리포트를 처리한다#1 | → 2
 * @does 항목을 요청으로 등록하거나 의도한 것·무시로 처리한다 | 처리한 항목이 처리함으로 옮겨간다 | 리포트를 처리한다#2 | → 1
 */
export function reportsView(root: HTMLElement, { model, kind, onChange }: { model: Model; kind: string; onChange: () => void }): void {
  const all = model.reports;
  const open = all.filter((r) => !r.decision), done = all.filter((r) => r.decision);
  const KINDS = [
    { key: '', label: '전체', bul: undefined as BulKind | undefined, list: open },
    { key: 'agent', label: '에이전트 발견', bul: 'fnd' as BulKind | undefined, list: open.filter((r) => r.origin === 'agent') },
    { key: 'review', label: '확인 필요', bul: 'rev' as BulKind | undefined, list: open.filter((r) => r.origin === 'review') },
    { key: 'done', label: '처리함', bul: 'fin' as BulKind | undefined, list: done },
  ];
  const cur = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  const count = (state: string): number => done.filter((r) => r.decision?.state === state).length;
  root.append(h('div', { class: 'wrap' },
    pageHead({ title: '리포트', lead: '에이전트가 작업 중이나 정기 점검에서 발견한 것, 그리고 기계가 판단할 수 없어 올라온 확인 필요를 한곳에 모았습니다. 요청으로 등록하기 전에는 아무것도 고치지 않습니다.' }),
    filterChips(KINDS.map((k) => ({ key: k.key, label: k.label, bul: k.bul, count: k.list.length })), cur.key, (k) => nav(hash('manage', 'reports', { kind: k || undefined }))),
    h('div', { class: 'rlist' }, cur.list.length ? cur.list.map((r) => row(r, onChange)) : h('div', { class: 'empty-note' }, cur.key === 'done' ? '처리한 항목이 없습니다.' : '처리할 항목이 없습니다.')),
    cur.key !== 'done' && done.length ? h('details', { class: 'rdone' }, h('summary', null, buls([{ kind: 'fin', label: '처리함' }]), h('b', null, '처리함'), h('span', { class: 'hint' }, `요청으로 등록 ${count('registered')}건 · 의도한 것 ${count('intended')}건 · 무시 ${count('ignored')}건`), h('span', { class: 'grow' }), h('span', { class: 'hint' }, '펼쳐서 보기 ›')),
      h('div', { class: 'rlist', style: 'margin-top:10px' }, done.map((r) => row(r, onChange)))) : null));
}
