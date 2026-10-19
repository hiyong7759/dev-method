/**
 * @spec map-view 화면 흐름
 * @why 시작에서 몇 번째 단계인지 왼쪽에서 오른쪽으로 놓고, 화면 카드에 상태와 나가는 길(어떤 행동으로 무엇을 넘기는지)을 적어, 사용자가 앱을 어떻게 지나가는지 한눈에 보게 한다.
 * @contract model.screens의 stage, to, status, memoPending, infoCount를 그대로 그린다.
 */
import { h, statusChip } from './util.js';
import type { Model, ModelScreen } from '../types.js';

/**
 * @screen 화면 흐름
 * @route /__spec/#/map
 * @domain 현행
 * @start
 * @why 사용자가 앱을 어떻게 지나가는지(화면 순서와 나가는 길)를 한눈에 보게 한다. 설계서 보기의 첫 화면이다.
 * @does 화면 카드를 눌러 그 화면의 설계서를 연다 | 카드를 누르면 화면 설계서가 열린다
 * @does 분야(도메인)로 화면을 거른다 | 고른 분야의 화면만 남는다
 */
export function mapView(root: HTMLElement, { model, domain, setDomain, openScreen }: { model: Model; domain: string; setDomain: (d: string) => void; openScreen: (name: string) => void }): void {
  const doms = [...new Set(model.screens.map((s) => s.domain).filter(Boolean))];
  const shown = model.screens.filter((s) => !domain || s.domain === domain);
  const nav = h('div', { class: 'side-nav' }, h('h4', null, '도메인으로 보기'),
    h('button', { class: `dom-btn${!domain ? ' sel' : ''}`, onclick: () => setDomain('') }, '전체', h('span', null, model.screens.length)),
    doms.map((d) => h('button', { class: `dom-btn${domain === d ? ' sel' : ''}`, onclick: () => setDomain(d) }, d, h('span', null, model.screens.filter((s) => s.domain === d).length))),
    model.notes.slice(0, 8).map((n) => h('div', { class: 'note' }, n.text)));
  const stages: Record<number, ModelScreen[]> = {};
  shown.forEach((s) => (stages[s.stage] = stages[s.stage] || []).push(s));
  const cols = Object.keys(stages).map(Number).sort((a, b) => a - b).map((k) => h('div', { class: 'stage-col' }, h('h5', null, k === 0 ? '시작' : `${k + 1}단계`),
    stages[k].map((s) => {
      const noOut = !s.to.length && model.screens.length > 1;
      const hot = ['test-requested', 'approved-changed'].includes(s.status.status);
      return h('button', { class: `scard${hot ? ' focus' : ''}${noOut ? ' dashed' : ''}`, onclick: () => openScreen(s.name) },
        h('div', { class: 'st-top' }, h('span', { class: 'nm' }, s.name), s.domain ? h('span', { class: 'dtag' }, s.domain) : null, statusChip(s.status, hot ? ' pulse' : ''),
          s.memoPending ? h('span', { class: 'chip-st memo pulse pp' }, `메모 전달 전 ${s.memoPending}`) : null, h('span', { class: 'cnt' }, `정보 ${s.infoCount}`)),
        s.to.length ? s.to.map((t) => h('div', { class: `mv${t.verified ? '' : ' warn'}` }, `→ ${t.target} · ${t.action || ''}${t.pass ? ` (${t.pass} 넘김)` : ''}`, t.verified ? null : ' · 코드에서 못 찾음')) : h('div', { class: 'mv warn' }, noOut ? '나가는 길 없음 — 확인' : ''));
    })));
  root.append(h('div', { class: 'map-body' }, nav, h('div', { class: 'map-main' },
    h('p', { class: 'map-help' }, '왼쪽에서 오른쪽으로, 사용자가 가는 순서대로 놓았다. 화면을 누르면 그 화면의 설계서(존재 이유, 다루는 정보)가 열린다. 이동은 "어떤 행동으로, 무엇을 넘기며 가나"를 글로 적었다.'),
    model.screens.length ? h('div', { class: 'stages' }, cols) : h('div', { class: 'empty-note' }, '@screen을 쓴 화면이 아직 없다'))));
}
