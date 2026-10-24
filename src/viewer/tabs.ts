/**
 * @spec screen-tabs 화면 설계서 오른쪽 패널의 탭
 * @why 한 화면에 대해 개요, 현행, 히스토리를 같은 자리에서 오가며 보게 한다. 설계서를 따로 쓰지 않고 소스에서 읽은 것(존재 이유, 하는 일, 구조, 정보)과 요청의 기록(설계·구현·테스트)을 한 패널에 모은다.
 * @contract 각 탭은 screen.ts가 만든 제어 객체(ctx.ts의 ScreenCtx)를 받아 요소를 만들어 돌려준다. 상태를 바꾼 뒤에는 c.render()로 다시 그린다.
 */
import { stepLabel } from './steps.js';
import { h, get, post, fmt, errorText, filterChips, chip, tag, toast, buls } from './util.js';
import type { Kid, BulKind } from './util.js';
import { hash, nav } from './route.js';
import { currentDesignApproval } from './manage-parts.js';
import type { ScreenCtx } from './ctx.js';
import type { HistoryItem, RequestView, Scenario, Spec } from '../types.js';

/** 이 화면에서 하는 일(사용 시나리오): 단계가 이 화면에서 일어나는 것들 */
const scenariosHere = (c: ScreenCtx): Scenario[] => c.model.scenarios.filter((s) => s.steps.some((st) => st.screens.includes(c.name)));
/** 이 시나리오를 범위로 하는 진행 중 요청 */
const requestsOfScenario = (c: ScreenCtx, s: Scenario): RequestView[] => c.model.requests.filter((r) => r.stage !== 'done' && r.stage !== 'cancelled' && (r.scope.scenarios ?? []).includes(s.name));
/** 컴포넌트를 쓰는 시나리오들(단계가 일어나는 자리가 그 컴포넌트) */
const scenariosOfComp = (c: ScreenCtx, sp: Spec): Scenario[] => c.model.scenarios.filter((s) => s.steps.some((st) => st.owner === sp.title));
/** 컴포넌트가 다루는 정보(이 화면의 필드 중 그 컴포넌트가 읽고 쓰는 것) */
const infosOfComp = (c: ScreenCtx, sp: Spec): { info: string; props: string[] }[] => {
  const by = new Map<string, Set<string>>();
  for (const f of c.sc().fields) if (f.specs.includes(sp.id)) { const s = by.get(f.info) ?? new Set<string>(); s.add(f.prop); by.set(f.info, s); }
  return [...by].map(([info, p]) => ({ info, props: [...p] }));
};
const sectionTitle = (t: string, sub?: string): HTMLElement => h('div', { class: 'sec-t' }, t, sub ? h('small', null, ` — ${sub}`) : null);

// ── 개요 ─────────────────────────────────────────────
/** 개요 탭: 이 화면에서 하는 일, 보여 주는 자리(컴포넌트), 쓰는 정보 */
export function overview(c: ScreenCtx): HTMLElement {
  const scs = scenariosHere(c);
  const comps = c.specs.filter((s) => s.kind !== 'logic' && !s.shell);
  const infoNames = [...new Set(c.sc().fields.map((f) => f.info))];
  return h('div', { class: 'tabcol' },
    sectionTitle('이 화면에서 하는 일 (사용 시나리오)'),
    scs.length ? scs.map((s) => h('div', { class: 'lrow' }, h('span', { class: 'lname' }, s.name), requestsOfScenario(c, s).map((r) => chip(r.turn === 'user' ? 'me' : 'ag', `요청 #${r.id}`)),
      h('button', { class: 'btn sm', onclick: () => nav(hash('flow', '', { sc: s.name })) }, '흐름 보기 ›'))) : h('div', { class: 'hint' }, '이 화면에서 일어나는 사용 시나리오가 아직 없습니다. 화면의 @does 셋째 칸에 "시나리오#단계"를 적으면 여기에 나옵니다.'),
    sectionTitle('보여 주는 자리 (컴포넌트)', '눌러서 화면에서 위치 보기'),
    comps.length ? comps.map((s) => {
      const n = scenariosOfComp(c, s).length;
      return h('button', { class: `lrow pick${c.active === s.id ? ' on' : ''}`, onclick: () => { void c.pickComp(s.id); } }, h('span', { class: 'lname' }, s.title), h('span', { class: 'grow' }), n ? h('span', { class: 'chip ag outline' }, `${n} 시나리오`) : null);
    }) : h('div', { class: 'hint' }, '이 화면에서 찾은 컴포넌트가 없습니다.'),
    sectionTitle('쓰는 정보'),
    infoNames.length ? h('div', { class: 'tagrow' }, infoNames.map((n) => h('button', { class: 'tag i', onclick: () => c.openInfo(n) }, n))) : h('div', { class: 'hint' }, '이 화면이 읽거나 쓰는 정보가 없습니다.'));
}

// ── 현행 ─────────────────────────────────────────────
/** 현행 탭: 지금 소스에서 읽은 구조(컴포넌트와 로직) */
export function nowTab(c: ScreenCtx): HTMLElement {
  const dom = c.specs.filter((s) => s.kind !== 'logic' && !s.shell), shell = c.specs.filter((s) => s.kind !== 'logic' && s.shell), logic = c.specs.filter((s) => s.kind === 'logic');
  const hidden = new Set(c.sc().hidden ?? []);
  const hiddenComps = c.model.specs.filter((s) => s.kind === 'dom' && hidden.has(s.file) && !c.specs.some((x) => x.id === s.id));
  const card = (s: Spec): HTMLElement => {
    const infos = infosOfComp(c, s);
    const n = c.countOf(s.id), d = Math.min(c.depthOf(s.id), 2);
    return h('button', { class: `ccard${c.active === s.id ? ' on' : ''}${d ? ` d${d}` : ''}`, onclick: () => { void c.pickComp(s.id); } },
      h('b', null, s.kind === 'dom' ? h('span', { class: `nn${s.shell ? ' sh' : ''}` }, c.label(s.id)) : null, s.title, s.shell ? h('span', { class: 'tag sh', style: 'margin-left:8px' }, '공통') : null, n > 1 ? h('span', { class: 'tag', style: 'margin-left:8px' }, `화면에 ${n}곳`) : null), h('div', { class: 'hint' }, infos.length ? `정보: ${infos.map((i) => i.info).join(' · ')}` : '정보 없음', ` · 소스 ${s.file.split('/').pop()}:${s.line}`));
  };
  const picked = c.specs.find((s) => s.id === c.active);
  const detail = picked ? (() => {
    const infos = infosOfComp(c, picked), scs = scenariosOfComp(c, picked);
    return h('div', { class: 'card' }, h('h3', null, `선택한 것: ${picked.title}`),
      h('div', { class: 'kv' }, h('span', null, '존재 이유'), h('span', null, picked.why || '미작성'),
        h('span', null, '정보'), h('span', null, infos.length ? infos.map((i) => [h('button', { class: 'tag i', onclick: () => c.openInfo(i.info) }, i.info), ` (${i.props.join(' · ')}) `]) : '없음'),
        h('span', null, '시나리오'), h('span', null, scs.length ? scs.map((s) => s.name).join(', ') : '없음'),
        ...(picked.kind === 'dom' && picked.reveal && !c.isOnScreen(picked.id) ? [h('span', null, '나타남'), h('span', null, `처음에는 숨어 있다 — ${picked.reveal.map(stepLabel).join(' → ')}`, h('div', null, h('button', { class: 'btn sm', onclick: async () => { const ok = await c.revealSpec(picked.id); if (!ok) toast('화면에서 열지 못했다'); c.render(); } }, '화면에서 열어 보기')))] : [])));
  })() : null;
  return h('div', { class: 'tabcol' },
    h('div', { class: 'hint' }, '소스에서 읽은 지금의 구조입니다. 화면에는 부품마다 번호가 붙고, 항목을 누르면 그 자리가 굵게 표시됩니다. 부품 안의 부품은 들여 씁니다.'),
    shell.length ? h('div', { class: 'group-t' }, '이 화면의 부품', h('small', null, String(dom.length))) : null,
    dom.map(card), dom.length ? null : h('div', { class: 'hint' }, '이 화면에서 찾은 컴포넌트가 없습니다.'),
    shell.length ? [h('div', { class: 'group-t' }, '모든 화면 공통', h('small', null, `${shell.length} · 다른 화면에도 똑같이 있음`)), shell.map(card)] : null,
    hiddenComps.length ? h('div', { class: 'fold' }, h('b', null, `이 화면에는 그려지지 않는 것 ${hiddenComps.length}`), ` — 같은 소스를 쓰는 다른 구분에서만 나오는 ${hiddenComps.map((x) => `"${x.title}"`).join(', ')}`) : null,
    logic.length ? [sectionTitle('로직 (화면에 없음)'), logic.map(card)] : null, detail);
}

// ── 히스토리 ─────────────────────────────────────────
/** 거르기 이름 */
const HFILTERS = ['전체', '설계', '테스트', '변경(커밋)'] as const;
/** 거르기 칩의 점(카드의 점과 짝) */
const HBUL: Record<string, BulKind> = { 설계: 'des', 테스트: 'tst', '변경(커밋)': 'imp', '요청 없는 변경': 'nrq' };
/** 요청 카드의 구분 점: 설계·구현(커밋)·테스트가 있거나 지금 그 단계인 것 */
function bulsOfRequest(r: RequestView): { kind: BulKind; label: string }[] {
  const has = (k: string): boolean => r.events.some((e) => e.kind === k);
  return [
    ...(r.stage === 'design' || currentDesignApproval(r) ? [{ kind: 'des' as BulKind, label: '설계' }] : []),
    ...(r.stage === 'impl' || r.commits?.length ? [{ kind: 'imp' as BulKind, label: '변경(커밋)' }] : []),
    ...(r.stage === 'test' || has('test-approved') ? [{ kind: 'tst' as BulKind, label: '테스트' }] : []),
  ];
}
/** 요청 한 건의 기록 타임라인: 요청, 설계 승인, 구현, 테스트 승인 */
function requestTimeline(r: RequestView): HTMLElement {
  const d = r.design;
  const ev = (kind: string): RequestView['events'][number] | undefined => r.events.find((e) => e.kind === kind);
  const steps: Kid[] = [];
  steps.push(h('div', { class: 'tli' }, h('i'), h('div', null, h('b', null, `요청 · ${r.source === 'user' ? '사용자' : '에이전트 발견'} · ${r.origin.channel} · ${fmt(r.origin.at)}`), r.origin.text ? h('div', { class: 'quote' }, r.origin.text) : null)));
  const ap = currentDesignApproval(r);
  if (ap) steps.push(h('div', { class: 'tli' }, h('i'), h('div', null, h('b', null, `${ap.note} · ${fmt(ap.at)}`),
    d && !d.none ? h('div', { class: 'hint' }, `정보 변경 ${d.changes.length}건 · 화면 변경 ${d.screens.length}건${d.rejected ? ` · 반려 ${d.rejected}번 후 승인` : ''}`) : null,
    d && !d.none ? h('div', { class: 'tagrow' }, d.changes.length ? h('a', { class: 'tag c', href: hash('manage', `${r.id}/info`) }, '정보 변경 스냅샷') : null, d.screens.length ? h('a', { class: 'tag c', href: hash('manage', `${r.id}/compare`) }, '화면 디자인 스냅샷') : null) : null)));
  if (r.commits?.length) steps.push(h('div', { class: 'tli' }, h('i'), h('div', null, h('b', null, '구현'), h('div', { class: 'tagrow' }, r.commits.map((x) => h('span', { class: 'code' }, x))))));
  const ta = ev('test-approved');
  if (ta) {
    const done = Object.values(r.test?.checks ?? {}).filter(Boolean).length, total = Object.keys(r.test?.checks ?? {}).length;
    steps.push(h('div', { class: 'tli' }, h('i'), h('div', null, h('b', null, `${ta.note} · ${fmt(ta.at)}`), total ? h('div', { class: 'hint' }, `확인 목록 ${done} / ${total}`) : null)));
  }
  return h('div', { class: 'timeline' }, steps);
}

/** 히스토리 탭: 이 화면을 바꾼 요청을 번호 순으로(설계 → 구현 → 테스트), 요청 번호 없이 남은 변경은 따로 */
export function history(c: ScreenCtx): HTMLElement {
  const el = h('div', { class: 'tabcol' });
  const holder = h('div', { class: 'tabcol' }, h('div', { class: 'hint' }, '읽는 중…'));
  const chipsEl = h('div');
  el.append(chipsEl, holder);
  get<{ items: HistoryItem[] }>(`/__spec/history.json?screen=${encodeURIComponent(c.name)}`).then(({ items }) => {
    const hashes = new Set(items.filter((i) => i.type === 'commit').map((i) => i.hash));
    const mine = c.model.requests.filter((r) => r.scope.screens.includes(c.name) || (r.commits ?? []).some((x) => hashes.has(x))).sort((a, b) => b.id - a.id);
    const untracked = c.model.untracked.filter((u) => hashes.has(u.hash));
    const draw = (): void => {
      const f = c.hFilter;
      const list = mine.filter((r) => (f === '설계' ? r.stage === 'design' : f === '테스트' ? r.stage === 'test' : f === '변경(커밋)' ? !!r.commits?.length : f !== '요청 없는 변경'));
      const open = new Set<number>(JSON.parse(sessionStorage.getItem('hopen') || '[]'));
      chipsEl.replaceChildren(filterChips([...HFILTERS.map((k) => ({ key: k as string, label: k, count: k === '전체' ? mine.length : mine.filter((r) => (k === '설계' ? r.stage === 'design' : k === '테스트' ? r.stage === 'test' : !!r.commits?.length)).length })), { key: '요청 없는 변경', label: '요청 없는 변경', count: untracked.length }].map((k) => ({ ...k, bul: HBUL[k.key] })), f, (k) => { c.hFilter = k; draw(); }));
      holder.replaceChildren(...[
        ...(f === '요청 없는 변경' ? [] : list.map((r) => {
          const ended = r.stage === 'done';
          const isOpen = open.has(r.id);
          return h('div', { class: `hcard${r.turn === 'user' ? ' mine' : ''}` },
            h('button', { class: 'hhead', onclick: () => { if (ended) { if (isOpen) open.delete(r.id); else open.add(r.id); sessionStorage.setItem('hopen', JSON.stringify([...open])); draw(); } else nav(hash('manage', String(r.id))); } },
              buls(bulsOfRequest(r)), h('span', { class: 'rid' }, `#${r.id}`), h('b', null, r.title), h('span', { class: 'grow' }), chip(r.turn === 'user' ? 'me' : r.turn === 'agent' ? 'ag' : 'ok', r.stepLabel), ended ? h('span', { class: 'hint' }, fmt(r.events[r.events.length - 1].at).slice(0, 5)) : null),
            ended && isOpen ? requestTimeline(r) : null);
        })),
        ...(f === '전체' || f === '요청 없는 변경' ? untracked.map((u) => h('div', { class: 'hcard untr' }, h('div', { class: 'rm' }, buls([{ kind: 'nrq', label: '요청 없는 변경' }]), h('b', null, u.title)),
          h('div', { class: 'hint' }, `${fmt(u.at)} · ${u.author} · `, h('span', { class: 'code' }, u.hash)), h('div', { class: 'hint' }, '커밋에 요청 번호가 없어 이렇게 남았습니다. ',
            h('button', { class: 'btn sm', onclick: () => { post('/__spec/request/record', { hash: u.hash, title: u.title }).then(() => { toast('요청으로 기록했습니다'); }).catch((e: unknown) => toast(errorText(e))); } }, '요청으로 기록')))) : []),
      ]);
      if (!holder.children.length) holder.append(h('div', { class: 'hint' }, '아직 이 화면을 바꾼 요청이 없습니다.'));
    };
    draw();
  }).catch((e: unknown) => holder.replaceChildren(h('div', { class: 'note' }, `이력을 읽지 못했다: ${errorText(e)}`)));
  return el;
}
export { tag };
