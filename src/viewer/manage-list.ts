/**
 * @spec manage-list-view 요청 목록 화면
 * @why 현재를 바꾸는 일(요청)을 "내 차례 / 에이전트 차례 / 시작 전 / 끝난 것"으로 나눠 한곳에서 본다. 리포트는 따로 있고, 요청 번호 없이 남은 변경은 거르기 줄에서 본다.
 * @contract model.requests와 model.untracked를 그대로 그린다. 요청을 열 때는 요청 상세 주소(#/manage/<번호>)로 이동한다.
 */
import { h, post, pageHead, filterChips, chip, fmt, toast, errorText, buls, type BulKind } from './util.js';
import { hash, nav } from './route.js';
import { chipFor, scopeTags, currentDesignApproval } from './manage-parts.js';
import type { Model, RequestView } from '../types.js';

/** 요청 카드의 구분 점: 지금 단계(설계·구현·테스트)와 에이전트 발견 여부. 거르기 칩의 점과 짝이다 */
const STAGE_BUL: Record<string, { kind: BulKind; label: string }> = { design: { kind: 'des', label: '설계' }, impl: { kind: 'imp', label: '구현' }, test: { kind: 'tst', label: '테스트' }, done: { kind: 'cmp', label: '완료' } };
const isQueued = (r: RequestView): boolean => r.stage === 'design' && r.step === 'queued';
const bulsOf = (r: RequestView): { kind: BulKind; label: string }[] => [...(isQueued(r) ? [{ kind: 'que' as BulKind, label: '접수' }] : STAGE_BUL[r.stage] ? [STAGE_BUL[r.stage]] : []), ...(r.source === 'report' ? [{ kind: 'fnd' as BulKind, label: '에이전트 발견' }] : [])];

/** 목록의 요청 한 줄 */
function row(r: RequestView, onChange: () => void): HTMLDivElement {
  const approvedNone = !!currentDesignApproval(r)?.note.includes('설계 없음');
  const extra = [r.source === 'user' ? '사용자 요청' : '에이전트 발견', fmt(r.origin.at), approvedNone ? '설계 없음으로 승인함' : r.design?.rejected ? `설계를 ${r.design.rejected}번 반려함` : '', r.agent.name ? `맡은 에이전트 ${r.agent.name}` : ''].filter(Boolean).join(' · ');
  const waiting = r.waitingFor.length > 0;
  const o = r.overlaps[0];
  const where = o ? (o.components[0] ? ` · 컴포넌트 ${o.components[0]}` : o.screens[0] ? ` · 화면 ${o.screens[0]}` : '') : '';
  // 카드 전체가 열기 영역이다. 카드 안의 단추는 카드 열기와 따로 움직이게 눌림이 위로 번지지 않게 한다
  const own = (f: () => void) => (e: Event): void => { e.stopPropagation(); f(); };
  const start = (): void => { post('/__spec/request/start', { id: r.id }).then(() => { toast(`요청 #${r.id}을 시작했습니다. 담당 세션이 설계를 쓰는 중입니다`); onChange(); }).catch((err: unknown) => toast(errorText(err))); };
  return h('div', { class: `mg-req${r.turn === 'user' ? ' mine' : ''}`, onclick: () => nav(hash('manage', String(r.id))) },
    h('div', { class: 'rid' }, `#${r.id}`),
    h('div', null, h('div', { class: 'rt' }, buls(bulsOf(r)), r.title),
      h('div', { class: 'rm' }, scopeTags(r), o ? chip('me', `겹침 ${r.overlaps.map((x) => `#${x.id}`).join(' ')}${where}`) : null,
        h('span', null, waiting ? `#${r.waitingFor.join(', #')}가 끝난 뒤 시작하도록 대기 중` : extra))),
    h('div', { class: 'ract' }, chipFor(r),
      waiting ? h('button', { class: 'btn', onclick: own(() => nav(hash('manage', String(r.id)))) }, '순서 바꾸기')
        : isQueued(r) ? h('button', { class: 'btn pri', onclick: own(start) }, '시작') : null));
}

/** 목록을 "누구 차례"별 묶음으로 나눠 보이는 한 칸. 비면 그리지 않는다 */
function section(title: string, hint: string, list: RequestView[], onChange: () => void): HTMLElement | null {
  if (!list.length) return null;
  return h('section', { class: 'mg-sec' }, h('h2', null, title, h('small', null, hint)), h('div', { class: 'mg-list' }, list.map((r) => row(r, onChange))));
}

/**
 * @spec manage-list-done-fold 완료 요청 접힘 영역
 * @anchor dom:details.mg-sec
 * @open 누르기 완료
 * @why 끝난 요청은 목록을 길게 만들지 않도록 접어 두고, 사용자가 누르면 펼쳐 지난 일을 다시 본다.
 */

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
    { key: '', label: '전체', bul: undefined as BulKind | undefined, list: all },
    { key: 'queued', label: '접수', bul: 'que' as BulKind | undefined, list: all.filter(isQueued) },
    { key: 'design', label: '설계', bul: 'des' as BulKind | undefined, list: all.filter((r) => r.stage === 'design' && !isQueued(r)) },
    { key: 'impl', label: '구현', bul: 'imp' as BulKind | undefined, list: all.filter((r) => r.stage === 'impl') },
    { key: 'test', label: '테스트', bul: 'tst' as BulKind | undefined, list: all.filter((r) => r.stage === 'test') },
    { key: 'done', label: '완료', bul: 'cmp' as BulKind | undefined, list: all.filter((r) => r.stage === 'done') },
    // 요청 없는 변경은 칩이 아니라 목록 아래 한 줄로 보인다(주소의 kind=untracked로만 연다)
    { key: 'untracked', label: '요청 없는 변경', bul: 'nrq' as BulKind | undefined, list: [] as RequestView[] },
  ];
  const cur = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  const counts = (k: (typeof KINDS)[number]): number => (k.key === 'untracked' ? model.untracked.length : k.list.length);
  const list = cur.list;
  const mine = list.filter((r) => r.turn === 'user'), agent = list.filter((r) => r.turn === 'agent'), queued = list.filter(isQueued), ended = list.filter((r) => !r.turn && !isQueued(r));
  const body = cur.key === 'untracked'
    ? [model.untracked.length ? h('div', { class: 'mg-list' }, model.untracked.map((c) => h('div', { class: 'mg-req untracked' },
      h('div', { class: 'rid mono' }, c.hash), h('div', null, h('div', { class: 'rt' }, buls([{ kind: 'nrq', label: '요청 없는 변경' }]), c.title), h('div', { class: 'rm' }, h('span', null, `${fmt(c.at)} · ${c.author} · 커밋에 요청 번호가 없어 이렇게 남았습니다`))),
      h('span'), h('div', { class: 'ract' }, h('button', { class: 'btn', onclick: () => { post('/__spec/request/record', { hash: c.hash, title: c.title }).then(() => { toast('요청으로 기록했습니다'); onChange(); }).catch((e: unknown) => toast(errorText(e))); } }, '요청으로 기록'))))) : h('div', { class: 'empty-note' }, '요청 번호 없이 남은 변경이 없습니다.')]
    : [all.length ? null : h('div', { class: 'empty-note' }, '아직 요청이 없습니다. 에이전트에게 변경을 요청하면 여기에 올라옵니다.'),
      section('내 차례', `${mine.length}건 — 내가 승인하거나 반려해야 진행됩니다`, mine, onChange),
      section('에이전트 차례', `${agent.length}건`, agent, onChange),
      section('접수', `${queued.length}건 — 우선순위를 정한 것부터 「시작」을 누릅니다`, queued, onChange),
      model.untracked.length ? h('div', { class: 'mg-sec' }, h('a', { class: 'mg-line', href: hash('manage', '', { kind: 'untracked' }) }, buls([{ kind: 'nrq', label: '요청 없는 변경' }]), h('b', null, '요청 없는 변경'), h('span', null, `요청 번호 없이 남은 변경 ${model.untracked.length}건`), h('span', { class: 'grow' }), h('span', { class: 'hint' }, '보기 ›'))) : null,
      ended.length ? h('details', { class: 'mg-sec' }, h('summary', null, buls([{ kind: 'cmp', label: '완료' }]), h('b', null, '완료'), h('span', null, `끝난 요청 ${ended.length}건`), h('span', { class: 'grow' }), h('span', { class: 'hint' }, '펼쳐서 보기 ›')), h('div', { class: 'mg-list', style: 'margin-top:10px' }, ended.map((r) => row(r, onChange)))) : null];
  root.append(h('div', { class: 'wrap' },
    pageHead({ title: '요청', lead: '현재를 바꾸는 일을 한곳에서 관리합니다. 요청 하나가 화면 몇 개를 건드려도 하나로 다룹니다.' }),
    filterChips(KINDS.map((k) => ({ key: k.key, label: k.label, bul: k.bul, count: counts(k) })), cur.key, (k) => nav(hash('manage', '', { kind: k || undefined }))),
    ...body));
}
