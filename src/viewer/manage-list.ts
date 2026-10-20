/**
 * @spec manage-list-view 요청 목록 화면
 * @why 현재를 바꾸는 일(요청)을 "내 차례 / 에이전트 차례 / 끝난 것"으로 나눠 한곳에서 본다.
 * @contract model.requests를 그대로 그린다. 요청을 열 때는 요청 상세 주소(#/manage/<번호>)로 이동한다.
 */
import { h, fmt } from './util.js';
import { hash, nav } from './route.js';
import { stepper, chipFor, scopeTags } from './manage-parts.js';
import type { Model, RequestView } from '../types.js';

/** 목록의 요청 한 줄 */
function row(r: RequestView): HTMLDivElement {
  return h('div', { class: `mg-req${r.turn === 'user' ? ' mine' : ''}` },
    h('div', { class: 'rid' }, `#${r.id}`),
    h('div', null, h('div', { class: 'rt' }, r.title),
      h('div', { class: 'rm' }, scopeTags(r), r.overlaps.length ? h('span', { class: 'chip me' }, `겹침 ${r.overlaps.map((o) => `#${o.id}`).join(' ')}`) : null,
        h('span', null, `${r.source === 'user' ? '사용자 요청' : '에이전트 발견'} · ${fmt(r.origin.at)}`))),
    stepper(r),
    h('div', { class: 'ract' }, chipFor(r), h('button', { class: `btn${r.turn === 'user' ? ' pri' : ''}`, onclick: () => nav(hash('manage', String(r.id))) }, '열기')));
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
 * @does 요청의 진행 단계와 누구 차례인지를 본다 | 내 차례인 요청이 위에 모여 있다
 * @does 요청의 "열기"를 눌러 상세를 본다 | 요청 상세 화면이 열린다 | → 요청 상세
 */
export function manageList(root: HTMLElement, { model }: { model: Model }): void {
  const all = model.requests;
  const mine = all.filter((r) => r.turn === 'user'), agent = all.filter((r) => r.turn === 'agent'), ended = all.filter((r) => !r.turn);
  const wrap = h('main', { class: 'mg-wrap' },
    h('div', { class: 'mg-head' }, h('div', null, h('h1', null, '요청'), h('p', null, '현재를 바꾸는 일을 한곳에서 관리합니다. 요청 하나가 화면 몇 개를 건드려도 하나로 다룹니다.'))),
    all.length ? null : h('div', { class: 'empty-note' }, '아직 요청이 없습니다. 에이전트에게 변경을 요청하면 여기에 올라옵니다.'),
    section('내 차례', `${mine.length}건 — 내가 승인하거나 확인해야 진행됩니다`, mine),
    section('에이전트 차례', `${agent.length}건`, agent),
    ended.length ? h('details', { class: 'mg-sec' }, h('summary', null, `끝난 요청 ${ended.length}건`), h('div', { class: 'mg-list', style: 'margin-top:10px' }, ended.map(row))) : null);
  root.append(wrap);
}
