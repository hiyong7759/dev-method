/**
 * @spec manage-list-view 요청 목록 화면
 * @why 현재를 바꾸는 일(요청)을 "내 차례 / 에이전트 차례 / 끝난 것"으로 나눠 한곳에서 본다. 리포트는 따로 있고, 요청 번호 없이 남은 변경은 거르기 줄에서 본다.
 * @contract model.requests와 model.untracked를 그대로 그린다. 요청을 열 때는 요청 상세 주소(#/manage/<번호>)로 이동한다.
 */
import { h, post, pageHead, filterChips, chip, fmt, toast, errorText } from './util.js';
import { hash, nav } from './route.js';
import { stepper, chipFor, scopeTags } from './manage-parts.js';
import type { Model, RequestView } from '../types.js';

/** 목록의 요청 한 줄 */
function row(r: RequestView): HTMLDivElement {
  const approvedNone = r.events.some((e) => e.kind === 'design-approved' && e.note.includes('설계 없음'));
  const extra = [r.source === 'user' ? '사용자 요청' : '에이전트 발견', fmt(r.origin.at), approvedNone ? '설계 없음으로 승인함' : r.design?.rejected ? `설계를 ${r.design.rejected}번 반려함` : '', r.agent.name ? `맡은 에이전트 ${r.agent.name}` : ''].filter(Boolean).join(' · ');
  const waiting = r.waitingFor.length > 0;
  const o = r.overlaps[0];
  const where = o ? (o.components[0] ? ` · 컴포넌트 ${o.components[0]}` : o.screens[0] ? ` · 화면 ${o.screens[0]}` : '') : '';
  return h('div', { class: `mg-req${r.turn === 'user' ? ' mine' : ''}` },
    h('div', { class: 'rid' }, `#${r.id}`),
    h('div', null, h('div', { class: 'rt' }, r.title),
      h('div', { class: 'rm' }, scopeTags(r), o ? chip('me', `겹침 ${r.overlaps.map((x) => `#${x.id}`).join(' ')}${where}`) : null,
        h('span', null, waiting ? `#${r.waitingFor.join(', #')}가 끝난 뒤 시작하도록 대기 중` : extra))),
    stepper(r),
    h('div', { class: 'ract' }, chipFor(r), h('button', { class: `btn${r.turn === 'user' ? ' pri' : ''}`, onclick: () => nav(hash('manage', String(r.id))) }, waiting ? '순서 바꾸기' : '열기')));
}

/** 목록을 "누구 차례"별 묶음으로 나눠 보이는 한 칸. 비면 그리지 않는다 */
function section(title: string, hint: string, list: RequestView[]): HTMLElement | null {
  if (!list.length) return null;
  return h('section', { class: 'mg-sec' }, h('h2', null, title, h('small', null, hint)), h('div', { class: 'mg-list' }, list.map(row)));
}

/**
 * @screen 요청 목록
 * @route /__spec/#/manage
 * @domain 관리
 * @start
 * @why 현재를 바꾸는 일(요청)을 "내 차례 / 에이전트 차례 / 끝난 것"으로 나눠 한곳에서 본다.
 * @to 요청 상세 | 요청의 "열기"를 누른다 | 요청 번호
 * @does 요청의 진행 단계와 누구 차례인지를 본다 | 내 차례인 요청이 위에 모여 있다 | 요청의 진행을 확인한다#1 | → 2
 * @does 요청의 "열기"를 눌러 상세를 본다 | 요청 상세 화면이 열린다 | 요청의 진행을 확인한다#2 | → 3
 */
export function manageList(root: HTMLElement, { model, kind, onChange }: { model: Model; kind: string; onChange: () => void }): void {
  const all = model.requests;
  const KINDS = [
    { key: '', label: '전체', list: all },
    { key: 'design', label: '설계 단계', list: all.filter((r) => r.stage === 'design') },
    { key: 'test', label: '테스트 단계', list: all.filter((r) => r.stage === 'test') },
    { key: 'report', label: '에이전트 발견', list: all.filter((r) => r.source === 'report') },
    { key: 'untracked', label: '요청 없는 변경', list: [] as RequestView[] },
  ];
  const cur = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  const counts = (k: (typeof KINDS)[number]): number => (k.key === 'untracked' ? model.untracked.length : k.list.length);
  const list = cur.list;
  const mine = list.filter((r) => r.turn === 'user'), agent = list.filter((r) => r.turn === 'agent'), ended = list.filter((r) => !r.turn);
  const body = cur.key === 'untracked'
    ? [model.untracked.length ? h('div', { class: 'mg-list' }, model.untracked.map((c) => h('div', { class: 'mg-req untracked' },
      h('div', { class: 'rid mono' }, c.hash), h('div', null, h('div', { class: 'rt' }, c.title), h('div', { class: 'rm' }, chip('me', '요청 없는 변경'), h('span', null, `${fmt(c.at)} · ${c.author} · 커밋에 요청 번호가 없어 이렇게 남았습니다`))),
      h('span'), h('div', { class: 'ract' }, h('button', { class: 'btn', onclick: () => { post('/__spec/request/record', { hash: c.hash, title: c.title }).then(() => { toast('요청으로 기록했습니다'); onChange(); }).catch((e: unknown) => toast(errorText(e))); } }, '요청으로 기록'))))) : h('div', { class: 'empty-note' }, '요청 번호 없이 남은 변경이 없습니다.')]
    : [all.length ? null : h('div', { class: 'empty-note' }, '아직 요청이 없습니다. 에이전트에게 변경을 요청하면 여기에 올라옵니다.'),
      section('내 차례', `${mine.length}건 — 내가 승인하거나 반려해야 진행됩니다`, mine),
      section('에이전트 차례', `${agent.length}건`, agent),
      ended.length ? h('details', { class: 'mg-sec' }, h('summary', null, chip('ok', '완료'), h('span', null, `끝난 요청 ${ended.length}건`), h('span', { class: 'grow' }), h('span', { class: 'hint' }, '펼쳐서 보기 ›')), h('div', { class: 'mg-list', style: 'margin-top:10px' }, ended.map(row))) : null];
  root.append(h('div', { class: 'wrap' },
    pageHead({ title: '요청', lead: '현재를 바꾸는 일을 한곳에서 관리합니다. 요청 하나가 화면 몇 개를 건드려도 하나로 다룹니다.' }),
    filterChips(KINDS.map((k) => ({ key: k.key, label: k.label, count: counts(k) })), cur.key, (k) => nav(hash('manage', '', { kind: k || undefined }))),
    ...body));
}
