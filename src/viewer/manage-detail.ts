/**
 * @spec manage-detail-view 요청 상세 화면
 * @why 요청 하나의 원문, 범위, 겹침, 진행 기록을 한 화면에 모아 "왜 이 일이 있고 어디까지 왔나"를 따라가게 한다.
 * @contract model.requests의 항목 모양(types.ts의 RequestView)에 기대어 그린다. 겹치는 요청은 같은 화면의 다른 번호로 이동한다.
 */
import { h, fmt } from './util.js';
import type { Kid } from './util.js';
import { hash, nav } from './route.js';
import { stepper, chipFor, scopeTags } from './manage-parts.js';
import type { Model } from '../types.js';

/**
 * @screen 요청 상세
 * @route /__spec/#/manage/:id
 * @domain 관리
 * @why 요청 하나의 원문, 범위, 겹침, 진행 기록을 한 화면에 모아 "왜 이 일이 있고 어디까지 왔나"를 따라가게 한다.
 * @to 요청 목록 | 위쪽 "요청"을 누른다
 * @to 요청 상세 | 겹치는 요청의 "열기"를 누른다 | 요청 번호
 * @does 겹치는 다른 요청을 열어 본다 | 그 요청의 상세가 열린다
 */
export function manageDetail(root: HTMLElement, { model, id }: { model: Model; id: string }): void {
  const r = model.requests.find((x) => String(x.id) === String(id));
  if (!r) { root.append(h('div', { class: 'empty-note', style: 'flex:1' }, `요청 #${id}을 찾지 못했다`)); return; }
  const kv = (k: string, v: Kid): Kid[] => [h('span', { class: 'k' }, k), h('span', null, v)];
  root.append(h('main', { class: 'mg-wrap' },
    h('div', null, h('div', { class: 'crumb' }, h('a', { href: hash('manage') }, '요청'), ` › #${r.id}`),
      h('h1', { style: 'margin:6px 0 0' }, r.title),
      h('div', { class: 'rm', style: 'margin-top:10px' }, chipFor(r), scopeTags(r), h('span', null, `${r.source === 'user' ? '사용자 요청' : '에이전트 발견'} · ${r.origin.channel} · ${fmt(r.origin.at)}`))),
    h('div', { class: 'mg-card' }, stepper(r)),
    h('div', { class: 'mg-card' }, h('h3', null, '맡은 에이전트'),
      r.agent.name ? h('div', { class: 'rm' }, h('span', { class: 'chip ag' }, r.agent.name), h('span', { class: 'code' }, `claude attach ${r.agent.name}`)) : h('div', { class: 'rm' }, '아직 정해지지 않았습니다')),
    r.origin.text ? h('div', { class: 'mg-card' }, h('h3', null, '요청 원문'), h('div', { class: 'quote' }, r.origin.text)) : null,
    h('div', { class: 'mg-card' }, h('h3', null, '범위'), h('div', { class: 'kv' }, kv('화면', r.scope.screens.join(', ') || '없음'), kv('정보', r.scope.infos.join(', ') || '없음'))),
    r.overlaps.length ? h('div', { class: 'mg-card' }, h('h3', null, `다른 요청과 겹침 · ${r.overlaps.length}건`),
      r.overlaps.map((o) => h('div', { class: 'warn' }, h('div', { class: 'rm' }, h('b', null, `#${o.id}`), h('span', null, o.title)),
        h('div', { class: 'kv', style: 'margin-top:8px' }, kv('겹치는 곳', [...o.screens.map((s) => `화면 ${s}`), ...o.infos.map((s) => `정보 ${s}`)].join(', '))),
        h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => nav(hash('manage', String(o.id))) }, `#${o.id} 열기`)))) : null,
    h('div', { class: 'mg-card' }, h('h3', null, '진행 기록'),
      h('div', { class: 'tl' }, r.events.map((e) => h('div', null, h('i'), h('span', null, h('b', null, e.note || e.kind), ` · ${e.by === 'user' ? '사용자' : '에이전트'} · ${fmt(e.at)}`)))))));
}
