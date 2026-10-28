/**
 * @spec manage-detail-view 요청 상세 화면
 * @why 요청 하나의 원문, 에이전트의 설계, 범위, 겹침, 진행 기록을 한 화면에 모아 "왜 이 일이 있고 어디까지 왔나"를 따라가게 한다. 설계 단계에서는 설계를 승인·반려하고, 테스트 단계에서는 사용 시나리오 확인표로 테스트를 승인한다. 승인은 사용자만 한다.
 * @contract model.requests의 항목 모양(types.ts의 RequestView)에 기대어 그린다. 승인·반려·순서·체크는 서버의 /__spec/request/*로 보낸 뒤 onChange로 화면을 다시 그린다.
 */
import { h, get, post, pageHead, chip, tag, fmt, toast, errorText, copyText, sidePanel } from './util.js';
import type { Kid } from './util.js';
import { hash, liveAt } from './route.js';
import { stepperBig, noteBoxes, chipFor, scopeTags, withPanel, lightbox, currentDesignApproval, deliveryCard, unread } from './manage-parts.js';
import { manageInfoOverlay, manageCompare } from './manage-views.js';
import { basket, sendBasket } from './comment-basket.js';
import type { Model, RequestView, Scenario, ScenarioStep } from '../types.js';

/** 담당 세션의 워크트리 추적: 작업 폴더·브랜치·main보다 앞선 커밋·저장 안 한 변경·합쳐졌는지(워크트리를 쓰지 않으면 그렇다고 알린다) */
function worktreeBox(r: RequestView): HTMLElement {
  const w = r.worktree;
  if (!w) return h('div', { class: 'box' }, h('b', null, '워크트리 추적'), h('div', { class: 'hint' }, '워크트리 없음 · 이 담당은 main 폴더에서 일합니다'));
  const item = (k: string, v: string): HTMLElement => h('span', null, h('span', { class: 'hint' }, `${k} `), v);
  return h('div', { class: 'box' }, h('b', null, '워크트리 추적'),
    h('div', { class: 'rm', style: 'gap:18px' }, item('작업 폴더', w.exists ? w.path : `${w.path}(폴더가 없음)`), item('브랜치', w.branch)),
    h('div', { class: 'rm', style: 'gap:18px' }, item('main보다 앞선 커밋', `${w.ahead}개`), item('저장 안 한 변경', w.dirty ? `${w.dirty}개 파일` : '없음'), item('main에 합쳐졌나', w.merged ? '합쳐짐' : '아직 · 테스트 승인 뒤 합침')));
}

/** 서버에 결정을 보내고 성공하면 화면을 다시 그린다 */
function act(path: string, body: Record<string, unknown>, done: string, onChange: () => void): void {
  post(`/__spec/request/${path}`, body).then(() => { toast(done); onChange(); }).catch((e: unknown) => toast(errorText(e)));
}
/** 담당 세션의 지난 대화를 읽기만 해서 보여 준다(세션에 접속하지 않으니 일하는 세션이 멈추지 않는다). 누를 때 읽는다 */
function conversationBox(id: number): HTMLElement {
  // 대화는 오래된 것부터 줄줄이 이어져 수백 줄이 되므로, 정해진 높이 안에서 넘겨 보게 하고 열면 가장 최근(맨 아래)이 보이게 한다
  const body = h('div', { class: 'tabcol', style: 'max-height:520px;overflow:auto' });
  let loaded = false;
  const show = (): void => {
    if (loaded) return;
    loaded = true; body.append(h('div', { class: 'hint' }, '읽는 중…'));
    get<{ sid: string; turns: { role: string; at: string; text: string }[]; total: number }[]>(`/__spec/request/conversation.json?id=${id}`).then((list) => {
      body.replaceChildren(...(list.length ? list : []).flatMap((c) => [
        h('div', { class: 'hint' }, `세션 ${c.sid.slice(0, 8)} · 대화 ${c.total}줄${c.total > c.turns.length ? ` 중 마지막 ${c.turns.length}줄` : ''}`),
        ...(c.turns.length ? c.turns.map((t) => h('div', { class: t.role === 'tool' ? 'hint' : 'quote' }, h('b', null, `${t.role === 'user' ? '받은 글' : t.role === 'agent' ? '에이전트' : '도구'} · ${t.at ? fmt(t.at) : ''} `), t.text)) : [h('div', { class: 'hint' }, '남은 대화 기록이 없습니다.')]),
      ]), ...(list.length ? [] : [h('div', { class: 'hint' }, '담당 세션이 아직 없습니다.')]));
      body.scrollTop = body.scrollHeight;
    }).catch((e: unknown) => { loaded = false; body.replaceChildren(h('div', { class: 'hint' }, errorText(e))); });
  };
  return h('details', { class: 'box', ontoggle: show }, h('summary', null, h('b', null, '대화 보기'), ' · 담당 세션이 지금까지 한 일(읽기만 하며 일을 멈추지 않습니다)'), body);
}
/** 칸을 사용자가 눌러 바꾼 펼침 상태("요청:칸" → 펼침). 화면이 다시 그려져도 유지한다 */
const FOLD = new Map<string, boolean>();
const kv = (k: string, v: Kid): Kid[] => [h('span', null, k), h('span', null, v)];

/** 겹치는 요청 칸의 속: 겹치는 곳, 각자 하는 일, 판단과 순서 정하기 단추 */
function overlapBody(r: RequestView, onChange: () => void, model?: Model): Kid {
  if (!r.overlaps.length) return h('div', { class: 'hint' }, '겹치는 요청이 없습니다.');
  return r.overlaps.map((o) => {
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
    });
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

/** 범위 칸의 속: 사용 시나리오 기준(컴포넌트·정보는 코드에서 계산) */
function scopeBody(model: Model, r: RequestView): Kid {
  const scs = (r.scope.scenarios ?? []).map((n) => model.scenarios.find((s) => s.name === n)).filter((s): s is Scenario => !!s);
  return [scs.length ? scs.map((sc) => scenarioSummary(model, r, sc)) : h('div', { class: 'hint' }, '이 요청에 사용 시나리오가 정해지지 않았습니다.'),
    h('div', { class: 'hint' }, `범위 화면: ${r.scope.screens.join(', ') || '없음'} · 범위 정보: ${r.scope.infos.join(', ') || '없음'}`)];
}

/** 설계 승인 칸(사용자만): 확인 두 개를 하면 승인 단추가 켜진다 */
function lastRejection(r: RequestView): HTMLElement | null {
  const e = [...r.events].reverse().find((x) => x.kind === 'design-rejected');
  if (!e) return null;
  const n = r.design?.rejected;
  return h('div', { class: 'box', style: 'margin-top:10px' },
    h('div', { class: 'hint' }, `가장 최근 반려 · ${e.by === 'user' ? '사용자' : '에이전트'} · ${fmt(e.at)}${n ? ` (${n}번째)` : ''}`),
    h('div', { class: 'quote' }, (e.note ?? '').replace(/^설계 반려:\s*/, '') || '(사유 없음)'));
}

/** 테스트 패널 맨 위 안내: 이 테스트가 테스트 데이터로 한다는 것을 눌러 보기 전에 보이게 한다(테스트 환경이 설정된 프로젝트만) */
function testDataNotice(model: Model): HTMLElement | null {
  return model.reviewFrame ? h('div', { class: 'td-notice' }, h('b', null, '⚠ 이 테스트는 테스트 데이터로 합니다'), h('div', null, '운영 데이터가 아닙니다. 아래 "테스트 데이터로 첫 화면 열기"는 테스트 데이터로 뜬 화면을 엽니다.')) : null;
}

/** 시나리오의 첫 화면 주소: 운영 설계서 보기의 화면 설계서(테스트 경로). 테스트 환경이 있으면 그 안쪽 실제 화면만 테스트 서버 화면으로 뜬다 */
function firstScreenHref(model: Model, r: RequestView, screen: string, sc: Scenario, step: string | undefined): string {
  return `${location.pathname}${hash('screen', screen, { tr: String(r.id), ts: sc.name, tn: step, at: liveAt(model, screen, r.id) })}`;
}

/** 구현·테스트 중 설계 변경이 필요할 때 쓰는 칸: 변경사항을 적고 "설계 변경"을 누르면 확인 창이 단계가 바뀐다고 알린 뒤 설계 단계로 돌린다(허락은 필요 없다) */
function redesignCard(r: RequestView, onChange: () => void): HTMLElement | null {
  if (r.stage !== 'impl' && r.stage !== 'test') return null;
  const why = h('textarea', { placeholder: '변경사항을 적어주세요', rows: '3' });
  const confirmDialog = (text: string): void => {
    const close = (): void => { document.removeEventListener('keydown', onKey); veil.remove(); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    const veil = h('div', { class: 'rd-veil', onclick: (e) => { if (e.target === veil) close(); } }, h('div', { class: 'rd-box' },
      h('b', null, `${STAGE_LABEL_UI[r.stage] ?? '지금'} 단계가 설계 단계로 바뀝니다`),
      h('div', null, '테스트는 멈추고, 에이전트가 설계를 고쳐 올리면 다시 승인해야 합니다. 설계 승인 전에는 소스 커밋도 막힙니다.'),
      h('div', { class: 'hint' }, `변경사항: ${text}`),
      h('div', { class: 'rd-btns' }, h('button', { class: 'btn', onclick: close }, '취소'),
        h('button', { class: 'btn pri', onclick: () => { close(); act('redesign', { id: r.id, reason: text }, '설계 단계로 돌렸습니다. 에이전트가 설계를 고쳐 다시 올립니다', onChange); } }, '설계 변경'))));
    document.addEventListener('keydown', onKey);
    document.body.append(veil);
  };
  const go = (): void => { const t = why.value.trim(); if (!t) { toast('변경사항을 적어주세요'); why.focus(); return; } confirmDialog(t); };
  return h('div', { class: 'card' }, h('div', { class: 'hint' }, '설계를 바꿔야 한다면'), why,
    h('button', { class: 'btn', style: 'margin-top:8px;width:100%', onclick: go }, '설계 변경'),
    r.redesigns ? h('div', { class: 'hint' }, `지금까지 설계 변경 ${r.redesigns}회`) : null);
}
/** 확인 창 제목에 쓰는 단계 이름 */
const STAGE_LABEL_UI: Record<string, string> = { impl: '구현', test: '테스트' };

/** 설계 변경으로 바뀌기 전의 설계들: 이전 판을 지우지 않고 보여 준다(변경사항·승인 시각·이해한 내용·항목·시안) */
function designVersionsBox(r: RequestView): HTMLElement | null {
  const vs = r.designVersions ?? [];
  if (!vs.length) return null;
  return h('div', { class: 'dver' }, h('div', { class: 'hint' }, `이전 설계 ${vs.length}개 — 설계 변경으로 바뀌었고 기록으로 남아 있습니다`),
    vs.map((v, i) => h('details', { class: 'box' },
      h('summary', null, h('b', null, `설계 ${i + 1}판`), ` · ${v.approvedAt ? `${fmt(v.approvedAt)} 승인됨` : '승인 전에 바뀜'} · ${fmt(v.replacedAt)} ${v.by === 'user' ? '사용자' : '에이전트'}가 설계 변경 요청`),
      h('div', { class: 'hint' }, `변경사항: ${v.reason}`),
      v.design.understanding ? h('div', { class: 'quote' }, v.design.understanding) : null,
      (v.design.points ?? []).map((p) => h('div', null, h('b', null, `${p.area}: `), p.title)),
      v.design.screens.map((sc) => sc.after ? h('div', null, h('div', { class: 'hint' }, `${sc.screen} 시안`), h('img', { class: 'shot zoomable', src: `/__spec/shots/${sc.after}`, alt: `${sc.screen} 시안` })) : null))));
}

/** 구현하다 막혀서 같이 고친 일 목록(없으면 null). 구현 칸과 테스트 확인에서 같은 모양으로 보인다 */
function alsoFixedBox(r: RequestView, hint: boolean): HTMLElement | null {
  const a = r.alsoFixed ?? [];
  if (!a.length) return null;
  return h('div', { class: 'box dash2' }, h('b', null, `구현하다 막혀서 함께 고친 것 ${a.length}건`), hint ? h('span', { class: 'hint' }, ' 이 요청의 테스트에 영향을 줍니다. 기능과 같이 확인하세요.') : null,
    a.map((x) => h('div', { style: 'margin-top:6px' }, x.text, h('div', { class: 'hint' }, `${[x.where && `고친 곳: ${x.where}`, fmt(x.at), x.commit && `커밋 ${x.commit}`].filter(Boolean).join(' · ')}`))));
}

function designApproval(r: RequestView, onChange: () => void, td = false): HTMLElement {
  const d = r.design;
  const none = !!d?.none;
  const hasInfo = !!d?.changes.length, hasScreen = !!d?.screens.length;
  const c1 = h('input', { type: 'checkbox', id: 'ck-info' }), c2 = h('input', { type: 'checkbox', id: 'ck-screen' });
  const note = h('textarea', { placeholder: '반려한다면 어디가 다른지 한 줄로 적어 주세요', rows: '3' });
  const ok = h('button', { class: 'btn pri off', disabled: true, onclick: () => act('design-approve', { id: r.id }, none ? '설계 없음으로 승인했습니다' : '설계를 승인했습니다', onChange) }, none ? '설계 없음 승인' : '설계 승인');
  const sync = (): void => { const ready = none || ((!hasInfo || c1.checked) && (!hasScreen || c2.checked)); ok.disabled = !ready; ok.classList.toggle('off', !ready); };
  c1.addEventListener('change', sync); c2.addEventListener('change', sync);
  sync(); // 처음 한 번도 계산한다: 설계 없음은 확인 상자가 없어 계산이 안 돌면 단추가 꺼진 채 남는다
  const check = (id: string, input: HTMLInputElement, text: string): HTMLElement => h('label', { class: 'ck', for: id }, input, h('span', null, text));
  return h('div', { class: 'card approve' }, h('h3', null, none ? '설계 없음 승인' : '설계 승인'),
    h('div', null, none ? '에이전트가 정보도 화면도 바뀌지 않는 요청이라고 올렸습니다. 맞다면 "설계 없음"으로 승인하고 구현으로 넘어갑니다.' : '정보와 화면을 함께 확인하고 한 번에 승인합니다. 승인하기 전에는 구현을 시작하지 않습니다.'),
    none ? null : [hasInfo ? check('ck-info', c1, '정보 변경을 확인했다') : null, hasScreen ? check('ck-screen', c2, '화면 디자인을 확인했다') : null],
    td ? null : note,
    td ? h('div', { class: 'hint' }, '테스트 데이터 서버의 복사본이라 승인·반려는 운영 요청 상세에서 합니다.') : h('div', { class: 'sp-foot' }, h('button', { class: 'btn bad', onclick: () => act('design-reject', { id: r.id, note: note.value }, '반려했습니다. 에이전트가 설계를 다시 작성합니다', onChange) }, '반려'), ok),
    none ? null : h('div', { class: 'hint' }, '정보도 화면도 바뀌지 않는 요청이면 에이전트가 "설계 없음"으로 올리고, 그때는 "설계 없음 승인"만 누르면 됩니다.'));
}

/** 정보 변경을 정보(테이블) 하나에 한 줄로 요약한 칸 하나: 바뀐 정도와 더해지거나 바뀌는 칸 이름만 보이고, 자세한 것은 겹쳐 보기에서 본다 */
function infoSummary(model: Model, r: RequestView): HTMLElement | null {
  const d = r.design;
  if (!d || !d.changes.length) return null;
  const names = [...new Set(d.changes.map((c) => c.info))];
  const rows = names.map((name) => {
    const cs = d.changes.filter((c) => c.info === name);
    const isNew = !model.infos.some((i) => i.name === name);
    const add = cs.filter((c) => c.kind === 'add'), chg = cs.filter((c) => c.kind === 'change'), del = cs.filter((c) => c.kind === 'remove'), lnk = cs.filter((c) => c.kind === 'link');
    const sum = [add.length ? (isNew ? `새 정보 · ${add.length}칸` : `칸 ${add.length}개 더함`) : '', chg.length ? `칸 ${chg.length}개 바뀜` : '', del.length ? `칸 ${del.length}개 뺌` : ''].filter(Boolean).join(' · ') || (lnk.length ? '연결만 바뀜' : '');
    const mark = (c: { kind: string; field: string }, m: string, cls: string): HTMLElement => h('span', { class: `isum-tag ${cls}` }, `${m} ${c.field}`);
    return h('div', { class: 'isum-row' }, h('b', null, name), h('b', { class: 'isum-sum' }, sum),
      h('span', { class: 'isum-tags' }, add.map((c) => mark(c, '+', 'add')), chg.map((c) => mark(c, '≈', 'chg')), del.map((c) => mark(c, '−', 'del')), lnk.map((c) => mark(c, '↔', 'lnk'))));
  });
  return h('div', { class: 'box isum' }, h('div', { class: 'hint' }, `정보 변경 · ${names.length}개 정보`), rows,
    h('div', { class: 'isum-foot' }, h('span', { class: 'hint' }, '+ 더함 · ≈ 바뀜 · − 뺌 · ↔ 연결'), h('a', { class: 'lnk', href: hash('manage', `${r.id}/info`) }, '정보 변경 겹쳐 보기에서 자세히 ›')));
}

/** 설계 결과: 정보 변경은 한 칸 요약, 화면 변경은 화면마다 한 칸(그림을 누르면 원본 크기, 달라진 곳은 상자) */
function designResult(model: Model, r: RequestView): HTMLElement | null {
  const d = r.design;
  if (!d || d.none) return null;
  const screenBox = (s: NonNullable<RequestView['design']>['screens'][number]): HTMLElement => {
    const wrap = h('div', { class: 'shot-wrap' });
    if (s.after) {
      wrap.append(h('img', { class: 'shot zoomable', src: `/__spec/shots/${s.after}`, alt: `${s.screen} 시안`, title: '누르면 원본 크기로 봅니다', onclick: () => lightbox(s.screen, s.after, s.before) }));
      for (const hl of s.highlights ?? []) wrap.append(h('div', { class: 'hl', style: `left:${hl.l}%;top:${hl.t}%;width:${hl.w}%;height:${hl.h}%` }, h('span', null, hl.label)));
    }
    const source = s.isNew ? chip('ag', '신규 화면 · 현행 없음')
      : s.beforeSource === 'tool' ? chip('ok', `현행: 운영 화면 그대로${s.capturedAt ? ` · ${fmt(s.capturedAt)} 촬영` : ''}`)
      : s.beforeSource === 'manual' ? chip('bad', '손으로 올림 · 현행이 아닐 수 있음') : null;
    return h('div', { class: 'box' }, h('div', { class: 'hint' }, `화면 변경 · ${s.screen}${s.link ? ' (Claude Design)' : ''}`),
      wrap, h('div', { class: 'shot-src' }, source, s.after ? h('span', { class: 'hint' }, s.highlights?.length ? '그림을 누르면 원본 크기 · 초록 상자는 현행과 달라진 곳' : '그림을 누르면 원본 크기') : null),
      s.note ? h('div', null, s.note) : null,
      !s.isNew && s.before ? h('a', { class: 'lnk', href: hash('manage', `${r.id}/compare`, { screen: s.screen }) }, '현행과 비교해서 보기 ›') : null);
  };
  return h('div', { class: 'dres' }, h('div', { class: 'hint' }, `설계 결과 · 정보 변경 ${d.changes.length}건 · 화면 변경 ${d.screens.length}건 — 한꺼번에 승인합니다`),
    infoSummary(model, r), h('div', { class: 'grid2' }, d.screens.map(screenBox)));
}

/** 설계 글: "이렇게 이해했습니다" 한 줄 요약과 영역별 표(영역·바뀌는 것·설명). 영역별 항목이 없는 옛 설계는 글만 보인다. "이렇게 처리하겠습니다"는 정보·화면 변경이 없는 요청에서만 보이고, 설계 없음이어도 영역별 항목을 적었으면 표로 보인다 */
function designText(d: NonNullable<RequestView['design']>): Kid {
  const approach = d.none && d.approach ? h('div', { class: 'box' }, h('b', null, '이렇게 처리하겠습니다'), h('div', null, d.approach)) : null;
  if (d.none && !d.points?.length) return h('div', { class: 'grid2' }, h('div', { class: 'box' }, h('b', null, '이렇게 이해했습니다'), h('div', null, d.understanding)), approach);
  const areas = (d.points ?? []).map((p) => p.area);
  const table = h('div', { class: 'box dpts' }, h('b', null, '이렇게 이해했습니다'), h('div', { class: 'dpts-sum' }, d.understanding),
    d.points?.length ? h('table', { class: 'dpts-tbl' }, h('thead', null, h('tr', null, h('th', null, '영역'), h('th', null, '바뀌는 것'), h('th', null, '설명'))),
      h('tbody', null, d.points.map((p, i) => h('tr', { class: areas.indexOf(p.area) === i ? 'first' : '' }, h('td', { class: 'dpts-area' }, areas.indexOf(p.area) === i ? p.area : ''), h('td', { class: 'dpts-t' }, p.title), h('td', null, p.text))))) : null);
  return approach ? h('div', null, table, approach) : table;
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
  // 첫 화면은 테스트 경로로 열린다: 그 창의 오른쪽 코멘트 창에 단계 목록·코멘트 담기·승인·반려가 붙는다
  const firstStep = (mains[0] ?? branches[0])?.id;
  return h('div', { class: 'tsc' },
    h('div', { class: 'tsc-h' }, h('b', null, sc.name), impactOnly ? h('span', { class: 'chip dim' }, '영향 확인만') : null, h('span', { class: 'grow' }), first ? h('a', { class: `open${model.reviewFrame ? ' td' : ''}`, target: '_blank', rel: 'noopener', href: firstScreenHref(model, r, first, sc, firstStep) }, model.reviewFrame ? '테스트 데이터로 첫 화면 열기 ↗' : '첫 화면 열기 ↗') : null),
    mains.length ? [h('div', { class: 'hint' }, impactOnly ? '영향 확인 (바꾸지 않음)' : '기본 흐름'), mains.map(stepRow)] : null,
    branches.length ? [h('div', { class: 'hint amberT' }, '갈래 — 이번 요청이 바꾼 것만'), branches.map(stepRow)] : null);
}

/** 테스트 단계 칸: 확인표와 테스트 승인·반려 */
function testCard(model: Model, r: RequestView, onChange: () => void, td = false): HTMLElement {
  const names = r.scope.scenarios ?? [];
  const impact = new Set(r.scope.impactOnly ?? []);
  const scs = names.map((n) => model.scenarios.find((s) => s.name === n)).filter((s): s is Scenario => !!s);
  const all = scs.flatMap((sc) => sc.steps.filter((st) => (impact.has(sc.name) ? (r.scope.steps ?? []).includes(`${sc.name}#${st.id}`) : st.main || (r.scope.steps ?? []).includes(`${sc.name}#${st.id}`))).map((st) => `${sc.name}#${st.id}`));
  const checks = r.test?.checks ?? {};
  const done = all.filter((k) => checks[k]).length;
  const ready = r.step === 'requested';
  const ready2 = ready && done === all.length;
  const note = h('textarea', { class: 'hidden', placeholder: '담은 코멘트가 없으면 무엇이 문제인지 한 줄로 적어 주세요(같은 요청에서 고칩니다)', rows: '2' });
  const stashed = basket().length;
  /** 화면은 없고 등록할 때 "테스트 없음" 이유를 적은 요청: 확인표 대신 그 이유를 보이고 승인 하나로 끝낸다 */
  const noTestOnly = !scs.length && !r.scope.screens.length;
  const reject = (): void => {
    if (!stashed && note.classList.contains('hidden')) { note.classList.remove('hidden'); note.focus(); return; }
    sendBasket({ request: r.id, note: stashed ? '' : note.value }).then(() => { toast('한번에 보내고 반려했습니다. 같은 요청에서 고칩니다'); onChange(); }).catch((e: unknown) => toast(errorText(e)));
  };
  return h('div', { class: 'card' }, h('h3', null, '테스트 요청 ', h('small', null, '범위 안의 단계만 보면 됩니다')),
    alsoFixedBox(r, true),
    scs.length ? h('div', { class: 'hint' }, '시나리오 이름 옆 "첫 화면 열기"를 누르면 그 시나리오의 첫 화면이 새 창으로 열리고, 그 창의 오른쪽 코멘트 창에서 단계를 따라가며 코멘트를 담습니다. 다 본 뒤 거기서 "한번에 보내기(반려)"나 "승인"으로 끝내도 됩니다. 아래 순서대로 눌러 보고 확인 기준에 맞으면 체크하세요.') : null,
    scs.length ? scs.map((sc) => testScenario(model, r, sc, impact.has(sc.name), onChange))
      : noTestOnly ? h('div', { class: 'box' }, h('b', null, '테스트 없음'), h('div', null, r.noTest || '등록할 때 적은 이유가 없습니다(화면이 없는 요청).'))
      : h('div', { class: 'hint' }, '범위에 화면이 있는데 사용 시나리오가 없습니다. 시나리오가 있어야 테스트를 확인할 수 있어, 에이전트가 시나리오를 올려 범위에 연결하기 전에는 승인할 수 없습니다.'),
    scs.length ? h('div', { class: 'hint' }, `확인 ${done} / ${all.length}`) : null,
    stashed ? h('div', { class: 'hint' }, `담아 둔 코멘트 ${stashed}건이 있습니다. "한번에 보내기(반려)"로 모두 함께 보냅니다.`) : null,
    td ? null : note,
    td ? h('div', { class: 'hint' }, '테스트 데이터 서버의 복사본이라 승인·반려는 운영 요청 상세에서 합니다.') : ready ? h('div', { class: 'sp-foot' },
      scs.length ? h('button', { class: `btn ok${ready2 ? '' : ' off'}`, disabled: !ready2, onclick: () => act('test-approve', { id: r.id, none: false }, '테스트를 승인했습니다', onChange) }, '테스트 승인') : null,
      noTestOnly ? h('button', { class: 'btn ok', onclick: () => act('test-approve', { id: r.id, none: true }, '테스트 없음으로 승인했습니다', onChange) }, '테스트 없음 승인') : null,
      h('button', { class: 'btn bad', onclick: reject }, stashed ? `한번에 보내기(반려) ${stashed}` : '반려')) : h('div', { class: 'hint' }, r.stage === 'test' ? '에이전트가 고치는 중입니다. 다시 테스트를 올리면 여기서 확인합니다.' : ''),
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
 * @does 요청 상세를 아래로 스크롤한다 | 맨 위 요청 제목이 화면 위에 붙어 계속 보인다 | 긴 화면을 스크롤해도 제목·거르기·닫기가 보인다#2 | → 3
 * @does 위쪽 "요청"을 눌러 목록으로 돌아간다 | 요청 목록이 열리고, 목록에서 보던 거르기(예: 테스트 칩)가 그대로 남아 있다 | 요청의 진행을 확인한다#3b | → 1 | 목록으로 돌아가려면
 * @does 겹치는 다른 요청을 열어 본다 | 그 요청의 상세가 열린다 | 요청의 진행을 확인한다#3c | → 3 | 겹치는 요청이 있으면
 * @does 질문 중·막힘인 요청의 상세를 연다 | 제목 바로 아래에 아래 요소들과 같은 가로 100% 폭의 질문 중·막힘 상자가 각각 보이고, 다음 기록이 생기면 사라진다 | 담당 세션의 질문과 막힘을 확인한다#2 | → 3
 * @does 멈춘 듯한 요청을 열어 오른쪽 패널의 카드를 보고 "지금 다시 보내기"를 누른다 | 붉은 "담당 세션이 멈춘 듯합니다" 카드가 보이고, 누르면 담당 세션에 결정을 다시 보낸다 | 멈춘 담당 세션을 알아챈다#2
 * @does 전달 안 됨인 요청을 열어 오른쪽 패널의 전달 카드를 보고 "지금 다시 보내기"를 누른다 | 눌림→보냄→읽음→반영 네 칸과 몇 분째 안 읽는지가 빨간 카드로 보이고, 누르면 담당 세션에 결정을 다시 보낸다 | 결정이 담당 세션에 전달됐는지 확인한다#2
 * @does 담당이 있는 요청의 상세를 열어 맡은 에이전트 칸을 본다 | 복사할 수 있는 들어가기 명령과 워크트리 추적(작업 폴더·브랜치·main보다 앞선 커밋·저장 안 한 변경·합쳐짐)이 보인다 | 담당 세션을 터미널로 연다#1
 * @does 같은 파일을 건드리는 다른 진행 중 요청이 있는 요청의 상세를 연다 | 맡은 에이전트 칸 위에 어느 요청과 어느 파일이 겹치는지 경고 띠가 보인다 | 담당 세션을 터미널로 연다#2
 * @does 접수된 요청의 "시작"을 누른다 | 설계 작성 중으로 바뀌고 요청을 맡을 담당 세션이 새로 만들어진다 | 요청을 시작하고 설계를 승인한다#1 | → 2
 * @does 올라온 설계(정보 변경 요약·화면 시안)를 읽고 승인하거나 반려한다 | 승인하면 구현으로, 반려하면 설계 다시 작성 중으로 넘어간다 | 요청을 시작하고 설계를 승인한다#2
 * @does 반려해서 설계 다시 작성 중인 요청의 오른쪽 패널을 본다 | 가장 최근 반려의 사유·시각·몇 번째인지가 보인다 | 반려한 사유를 다시 쓰는 동안 확인한다#1
 * @does 함께 고친 것이 남은 요청의 구현 칸과 테스트 요청 카드를 본다 | 구현 칸에 "함께 고친 것 N건"이 보이고 테스트 요청 카드에 같은 목록이 점선 상자로 보인다 | 구현하다 막혀 함께 고친 것을 확인한다#1
 * @does 테스트 승인 대기인 요청을 열어 오른쪽 "사용 시나리오 테스트" 패널을 본다 | 맨 위에 "이 테스트는 테스트 데이터로 합니다 · 운영 데이터가 아닙니다" 안내가 보이고 시나리오 옆 단추가 "테스트 데이터로 첫 화면 열기"로 나온다 | 눌러 보기 전에 테스트 데이터로 한다는 것을 안다#1
 * @does 구현·테스트 중 설계 변경이 필요해 오른쪽 패널 아래 "변경사항을 적어주세요" 칸에 쓰고 "설계 변경"을 누른다 | 단계가 설계 단계로 바뀐다는 확인 창이 뜨고 확인하면 요청이 설계 다시 작성 중으로 돌아가며 변경사항이 진행 기록에 남고 담당 세션에 전달된다 | 잘못된 설계를 안고 가지 않고 설계를 고쳐 다시 승인받는다#1
 * @does 테스트 칸에서 시나리오 옆"첫 화면 열기"를 누른다 | 새 창에 첫 화면이 열리고 오른쪽 코멘트 창에 경로 단계 목록이 나온다 | 테스트를 경로 따라가며 승인한다#1 | → 2
 * @does 테스트 경로 서랍에서 "‹ 요청 #번호 상세로"를 누른다 | 경로가 끝나고 그 요청의 상세가 열린다 | 테스트를 경로 따라가며 승인한다#1b | → 2
 * @does 단계마다 대상을 고르고 코멘트를 담은 뒤 "다음 화면"으로 간다 | 다음 단계의 화면으로 넘어가고 담은 코멘트가 쌓인다 | 테스트를 경로 따라가며 승인한다#2 | → 3
 * @does 경로 끝에서 "승인"이나 "한번에 보내기(반려)"를 누른다 | 승인하면 요청이 끝나고, 반려하면 담은 코멘트가 한 묶음으로 가며 같은 요청에서 고친다 | 테스트를 경로 따라가며 승인한다#3
 */
export function manageDetail(root: HTMLElement, { model, id, sub, onChange }: { model: Model; id: string; sub: string; onChange: () => void }): void {
  const r = model.requests.find((x) => String(x.id) === String(id));
  if (!r) { root.append(h('div', { class: 'empty-note', style: 'flex:1' }, `요청 #${id}을 찾지 못했다`)); return; }
  if (sub === 'info') { manageInfoOverlay(root, { model, r }); return; }
  if (sub === 'compare') { manageCompare(root, { r, screen: new URLSearchParams(location.hash.split('?')[1] ?? '').get('screen') || '' }); return; }
  const d = r.design;
  const head = pageHead({ crumb: [h('a', { href: hash('manage') }, '요청'), ` › #${r.id}`], title: r.title, meta: [chipFor(r), r.detail?.mode === 'direct' ? chip('ok', '바로 작업') : null, scopeTags(r), h('span', null, `${r.source === 'user' ? '사용자 요청' : '에이전트 발견'} · ${r.origin.channel} · ${fmt(r.origin.at)}`)] });
  const stage = r.stage === 'cancelled' ? 'design' : r.stage;
  const idx = (['design', 'impl', 'test', 'done'] as const).indexOf(stage);
  const at = (kind: string): RequestView['events'][number] | undefined => [...r.events].reverse().find((e) => e.kind === kind);
  const approved = currentDesignApproval(r);
  // 칸 하나: 제목줄(제목·이름표·한 줄 요약·펼치기/접기)과 속. 펼침은 단계별 기본값이고, 눌러서 바꾼 것은 기억한다
  const fold = (key: string, title: string, open: boolean, summary: Kid, body: Kid, o: { label?: Kid; later?: boolean; cur?: boolean } = {}): HTMLElement => {
    const k = `${r.id}:${key}`;
    const isOpen = !o.later && (FOLD.get(k) ?? open);
    const card = h('div', { class: `card sec${isOpen ? '' : ' shut'}${o.later ? ' later' : ''}${o.cur ? ' cur' : ''}`, 'data-fold': key });
    const tg = h('span', { class: 'tg' }, o.later ? '' : isOpen ? '접기' : '펼치기');
    const toggle = (): void => { if (o.later) return; const now = card.classList.toggle('shut') === false; FOLD.set(k, now); tg.textContent = now ? '접기' : '펼치기'; };
    card.append(h('div', { class: 'fh', onclick: toggle }, h('h3', null, title), o.label ?? null, h('span', { class: 'sum' }, summary), tg), h('div', { class: 'fb' }, body));
    return card;
  };
  const sumText = (t: string, n = 70): string => (t.length > n ? `${t.slice(0, n)}…` : t);
  const dsum = r.detail?.mode === 'direct' ? '바로 작업으로 등록되어 설계 없음 승인으로 처리됨' : !d ? '아직 올라오지 않았습니다' : d.none ? '정보도 화면도 바뀌지 않는 요청(설계 없음)' : `정보 변경 ${d.changes.length}건 · 화면 변경 ${d.screens.length}건${d.rejected ? ` · 반려 ${d.rejected}회` : ''}`;
  const designEvents = r.events.filter((e) => e.kind.startsWith('design-') || e.kind === 'redesigned');
  const designState = approved ? chip('ok', '승인됨') : r.stage === 'design' ? chip('me', r.step === 'submitted' ? '승인 대기' : '작성 중') : null;
  const implEvents = r.events.filter((e) => e.kind === 'impl' || e.kind === 'test-requested');
  const comps = [...new Set((r.scope.scenarios ?? []).flatMap((n) => model.scenarios.find((s) => s.name === n)?.steps.map((st) => st.owner) ?? []))];
  const cards: HTMLElement[] = [
    ...(r.fileOverlaps?.length ? [h('div', { class: 'warn' }, h('b', null, '같은 파일을 건드리는 진행 중 요청이 있습니다'), ` · ${r.fileOverlaps.map((o) => `#${o.id}과 ${o.files.join(', ')}`).join(' / ')}가 겹칩니다. 순서를 정해 하나씩 하세요.`)] : []),
    fold('agent', '맡은 에이전트', idx === 0 || !!r.agent.name, r.agent.name ? [chip('ag', r.agent.name), r.activity ? ` ${r.activity.working ? '일하는 중' : '쉬는 중'} · 마지막 활동 ${Math.max(0, Math.floor((Date.now() - Date.parse(r.activity.lastActiveAt)) / 60000))}분 전` : '', ` · 마지막 기록 ${fmt(r.events[r.events.length - 1].at)}`, r.cost && (r.cost.start || r.cost.wake) ? ` · 비용 약 $${r.cost.usd.toFixed(2)}` : ''] : '아직 정해지지 않았습니다',
      [r.agent.name ? conversationBox(r.id) : null, r.agent.name ? worktreeBox(r) : null,
      r.attach ? h('div', { class: 'rm' }, h('span', { class: 'hint' }, '들어가기'), h('span', { class: 'code' }, r.attach), h('button', { class: 'btn sm', onclick: () => { void copyText(r.attach!).then(() => toast('복사했습니다')); } }, '복사'), h('span', { class: 'hint' }, `설계 제출·질문·막힘·테스트 올림·종료가 생기면 iTerm2 창이 자동으로 열립니다(요청마다 창 하나 · 닫기는 직접). 일하는 중에 들어가면 일이 멈출 수 있습니다. 지난 일은 위 "대화 보기"로 보세요`))
        : h('div', { class: 'hint' }, '이 요청만 알고 일하는 에이전트입니다. 맡으면 이름이 여기에 나옵니다.'),
      r.cost && (r.cost.start || r.cost.wake) ? h('div', { class: 'rm cost' }, h('b', null, '이 요청에 쓴 세션 비용'), chip('me', `약 $${r.cost.usd.toFixed(2)}`), h('span', { class: 'hint' }, `세션 시작 ${r.cost.start}번 · 깨움 ${r.cost.wake}번 · 토큰 입력 ${r.cost.inputTokens.toLocaleString()} · 출력 ${r.cost.outputTokens.toLocaleString()}`)) : null]),
    fold('origin', '요청 원문', idx === 0, r.origin.text ? `"${sumText(r.origin.text)}"` : '원문이 없습니다', [r.origin.text ? h('div', { class: 'quote' }, r.origin.text) : h('div', { class: 'hint' }, '원문이 기록되지 않았습니다.'),
      r.detail ? h('div', { class: 'box' }, h('div', { class: 'hint' }, `상세 내용 · 등록할 때 정리하고 사용자가 확인함 · ${fmt(r.detail.confirmedAt)}`), h('div', { class: 'quote' }, r.detail.text),
        h('div', { class: 'tagrow' }, chip(r.detail.mode === 'direct' ? 'ok' : 'dim', r.detail.mode === 'direct' ? '바로 작업' : '정식 설계'), r.detail.reason ? h('span', { class: 'hint' }, r.detail.reason) : null)) : null]),
    fold('design', '설계', idx === 0, approved ? `${fmt(approved.at)} 사용자 승인 · ${dsum}` : dsum,
      [d && (!d.none || d.understanding) ? designText(d) : null,
        designResult(model, r), designVersionsBox(r), designEvents.length ? h('div', { class: 'tl' }, designEvents.map((e) => h('div', null, h('i'), h('span', null, h('b', null, e.note || e.kind), ` · ${e.by === 'user' ? '사용자' : '에이전트'} · ${fmt(e.at)}`, e.quote ? h('div', { class: 'hint', style: 'margin-top:2px' }, `사용자가 한 말: “${e.quote}”`) : null)))) : h('div', { class: 'hint' }, '설계 기록이 없습니다.')],
      { label: designState, cur: idx === 0 }),
    fold('impl', '구현', idx === 1, r.commits?.length ? `커밋 ${r.commits.length}개 (${r.commits.join(', ')})${at('test-requested') ? ` · ${fmt(at('test-requested')!.at)} 테스트 요청` : ''}${r.alsoFixed?.length ? ` · 함께 고친 것 ${r.alsoFixed.length}건` : ''}` : idx < 1 ? '설계 승인 뒤에 시작합니다' : `남은 커밋 기록이 없습니다${r.alsoFixed?.length ? ` · 함께 고친 것 ${r.alsoFixed.length}건` : ''}`,
      [alsoFixedBox(r, false), implEvents.length ? h('div', { class: 'tl' }, implEvents.map((e) => h('div', null, h('i'), h('span', null, h('b', null, e.note || e.kind), ` · ${fmt(e.at)}`)))) : h('div', { class: 'hint' }, '구현 기록이 없습니다.')],
      { later: idx < 1, cur: idx === 1, label: idx === 1 ? chip('me', '지금 단계') : null }),
    fold('scope', '범위', idx === 1 || idx === 2, `${(r.scope.scenarios ?? []).length}개 시나리오 · 화면 ${r.scope.screens.join(', ') || '없음'} · 정보 ${r.scope.infos.join(', ') || '없음'}${comps.length ? ` · 컴포넌트 ${comps.join(', ')}` : ''}`, scopeBody(model, r), { cur: idx === 2 }),
    fold('overlap', '다른 요청과 겹침', idx === 1 || idx === 2, r.overlaps.length ? `${r.overlaps.length}건 — ${r.overlaps.slice(0, 3).map((o) => `#${o.id}`).join(', ')}${r.overlaps.length > 3 ? ' …' : ''}` : '없음', overlapBody(r, onChange, model), { cur: idx === 2 }),
    fold('log', '진행 기록', idx === 3, `${r.events.map((e) => e.note || e.kind).slice(-4).join(' → ')} (${r.events.length}건)`,
      h('div', { class: 'tl' }, r.events.map((e) => h('div', null, h('i'), h('span', null, h('b', null, e.note || e.kind), ` · ${e.by === 'user' ? '사용자' : '에이전트'} · ${fmt(e.at)}`, e.quote ? h('div', { class: 'hint', style: 'margin-top:2px' }, `사용자가 한 말: “${e.quote}”`) : null))))),
    fold('done', '완료', idx === 3, idx === 3 ? `${fmt(r.events[r.events.length - 1].at)} 끝남` : '테스트를 승인하면 이 칸에 결과가 남습니다', h('div', { class: 'hint' }, idx === 3 ? r.events[r.events.length - 1].note : ''), { later: idx < 3 }),
  ];
  const designSide = r.stage === 'design' && r.step === 'submitted' ? designApproval(r, onChange, !!model.testEnv)
    : r.stage === 'design' ? h('div', { class: 'card' }, h('h3', null, r.step === 'revise' ? '설계 다시 작성 중' : r.step === 'queued' ? '접수' : '설계 작성 중'), h('div', { class: 'hint' }, r.step === 'revise' ? '반려한 내용을 고쳐 다시 올리는 중입니다.' : r.step === 'queued' ? '우선순위를 정했으면 시작합니다. 누르면 이 요청을 맡을 담당 세션이 새로 만들어지고, 설계를 작성해 승인을 기다립니다.' : '에이전트가 설계를 작성하고 있습니다. 올리면 여기서 승인하거나 반려합니다.'),
      r.step === 'queued' ? h('button', { class: 'btn pri', style: 'margin-top:10px', onclick: () => act('start', { id: r.id }, `요청 #${r.id}을 시작했습니다. 시작 글을 메신저가 담당 세션에 보냅니다`, onChange) }, '시작') : null,
      // 반려하면 사유가 패널에서 사라져 무엇을 고치는 중인지 알 수 없었다 → 다시 쓰는 동안 가장 최근 반려 사유만 보인다
      r.step === 'revise' ? lastRejection(r) : null)
    : r.stage === 'impl' ? h('div', { class: 'card' }, h('h3', null, '구현 중'), h('div', { class: 'hint' }, '에이전트가 구현하고 있습니다. 끝내고 테스트를 올리면 여기서 확인합니다.'))
    : r.stage === 'done' ? h('div', { class: 'card' }, h('h3', null, '끝난 요청'), h('div', { class: 'hint' }, '모든 칸은 펼쳐서 볼 수 있습니다.')) : null;
  const testing = r.stage === 'test';
  // 결정을 누른 뒤에는 결정 카드 대신 전달 카드가 그 자리를 차지한다(읽기 전까지)
  const dlv = deliveryCard(r, () => act('resend', { id: r.id }, '메신저가 다시 보내도록 대기로 돌렸습니다', onChange));
  const tools = h('div', { class: 'tools' }, h('span', { class: 'hint' }, '칸 제목을 누르면 접고 폅니다'),
    h('button', { class: 'btn sm', onclick: () => { for (const c of cards) if (!c.classList.contains('later')) { FOLD.set(`${r.id}:${c.dataset.fold}`, true); c.classList.remove('shut'); c.querySelector('.tg')!.textContent = '접기'; } } }, '모두 펼치기'),
    h('button', { class: 'btn sm', onclick: () => { for (const k of [...FOLD.keys()]) if (k.startsWith(`${r.id}:`)) FOLD.delete(k); root.replaceChildren(); manageDetail(root, { model, id, sub, onChange }); } }, '단계 기본으로'));
  const decide = testing ? testCard(model, r, onChange, !!model.testEnv) : designSide;
  root.append(withPanel(h('div', { class: 'wrap' }, head, noteBoxes(r), h('div', { class: 'card' }, stepperBig(r)), tools, h('div', { class: 'dcol' }, cards)),
    sidePanel({ title: testing && !unread(r) ? '사용 시나리오 테스트' : `요청 #${r.id}`, fold: 'request', body: unread(r) ? [dlv] : [dlv, testing ? testDataNotice(model) : null, decide, model.testEnv ? null : redesignCard(r, onChange)] })));
}
