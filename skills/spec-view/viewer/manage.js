/**
 * @spec manage-view 관리 영역 화면
 * @why 화면·정보를 보는 현행 영역과 분리해, "무엇을 왜 어떻게 바꾸는 중인가"를 한곳에서 관리하고 따라가게 한다. 요청 목록(#/manage)과 요청 상세(#/manage/<번호>)를 그린다.
 * @contract model.requests의 항목 모양(요청 파일 + request.mjs의 describeRequests가 붙이는 stepLabel, turn, overlaps)에 기대어 그린다. 그 모양이 바뀌면 이 파일도 고친다.
 */
import { h, fmt } from './util.js';

// 요청이 거치는 네 단계(진행 표시의 순서)
const STAGES = [['design', '설계'], ['impl', '구현'], ['test', '테스트'], ['done', '완료']];

// 요청이 어느 단계까지 왔는지 한눈에 보이게 한다: 지난 단계 초록, 지금 단계 노랑
function stepper(r) {
  const cur = STAGES.findIndex(([k]) => k === r.stage);
  return h('div', { class: 'mg-st' }, STAGES.map(([k, l], i) => [i ? h('u') : null, h('span', { class: r.stage === 'done' || cur > i ? 'd' : cur === i ? 'c' : '' }, h('i'), l)]));
}
// 지금 상태와 누구 차례인지를 색으로 알린다(사용자 차례는 노랑)
const chipFor = (r) => h('span', { class: `chip ${r.turn === 'user' ? 'me' : r.turn === 'agent' ? 'ag' : r.stage === 'done' ? 'ok' : 'dim'}` }, r.stepLabel);
// 요청이 건드리는 화면과 정보를 이름표로 보인다
const scopeTags = (r) => [...r.scope.screens.map((s) => h('span', { class: 'tag' }, `화면 ${s}`)), ...r.scope.infos.map((s) => h('span', { class: 'tag' }, `정보 ${s}`))];

// 목록의 요청 한 줄
function row(r, open) {
  return h('div', { class: `mg-req${r.turn === 'user' ? ' mine' : ''}` },
    h('div', { class: 'rid' }, `#${r.id}`),
    h('div', null, h('div', { class: 'rt' }, r.title),
      h('div', { class: 'rm' }, scopeTags(r), r.overlaps.length ? h('span', { class: 'chip me' }, `겹침 ${r.overlaps.map((o) => `#${o.id}`).join(' ')}`) : null,
        h('span', null, `${r.source === 'user' ? '사용자 요청' : '에이전트 발견'} · ${fmt(r.origin.at)}`))),
    stepper(r),
    h('div', { class: 'ract' }, chipFor(r), h('button', { class: `btn${r.turn === 'user' ? ' pri' : ''}`, onclick: () => open(r.id) }, '열기')));
}

// 목록을 "누구 차례"별 묶음으로 나눠 보이는 한 칸. 비면 그리지 않는다
function section(title, hint, list, open) {
  if (!list.length) return null;
  return h('section', { class: 'mg-sec' }, h('h2', null, title, h('small', null, hint)), h('div', { class: 'mg-list' }, list.map((r) => row(r, open))));
}

// 관리의 요청 목록 화면
export function manageList(root, { model, open }) {
  const all = model.requests;
  const mine = all.filter((r) => r.turn === 'user'), agent = all.filter((r) => r.turn === 'agent'), ended = all.filter((r) => !r.turn);
  const wrap = h('main', { class: 'mg-wrap' },
    h('div', { class: 'mg-head' }, h('div', null, h('h1', null, '요청'), h('p', null, '현재를 바꾸는 일을 한곳에서 관리합니다. 요청 하나가 화면 몇 개를 건드려도 하나로 다룹니다.'))),
    all.length ? null : h('div', { class: 'empty-note' }, '아직 요청이 없습니다. 에이전트에게 변경을 요청하면 여기에 올라옵니다.'),
    section('내 차례', `${mine.length}건 — 내가 승인하거나 확인해야 진행됩니다`, mine, open),
    section('에이전트 차례', `${agent.length}건`, agent, open),
    ended.length ? h('details', { class: 'mg-sec' }, h('summary', null, `끝난 요청 ${ended.length}건`), h('div', { class: 'mg-list', style: 'margin-top:10px' }, ended.map((r) => row(r, open)))) : null);
  root.append(wrap);
}

// 요청 하나의 상세: 원문, 범위, 겹침, 진행 기록을 한 화면에 모아 "왜 이 일이 있고 어디까지 왔나"를 따라가게 한다
export function manageDetail(root, { model, id, back, open }) {
  const r = model.requests.find((x) => String(x.id) === String(id));
  if (!r) { root.append(h('div', { class: 'empty-note', style: 'flex:1' }, `요청 #${id}을 찾지 못했다`)); return; }
  const kv = (k, v) => [h('span', { class: 'k' }, k), h('span', null, v)];
  root.append(h('main', { class: 'mg-wrap' },
    h('div', null, h('div', { class: 'crumb' }, h('a', { href: '#/manage', onclick: (e) => { e.preventDefault(); back(); } }, '요청'), ` › #${r.id}`),
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
        h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => open(o.id) }, `#${o.id} 열기`)))) : null,
    h('div', { class: 'mg-card' }, h('h3', null, '진행 기록'),
      h('div', { class: 'tl' }, r.events.map((e) => h('div', null, h('i'), h('span', null, h('b', null, e.note || e.kind), ` · ${e.by === 'user' ? '사용자' : '에이전트'} · ${fmt(e.at)}`)))))));
}
