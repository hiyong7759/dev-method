/**
 * @spec manage-detail-view 요청 상세 화면
 * @why 요청 하나의 원문, 에이전트의 설계, 범위, 겹침, 진행 기록을 한 화면에 모아 "왜 이 일이 있고 어디까지 왔나"를 따라가게 한다. 설계 단계에서는 설계를 승인·반려하고, 테스트 단계에서는 사용 시나리오 확인표로 테스트를 승인한다. 승인은 사용자만 한다.
 * @contract model.requests의 항목 모양(types.ts의 RequestView)에 기대어 그린다. 승인·반려·순서·체크는 서버의 /__spec/request/*로 보낸 뒤 onChange로 화면을 다시 그린다.
 */
import { h, post, pageHead, chip, tag, fmt, toast, errorText, copyText, sidePanel } from './util.js';
import type { Kid } from './util.js';
import { hash, nav } from './route.js';
import { stepperBig, chipFor, scopeTags, withPanel } from './manage-parts.js';
import { manageInfoOverlay, manageCompare } from './manage-views.js';
import type { Model, RequestView, Scenario, ScenarioStep } from '../types.js';

/** 서버에 결정을 보내고 성공하면 화면을 다시 그린다 */
function act(path: string, body: Record<string, unknown>, done: string, onChange: () => void): void {
  post(`/__spec/request/${path}`, body).then(() => { toast(done); onChange(); }).catch((e: unknown) => toast(errorText(e)));
}
const kv = (k: string, v: Kid): Kid[] => [h('span', null, k), h('span', null, v)];

/** 겹치는 요청 칸: 겹치는 곳, 각자 하는 일, 판단과 순서 정하기 단추 */
function overlapCard(r: RequestView, onChange: () => void, model?: Model): HTMLElement | null {
  if (!r.overlaps.length) return null;
  return h('div', { class: 'card' }, h('h3', null, '다른 요청과 겹침 ', h('small', null, `${r.overlaps.length}건`)),
    r.overlaps.map((o) => {
      const other = model?.requests.find((x) => x.id === o.id);
      const shared = (r.scope.scenarios ?? []).filter((n) => (other?.scope.scenarios ?? []).includes(n));
      return h('div', { class: 'warn ov' },
        h('div', { class: 'ovt' }, h('b', null, `#${o.id}`), ' ', o.title, other ? chip(other.turn === 'user' ? 'me' : 'ag', other.stepLabel) : null, h('a', { class: 'lnk', href: hash('manage', String(o.id)) }, '열기 ›')),
        h('div', { class: 'kv' },
          kv('겹치는 곳', [...o.components.map((c) => `컴포넌트 ${c}`), ...o.screens.map((s) => `화면 ${s}`), ...o.infos.map((i) => `정보 ${i}`)].join(', ')),
          kv(`#${r.id}의 일`, r.title), kv(`#${o.id}의 일`, o.title),
          kv('판단', shared.length ? `같은 시나리오(${shared.join(', ')})를 함께 바꿉니다. 먼저 끝낼 요청을 정하세요.` : '시나리오는 서로 다릅니다. 끝나는 순서만 정하면 됩니다.')),
        h('div', { class: 'sp-foot', style: 'margin-top:8px' },
          h('button', { class: 'btn', onclick: () => act('order', { first: r.id, other: o.id }, `#${r.id}을 먼저 끝내도록 정했습니다`, onChange) }, `#${r.id} 먼저`),
          h('button', { class: 'btn', onclick: () => act('order', { first: o.id, other: r.id }, `#${o.id}을 먼저 끝내도록 정했습니다`, onChange) }, `#${o.id} 먼저`)));
    }));
}

/** 요청이 건드리는 시나리오 하나의 요약: 바뀌는 단계, 자리(컴포넌트), 정보 */
function scenarioSummary(model: Model, r: RequestView, sc: Scenario): HTMLElement {
  const picked = new Set((r.scope.steps ?? []).filter((k) => k.startsWith(`${sc.name}#`)).map((k) => k.slice(sc.name.length + 1)));
  const impact = (r.scope.impactOnly ?? []).includes(sc.name);
  const mains = sc.steps.filter((s) => s.main), branches = sc.steps.filter((s) => !s.main);
  const changedMain = mains.filter((s) => picked.has(s.id)), changedBranch = branches.filter((s) => picked.has(s.id));
  const screens = [...new Set(sc.steps.flatMap((s) => s.screens))];
  const comps = [...new Set(sc.steps.filter((s) => (impact || picked.size ? picked.has(s.id) : true)).map((s) => s.owner))];
  const infos = model.infos.filter((i) => (['shown', 'input', 'modify'] as const).some((role) => i.flow[role].some((n) => screens.includes(n)))).map((i) => i.name).slice(0, 6);
  const first = sc.firstScreens[0];
  return h('div', { class: 'box' },
    h('div', { class: 'tsc-h' }, h('b', null, sc.name), impact ? chip('dim', '영향 확인만') : null, h('span', { class: 'grow' }), first ? h('a', { class: 'open', target: '_blank', rel: 'noopener', href: `${location.pathname}${hash('screen', first)}` }, '첫 화면 열기 ↗') : null),
    h('div', { class: 'tagrow' },
      impact ? chip('dim', '영향 확인만 (바꾸지 않음)') : [changedMain.length ? chip('dim', `기본 ${mains.length}단계 중 ${changedMain.map((s) => s.id).join('·')}단계를 바꿈`) : chip('dim', `기본 ${mains.length}단계`), branches.length ? chip('dim', `갈래 ${branches.length}개 중 ${changedBranch.length}개에 영향`) : null]),
    h('div', { class: 'tagrow' }, comps.map((c) => tag('c', c)), infos.map((i) => tag('i', i))));
}

/** 범위: 사용 시나리오 기준(컴포넌트·정보는 코드에서 계산) */
function scopeCard(model: Model, r: RequestView, rich: boolean): HTMLElement {
  const scs = (r.scope.scenarios ?? []).map((n) => model.scenarios.find((s) => s.name === n)).filter((s): s is Scenario => !!s);
  if (rich) return h('div', { class: 'card' }, h('h3', null, '범위 ', h('small', null, '사용 시나리오 기준 — 컴포넌트와 정보는 코드에서 계산됩니다')),
    scs.length ? scs.map((sc) => scenarioSummary(model, r, sc)) : h('div', { class: 'hint' }, '이 요청에 사용 시나리오가 정해지지 않았습니다.'),
    h('div', { class: 'hint' }, `범위 화면: ${r.scope.screens.join(', ') || '없음'} · 범위 정보: ${r.scope.infos.join(', ') || '없음'}`));
  const comps = [...new Set(scs.flatMap((s) => s.steps.map((st) => st.owner)))];
  return h('div', { class: 'card' }, h('h3', null, '이 요청의 범위'),
    h('div', { class: 'kv' }, kv('시나리오', (r.scope.scenarios ?? []).join(', ') || '없음'), kv('컴포넌트', comps.length ? `${comps.join(', ')} (코드에서 계산)` : '없음'), kv('화면', r.scope.screens.join(', ') || '없음'), kv('정보', r.scope.infos.join(', ') || '없음')));
}

/** 설계 승인 칸(사용자만): 확인 두 개를 하면 승인 단추가 켜진다 */
function designApproval(r: RequestView, onChange: () => void): HTMLElement {
  const d = r.design;
  const none = !!d?.none;
  const hasInfo = !!d?.changes.length, hasScreen = !!d?.screens.length;
  const c1 = h('input', { type: 'checkbox', id: 'ck-info' }), c2 = h('input', { type: 'checkbox', id: 'ck-screen' });
  const note = h('textarea', { placeholder: '반려한다면 어디가 다른지 한 줄로 적어 주세요', rows: '3' });
  const ok = h('button', { class: 'btn pri off', disabled: true, onclick: () => act('design-approve', { id: r.id }, none ? '설계 없음으로 승인했습니다' : '설계를 승인했습니다', onChange) }, none ? '설계 없음 승인' : '설계 승인');
  const sync = (): void => { const ready = none || ((!hasInfo || c1.checked) && (!hasScreen || c2.checked)); ok.disabled = !ready; ok.classList.toggle('off', !ready); };
  c1.addEventListener('change', sync); c2.addEventListener('change', sync);
  const check = (id: string, input: HTMLInputElement, text: string): HTMLElement => h('label', { class: 'ck', for: id }, input, h('span', null, text));
  return h('div', { class: 'card approve' }, h('h3', null, none ? '설계 없음 승인' : '설계 승인'),
    h('div', null, none ? '에이전트가 정보도 화면도 바뀌지 않는 요청이라고 올렸습니다. 맞다면 "설계 없음"으로 승인하고 구현으로 넘어갑니다.' : '정보와 화면을 함께 확인하고 한 번에 승인합니다. 승인하기 전에는 구현을 시작하지 않습니다.'),
    none ? null : [hasInfo ? check('ck-info', c1, '정보 변경을 확인했다') : null, hasScreen ? check('ck-screen', c2, '화면 디자인을 확인했다') : null],
    note,
    h('div', { class: 'sp-foot' }, h('button', { class: 'btn bad', onclick: () => act('design-reject', { id: r.id, note: note.value }, '반려했습니다. 에이전트가 설계를 다시 작성합니다', onChange) }, '반려'), ok),
    none ? null : h('div', { class: 'hint' }, '정보도 화면도 바뀌지 않는 요청이면 에이전트가 "설계 없음"으로 올리고, 그때는 "설계 없음 승인"만 누르면 됩니다.'));
}

/** 설계 결과: 정보 변경 칸(바뀌는 정보 상자)과 화면 변경 칸(화면은 그림과 비교 보기 링크) */
function designResult(model: Model, r: RequestView): HTMLElement | null {
  const d = r.design;
  if (!d || d.none) return null;
  const byInfo = [...new Set(d.changes.filter((c) => c.kind !== 'link').map((c) => c.info))];
  const links = d.changes.filter((c) => c.kind === 'link');
  const infoBox = (name: string): HTMLElement => {
    const cs = d.changes.filter((c) => c.info === name && c.kind !== 'link');
    const del = new Set(cs.filter((c) => c.kind === 'remove').map((c) => c.field));
    const base = (model.infos.find((i) => i.name === name)?.props ?? []).map((p) => h('div', { class: `f${del.has(p.name) ? ' del' : ''}` }, p.name));
    return h('div', { class: 'ibox' }, h('b', null, name), base.slice(0, 6), base.length > 6 ? h('div', { class: 'hint' }, `외 ${base.length - 6}개`) : null,
      cs.filter((c) => c.kind === 'add').map((c) => h('div', { class: 'f add' }, `+ ${c.field}`, c.note ? ` — ${c.note}` : '')),
      cs.filter((c) => c.kind === 'change').map((c) => h('div', { class: 'f chg' }, `≈ ${c.field}${c.note ? ` — ${c.note}` : ''}`)));
  };
  return h('div', { class: 'card' }, h('h3', null, '설계 결과 ', h('small', null, `정보 변경 ${d.changes.length}건 · 화면 변경 ${d.screens.length}건 — 한꺼번에 승인합니다`)),
    h('div', { class: 'grid2' },
      byInfo.length || links.length ? h('div', { class: 'box' }, h('div', { class: 'hint' }, `정보 변경 · ${byInfo.join(', ') || '연결'}`), byInfo.map(infoBox),
        links.map((c) => h('div', { class: 'chg link' }, h('span', { class: 'mk' }, '↔'), h('span', null, h('b', null, `연결 · ${c.info} → ${c.field}`), c.note ? ` — ${c.note}` : ''))),
        h('a', { class: 'lnk', href: hash('manage', `${r.id}/info`) }, '정보 변경 겹쳐 보기 ›')) : null,
      d.screens.map((s) => h('div', { class: 'box' }, h('div', { class: 'hint' }, `화면 변경 · ${s.screen}${s.link ? ' (Claude Design)' : ''}`),
        s.after ? h('img', { class: 'shot', src: `/__spec/shots/${s.after}`, alt: `${s.screen} 변경 후` }) : null, s.note ? h('div', null, s.note) : null,
        h('a', { class: 'lnk', href: hash('manage', `${r.id}/compare`, { screen: s.screen }) }, '현행과 비교해서 보기 ›')))));
}

/** 테스트 확인표 한 시나리오: 기본 흐름 단계와, 이번 요청이 바꾼 갈래 단계 */
function testScenario(model: Model, r: RequestView, sc: Scenario, impactOnly: boolean, onChange: () => void): HTMLElement {
  const picked = new Set((r.scope.steps ?? []).filter((k) => k.startsWith(`${sc.name}#`)).map((k) => k.slice(sc.name.length + 1)));
  const mains = sc.steps.filter((s) => s.main && (!impactOnly || picked.has(s.id)));
  const branches = sc.steps.filter((s) => !s.main && picked.has(s.id));
  const checks = r.test?.checks ?? {};
  const stepRow = (st: ScenarioStep): HTMLElement => {
    const key = `${sc.name}#${st.id}`;
    const box = h('input', { type: 'checkbox', checked: checks[key] ? true : null, 'aria-label': st.title, onchange: () => act('test-check', { id: r.id, key, done: box.checked }, '', onChange) });
    return h('label', { class: `tstep${st.main ? '' : ' alt'}` }, box, h('span', null, h('small', null, st.cond ? st.cond : `${st.id}단계`), h('div', null, st.title), st.check ? h('small', null, `확인 기준: ${st.check}`) : null));
  };
  const first = sc.firstScreens[0];
  return h('div', { class: 'tsc' },
    h('div', { class: 'tsc-h' }, h('b', null, sc.name), impactOnly ? h('span', { class: 'chip dim' }, '영향 확인만') : null, h('span', { class: 'grow' }), first ? h('a', { class: 'open', target: '_blank', rel: 'noopener', href: `${location.pathname}${hash('screen', first)}` }, '첫 화면 열기 ↗') : null),
    mains.length ? [h('div', { class: 'hint' }, impactOnly ? '영향 확인 (바꾸지 않음)' : '기본 흐름'), mains.map(stepRow)] : null,
    branches.length ? [h('div', { class: 'hint amberT' }, '갈래 — 이번 요청이 바꾼 것만'), branches.map(stepRow)] : null);
}

/** 테스트 단계 칸: 확인표와 테스트 승인·문제 있음 */
function testCard(model: Model, r: RequestView, onChange: () => void): HTMLElement {
  const names = r.scope.scenarios ?? [];
  const impact = new Set(r.scope.impactOnly ?? []);
  const scs = names.map((n) => model.scenarios.find((s) => s.name === n)).filter((s): s is Scenario => !!s);
  const all = scs.flatMap((sc) => sc.steps.filter((st) => (impact.has(sc.name) ? (r.scope.steps ?? []).includes(`${sc.name}#${st.id}`) : st.main || (r.scope.steps ?? []).includes(`${sc.name}#${st.id}`))).map((st) => `${sc.name}#${st.id}`));
  const checks = r.test?.checks ?? {};
  const done = all.filter((k) => checks[k]).length;
  const ready = r.step === 'requested';
  const ready2 = ready && done === all.length;
  const note = h('textarea', { class: 'hidden', placeholder: '무엇이 문제인지 한 줄로 적어 주세요(같은 요청에서 고칩니다)', rows: '2' });
  return h('div', { class: 'card' }, h('h3', null, '테스트 요청 ', h('small', null, '범위 안의 단계만 보면 됩니다')),
    h('div', { class: 'hint' }, '시나리오 이름 옆 "첫 화면 열기"를 누르면 그 시나리오의 첫 단계가 있는 화면이 새 창으로 열립니다. 아래 순서대로 눌러 보고 확인 기준에 맞으면 체크하세요.'),
    scs.length ? scs.map((sc) => testScenario(model, r, sc, impact.has(sc.name), onChange)) : h('div', { class: 'hint' }, '이 요청에 사용 시나리오가 정해지지 않아 확인표가 없습니다. 에이전트에게 범위를 정해 달라고 하거나, 아래에서 "테스트 없음"으로 승인할 수 있습니다.'),
    scs.length ? h('div', { class: 'hint' }, `확인 ${done} / ${all.length}`) : null,
    note,
    ready ? h('div', { class: 'sp-foot' },
      h('button', { class: `btn ok${ready2 ? '' : ' off'}`, disabled: !ready2, onclick: () => act('test-approve', { id: r.id, none: false }, '테스트를 승인했습니다', onChange) }, '테스트 승인'),
      h('button', { class: 'btn bad', onclick: () => { if (note.classList.contains('hidden')) { note.classList.remove('hidden'); note.focus(); return; } act('test-problem', { id: r.id, note: note.value }, '문제 있음으로 알렸습니다. 같은 요청에서 고칩니다', onChange); } }, '문제 있음'),
      scs.length ? null : h('button', { class: 'btn', onclick: () => act('test-approve', { id: r.id, none: true }, '테스트 없음으로 승인했습니다', onChange) }, '테스트 없음 승인')) : h('div', { class: 'hint' }, r.stage === 'test' ? '에이전트가 고치는 중입니다. 다시 테스트를 올리면 여기서 확인합니다.' : ''),
    r.test?.found.length ? h('div', { class: 'box dash2' }, h('b', null, `범위 밖에서 발견된 것 ${r.test.found.length}건`), h('span', { class: 'hint' }, ' 이번 테스트를 막지 않음. 리포트로 올렸으니 필요할 때 요청으로 등록하세요.'), r.test.found.map((f) => h('div', null, f.text))) : null);
}

/**
 * @screen 요청 상세
 * @route /__spec/#/manage/:id
 * @domain 관리
 * @why 요청 하나의 원문, 설계, 범위, 겹침, 진행 기록을 한 화면에 모으고, 설계와 테스트를 승인·반려하게 한다.
 * @to 요청 목록 | 위쪽 "요청"을 누른다
 * @to 정보 변경 겹쳐 보기 | "정보 변경 겹쳐 보기"를 누른다 | 요청 번호
 * @to 화면 변경 전후 비교 | "현행과 비교해서 보기"를 누른다 | 요청 번호
 * @to 화면 설계서 | 테스트 확인표의 "첫 화면 열기"를 누른다 | 화면 이름
 * @does 요청의 원문, 범위, 겹침, 진행 기록을 읽는다 | 한 화면에 모여 보인다 | 요청의 진행을 확인한다#3 | → 3b, 3c
 * @does 위쪽 "요청"을 눌러 목록으로 돌아간다 | 요청 목록이 열린다 | 요청의 진행을 확인한다#3b | → 1 | 목록으로 돌아가려면
 * @does 겹치는 다른 요청을 열어 본다 | 그 요청의 상세가 열린다 | 요청의 진행을 확인한다#3c | → 3 | 겹치는 요청이 있으면
 */
export function manageDetail(root: HTMLElement, { model, id, sub, onChange }: { model: Model; id: string; sub: string; onChange: () => void }): void {
  const r = model.requests.find((x) => String(x.id) === String(id));
  if (!r) { root.append(h('div', { class: 'empty-note', style: 'flex:1' }, `요청 #${id}을 찾지 못했다`)); return; }
  if (sub === 'info') { manageInfoOverlay(root, { model, r }); return; }
  if (sub === 'compare') { manageCompare(root, { r, screen: new URLSearchParams(location.hash.split('?')[1] ?? '').get('screen') || '' }); return; }
  const d = r.design;
  const testing = r.stage === 'test' || r.stage === 'done';
  const head = pageHead({ crumb: [h('a', { href: hash('manage') }, '요청'), ` › #${r.id}`], title: r.title, meta: [chipFor(r), scopeTags(r), h('span', null, `${r.source === 'user' ? '사용자 요청' : '에이전트 발견'} · ${r.origin.channel} · ${fmt(r.origin.at)}`)] });
  const agent = h('div', { class: 'card' }, h('h3', null, '맡은 에이전트 ', h('small', null, '이 요청만 알고 일하는 에이전트입니다. 직접 대화할 수 있습니다')),
    r.agent.name ? h('div', { class: 'rm' }, chip('ag', r.agent.name), h('span', { class: 'hint' }, r.events.length ? `마지막 기록 ${fmt(r.events[r.events.length - 1].at)}` : ''), h('span', { class: 'hint' }, '들어가기'), h('span', { class: 'code' }, `claude attach ${r.agent.name}`), h('button', { class: 'btn sm', onclick: () => { void copyText(`claude attach ${r.agent.name}`).then(() => toast('복사했습니다')); } }, '복사'), h('span', { class: 'hint' }, `VS Code는 세션 목록에서 "${r.agent.name}"`))
      : h('div', { class: 'hint' }, '아직 정해지지 않았습니다. 에이전트가 이 요청을 맡으면 이름이 여기에 나옵니다.'));
  const left = [
    h('div', { class: 'card' }, stepperBig(r)),
    agent,
    r.origin.text ? h('div', { class: 'card' }, h('h3', null, '요청 원문'), h('div', { class: 'quote' }, r.origin.text)) : null,
    d && !d.none ? h('div', { class: 'card' }, h('h3', null, '에이전트의 이해와 처리 방법'), h('div', { class: 'grid2' },
      h('div', { class: 'box' }, h('b', null, '이렇게 이해했습니다'), h('div', null, d.understanding)),
      h('div', { class: 'box' }, h('b', null, '이렇게 처리하겠습니다'), h('div', null, d.approach)))) : null,
    designResult(model, r),
    h('div', { class: 'card' }, h('h3', null, '진행 기록'), h('div', { class: 'tl' }, r.events.map((e) => h('div', null, h('i'), h('span', null, h('b', null, e.note || e.kind), ` · ${e.by === 'user' ? '사용자' : '에이전트'} · ${fmt(e.at)}`))))),
  ];
  const designSide = r.stage === 'design' && r.step === 'submitted' ? designApproval(r, onChange)
    : r.stage === 'design' ? h('div', { class: 'card' }, h('h3', null, r.step === 'revise' ? '설계 다시 작성 중' : '설계 작성 중'), h('div', { class: 'hint' }, r.step === 'revise' ? '반려한 내용을 고쳐 다시 올리는 중입니다.' : '에이전트가 설계를 작성하고 있습니다. 올리면 여기서 승인하거나 반려합니다.')) : null;
  // 테스트 단계에서는 범위와 겹침을 왼쪽에, 확인표를 오른쪽에 둔다(범위를 보며 확인표를 따라가게)
  const [leftAll, right] = testing
    ? [[left[0], scopeCard(model, r, true), overlapCard(r, onChange, model), ...left.slice(1)], [testCard(model, r, onChange)]]
    : [left, [designSide, scopeCard(model, r, false), overlapCard(r, onChange, model)]];
  root.append(withPanel(h('div', { class: 'wrap' }, head, h('div', { class: 'dcol' }, leftAll)),
    sidePanel({ title: testing ? '사용 시나리오 테스트' : `요청 #${r.id}`, fold: 'request', body: right })));
}
