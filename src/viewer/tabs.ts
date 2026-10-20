/**
 * @spec screen-tabs 화면 설계서 오른쪽 패널의 탭
 * @why 한 화면에 대해 개요, 컴포넌트, 메모, 승인, 히스토리를 같은 자리에서 오가며 보게 한다. 설계서를 따로 쓰지 않고 소스에서 읽은 것(존재 이유, 동작, 이동, 정보)과 사람이 남긴 것(메모, 승인)을 한 패널에 모은다.
 * @contract 각 탭은 screen.ts가 만든 제어 객체(ctx.ts의 ScreenCtx)를 받아 요소를 만들어 돌려준다. 상태를 바꾼 뒤에는 c.render()로 다시 그린다.
 */
import { stepLabel } from './steps.js';
import { h, get, post, fmt, errorText, ROLES, ROLE_LABEL, statusChip, toast } from './util.js';
import type { Kid } from './util.js';
import type { ScreenCtx } from './ctx.js';
import type { HistoryCommit, HistoryItem, HistoryPlace, Incoming, MemoState, MemoTarget, Move, ModelScreen, Role, ScreenStatus, Snapshot, Spec } from '../types.js';

/** 이름과 값을 한 쌍의 칸으로 */
const kv = (k: string, v: Kid): HTMLSpanElement[] => [h('span', { class: 'k' }, k), h('span', null, v)];

// ── 개요 ─────────────────────────────────────────────
/** 화면 이동 한 건(들어오는 길 또는 나가는 길) */
type Way = Incoming | ModelScreen['to'][number];

/** 개요 탭: 존재 이유, 사용자가 하는 일, 화면 이동, 다루는 정보 */
export function overview(c: ScreenCtx): HTMLElement {
  const sc = c.sc();
  const el = h('div', { style: 'display:contents' });
  el.append(h('div', { class: 'reason' }, h('div', { class: 'k' }, '존재 이유'),
    sc.why ? h('div', { class: 'v' }, sc.why) : h('div', { class: 'v', style: 'color:var(--dim2);font-style:italic' }, '미작성'),
    h('div', { class: 'w mono' }, `${sc.file}:${sc.line}`)));
  el.append(h('div', { class: 'sec' }, h('h4', null, '사용자가 하는 일'),
    sc.does.length ? h('div', { class: 'chips' }, sc.does.map((d) => h('span', { class: 'tag', title: d.check }, d.title))) : h('div', { style: 'font-size:12px;color:var(--dim2)' }, '없음 — 화면의 @does를 쓰면 승인 때 확인 목록이 된다')));
  // 화면 이동: 가운데가 이 화면, 왼쪽은 들어옴, 오른쪽은 나감. 배지를 누르면 이벤트(행동)와 넘기는 값이 아래에 나온다
  const valuesOf = (v: string | undefined): string[] => (v || '').split(/[,·]/).map((x) => x.trim()).filter((x) => x && x !== '(없음)');
  const detail = h('div', { class: 'mv-detail hidden' });
  let picked: HTMLElement | null = null;
  const showDetail = (dir: 'in' | 'out', w: Way, other: string, btn: HTMLElement): void => {
    el.querySelectorAll('.mv-pill.sel').forEach((n) => n.classList.remove('sel'));
    if (picked === btn) { picked = null; detail.classList.add('hidden'); return; }
    picked = btn; btn.classList.add('sel');
    const vals = valuesOf(w.pass);
    detail.className = `mv-detail ${dir}`;
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'mv-dl' }, h('span', { class: 'mv-screen' }, dir === 'in' ? other : sc.name), h('span', { class: 'mv-ar' }, '→'), h('span', { class: 'mv-screen' }, dir === 'in' ? sc.name : other)),
      h('div', { class: 'mv-row' }, h('span', { class: 'mv-vk' }, '이벤트'), h('span', null, w.action || '적지 않음')),
      h('div', { class: 'mv-row' }, h('span', { class: 'mv-vk' }, dir === 'in' ? '받는 값' : '넘기는 값'), vals.length ? h('span', { class: 'mv-vals' }, vals.map((v) => h('span', { class: 'mv-val mono' }, v))) : h('span', { style: 'color:var(--dim2)' }, '없음')),
      dir === 'out' && 'verified' in w && w.verified === false ? h('div', { class: 'mv-warn' }, '코드에서 이 이동을 찾지 못했다') : null,
      h('button', { class: 'btn sm', style: 'align-self:flex-start', onclick: () => c.go(other) }, `${other} 열기 ›`)];
    detail.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
  };
  const pill = (dir: 'in' | 'out', w: Way, other: string): HTMLButtonElement => {
    const unverified = dir === 'out' && 'verified' in w && w.verified === false;
    const b = h('button', { class: `mv-pill ${dir}`, title: w.action || '', onclick: () => showDetail(dir, w, other, b) }, dir === 'in' ? [other, h('i', null, '→')] : [h('i', null, '→'), other, unverified ? h('em', { title: '코드에서 못 찾음' }, '!') : null]);
    return b;
  };
  const col = <T extends Way>(dir: 'in' | 'out', list: T[], other: (w: T) => string): HTMLElement => h('div', { class: `mv-col ${dir}` }, h('div', { class: `mv-colhead ${dir}` }, dir === 'in' ? '들어옴' : '나감', h('span', null, list.length)),
    list.length ? list.map((w) => pill(dir, w, other(w))) : h('div', { class: `mv-none${dir === 'out' && c.model.screens.length > 1 ? ' warn' : ''}` }, dir === 'in' ? '시작 화면' : '나가는 이동 없음'));
  el.append(h('div', { class: 'sec' }, h('h4', null, '화면 이동', h('small', null, '누르면 이벤트와 값')),
    h('div', { class: 'mv-grid' }, col<Incoming>('in', sc.incoming, (w) => w.from), h('div', { class: 'mv-center' }, '이 화면'), col<Move & { verified: boolean }>('out', sc.to, (w) => w.target)), detail));
  // 다루는 정보: 한 줄짜리 작은 행. 올리면 화면에서 그 정보가 보이는 자리가 강조되고, 누르면 정보 상세(이 화면에서의 쓰임이 맨 위에 나온다)가 열린다
  const fields = sc.fields;
  const counts = Object.fromEntries(ROLES.map((r) => [r, fields.filter((f) => f.roles.includes(r)).length])) as Record<Role, number>;
  const sel = c.fieldRole;
  el.append(h('div', { class: 'sec' }, h('h4', null, `다루는 정보 · ${fields.length}`, h('small', null, '누르면 정보 상세와 화면 위치')),
    h('div', { class: 'chips', style: 'margin-bottom:10px' }, ROLES.filter((r) => counts[r]).map((r) => h('button', { class: `role ${r}`, style: `background:${sel === r ? 'var(--accent-bg)' : 'none'};cursor:pointer;padding:3px 9px`, onclick: () => { c.fieldRole = sel === r ? null : r; c.render(); } }, `${ROLE_LABEL[r]} ${counts[r]}`))),
    fields.length ? h('div', { class: 'fi-list' }, fields.filter((f) => !sel || f.roles.includes(sel)).map((f) => h('button', {
      class: `fi-row${c.focus && c.focus.info === f.info && c.focus.prop === f.prop ? ' on' : ''}`, title: '누르면 정보 상세가 열리고, 화면에서 그 정보가 나오는 자리가 표시된다',
      onclick: () => c.openField(f),
    }, h('span', { class: 'fi-name' }, h('span', { class: 'i' }, `${f.info}.`), h('b', null, f.prop)), h('span', { class: 'fi-roles' }, f.roles.map((r) => h('span', { class: `role ${r}` }, ROLE_LABEL[r])))))) : h('div', { style: 'font-size:12px;color:var(--dim2)' }, '이 화면이 읽거나 쓰는 정보 필드가 없다')));
  return el;
}

// ── 컴포넌트 ─────────────────────────────────────────
/** 컴포넌트 탭: 화면 요소와 로직의 존재 이유, 근거, 약속, 동작 */
export function components(c: ScreenCtx): HTMLElement {
  const el = h('div', { style: 'display:contents' });
  const dom = c.specs.filter((s) => s.kind !== 'logic'), logic = c.specs.filter((s) => s.kind === 'logic');
  const card = (s: Spec): HTMLElement => {
    const memoForm = c.draft && c.draft.type === 'component' && c.draft.spec === s.id;
    return h('div', { class: `comp${c.active === s.id ? ' on' : ''}${c.active && c.active !== s.id ? ' dim' : ''}`, style: s.kind === 'logic' ? '' : 'cursor:pointer', onclick: (e) => { if ((e.target as HTMLElement).closest('button, textarea')) return; void c.pickComp(s.id); } },
      h('div', { class: 'ct' }, h('span', { class: `num${s.kind === 'logic' ? ' logic' : ''}` }, c.num(s.id)), h('b', null, s.title), h('span', { class: 'kind', style: s.kind === 'logic' ? 'color:var(--purple);border-color:var(--purple-deep)' : 'color:var(--accent);border-color:var(--accent-deep)' }, s.kind === 'logic' ? '로직' : s.kind)),
      h('div', { class: 'where mono' }, `${s.file}:${s.line}`),
      h('div', { class: 'crow' }, h('span', { class: 'k' }, '이유'), s.why ? h('span', { class: 'v' }, s.why) : h('span', { class: 'v empty' }, '미작성')),
      s.basis ? h('div', { class: 'crow' }, h('span', { class: 'k' }, '근거'), h('span', { class: 'v' }, s.basis)) : null,
      s.contract ? h('div', { class: 'crow' }, h('span', { class: 'k' }, '약속'), h('span', { class: 'v' }, s.contract)) : null,
      (s.kind === 'dom' && s.reveal && !c.isOnScreen(s.id)) ? h('div', { class: 'crow' }, h('span', { class: 'k' }, '나타남'), h('div', { class: 'v' }, `처음에는 숨어 있다 — ${s.reveal.map(stepLabel).join(' → ')} 순서로 하면 나타난다`, h('div', null, h('button', { class: 'btn sm', style: 'margin-top:6px', onclick: async (ev) => { ev.stopPropagation(); const ok = await c.revealSpec(s.id); if (ok) { c.focusSpec(s.id); } else alert('화면을 열지 못했다. 화면 상태가 바뀌었을 수 있다'); c.render(); } }, '열어서 보기')))) : null,
      s.kind !== 'logic' ? h('div', { class: 'crow' }, h('span', { class: 'k' }, '동작'),
        s.ons.length ? h('div', { class: 'v' }, s.ons.map((o) => h('div', { style: 'margin-bottom:6px' }, h('span', { class: 'evt' }, o.event), h('div', null, o.effect)))) : h('span', { class: 'v empty' }, '@on 없음 — 표시만 하는 요소이거나 아직 적지 않았다')) : null,
      memoForm ? memoEditor(c) : h('div', null, h('button', { class: 'btn sm', onclick: () => c.startMemoFor(s) }, '메모 남기기')));
  };
  el.append(h('div', { class: 'zone' }, '화면 요소', h('small', null, `${dom.length}개`)));
  dom.forEach((s) => el.append(card(s)));
  if (!dom.length) el.append(h('div', { style: 'font-size:12px;color:var(--dim2)' }, '이 화면에서 찾은 컴포넌트가 없다'));
  if (logic.length) { el.append(h('div', { class: 'zone' }, '로직 (화면에 없음)', h('small', null, `${logic.length}개`))); logic.forEach((s) => el.append(card(s))); }
  return el;
}

// ── 메모 ─────────────────────────────────────────────
/** 메모가 가리키는 곳을 짧은 이름으로 */
function targetLabel(t: MemoTarget | undefined): string {
  if (!t) return '화면 전체';
  if (t.type === 'component') return t.title || t.spec || '컴포넌트';
  if (t.type === 'region') return `화면 영역 · ${t.nearest?.title || '요소 없음'}`;
  if (t.type === 'empty') return '빈 영역';
  return '화면 전체';
}
/** 메모를 쓰는 동안 "무엇에 대한 메모인지"를 보이는 카드(고른 영역의 캡처, 가장 가까운 컴포넌트, 빈 영역의 위·아래) */
function targetCard(_c: ScreenCtx, d: MemoTarget): HTMLElement {
  const r = d.rect ?? { x: 0, y: 0, w: 0, h: 0 };
  const where = d.type === 'component' ? [h('b', null, d.title), h('div', { class: 'mono', style: 'font-size:11px;color:var(--dim)' }, d.file || '')] : [
    h('div', { style: 'display:flex;gap:12px;align-items:center' }, d.shotData ? h('img', { src: d.shotData, style: 'width:120px;max-height:80px;object-fit:contain;border:1px dashed var(--red-strong);border-radius:4px;background:#fff' }) : h('div', { class: 'thumb' }), h('div', null, h('b', null, d.type === 'empty' ? '빈 영역 — 요소 없음' : '선택한 영역', d.shotData ? ' · 스크린샷 첨부됨' : ''), h('div', { class: 'mono', style: 'font-size:11px;color:var(--dim);margin-top:4px' }, `${d.route || ''} · x ${r.x} y ${r.y} · ${r.w}×${r.h}`))),
    d.type === 'empty'
      ? h('div', { style: 'font-size:12px;line-height:1.7;color:var(--text2)' }, h('div', null, h('b', null, '주변'), ' (자동 추정 — 위치 힌트로 에이전트에게 간다)'), h('div', null, `위  ${d.neighbors?.above || '화면 맨 위 여백'}`), h('div', null, `아래  ${d.neighbors?.below || '화면 끝까지 여백'}`))
      : h('div', { style: 'font-size:12px;color:var(--text2);line-height:1.6' }, h('b', null, '가장 가까운 컴포넌트'), ' (자동 추정) ', h('div', { class: 'tag', style: 'display:inline-block;margin-top:4px' }, d.nearest ? `${d.nearest.title}` : '없음'), d.nearest?.file ? h('div', { class: 'mono', style: 'font-size:11px;color:var(--dim)' }, d.nearest.file) : null)];
  return h('div', { class: 'target' }, h('div', { class: 'tt' }, '대상'), where);
}
/** 메모 입력칸과 저장·취소 버튼(쓰는 중인 메모 c.draft가 있을 때) */
export function memoEditor(c: ScreenCtx): HTMLElement {
  const d = c.draft as MemoTarget;
  const ta = h('textarea', { placeholder: '한 줄로 적어 주세요', oninput: (e) => { c.draftText = (e.target as HTMLTextAreaElement).value; } }, c.draftText || '');
  const save = async (): Promise<void> => {
    if (!c.draftText?.trim()) return toast('메모 내용을 적어 주세요');
    try {
      const target: MemoTarget = { ...d, route: d.route || c.route() };
      if (d.shotData) { target.shot = await c.uploadShot(d.shotData, 'memo'); delete target.shotData; }
      await post('/__spec/memo', { screen: c.sc().name, target, text: c.draftText });
      c.draft = null; c.draftText = ''; await c.refresh(); toast("저장했습니다. 다음: '처리 요청 복사' → 에이전트에 붙여 넣기");
    } catch (e) { toast(errorText(e)); }
  };
  return h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
    d.type !== 'component' ? targetCard(c, d) : null, ta,
    h('div', { style: 'font-size:12px;color:var(--dim);line-height:1.5' }, "저장한 뒤 '처리 요청 복사'를 에이전트에 붙여 넣으면 같이 고칩니다. 붙여 넣기 전까지 메모는 대기로 남습니다."),
    h('div', { class: 'btns', style: 'justify-content:flex-end' }, h('button', { class: 'btn sm', onclick: () => { c.draft = null; c.draftText = ''; c.render(); } }, '취소'), h('button', { class: 'btn pri sm', onclick: save }, '저장')));
}
/** 메모 탭: 새 메모를 시작하는 버튼과 이 화면의 메모 목록 */
export function memoTab(c: ScreenCtx): HTMLElement {
  const sc = c.sc();
  const el = h('div', { style: 'display:contents' });
  const mine = c.model.memos.filter((m) => m.screen === sc.name).sort((a, b) => b.id - a.id);
  const n = (s: MemoState): number => mine.filter((m) => m.state === s).length;
  if (c.draft && c.draft.type !== 'component') el.append(h('div', { class: 'sec' }, h('h4', null, '새 메모 — 화면 영역'), memoEditor(c)));
  else if (c.draft) el.append(h('div', { class: 'sec' }, h('h4', null, '새 메모 — 컴포넌트'), h('div', { style: 'font-size:12px;color:var(--dim)' }, '컴포넌트 탭의 카드에서 이어서 적는다')));
  else el.append(h('div', { class: 'btns' },
    h('button', { class: 'btn pri sm', onclick: () => c.startRegion() }, '화면 영역 메모'),
    h('button', { class: 'btn sm', onclick: () => c.startMemoFor(null) }, '화면 전체 메모'),
    h('button', { class: 'btn sm', onclick: () => c.setTab('components') }, '컴포넌트에 남기기')));
  el.append(h('div', { class: 'sec' }, h('h4', null, `이 화면의 메모 · ${mine.length}`, h('small', null, `대기 ${n('pending')} · 응답됨 ${n('answered')} · 반영됨 ${n('applied')}`))));
  if (!mine.length) el.append(h('div', { style: 'font-size:12px;color:var(--dim2);line-height:1.6' }, '아직 메모가 없다. 컴포넌트 카드의 "메모 남기기"나 화면 위 영역 선택으로 한 줄을 남기면 된다.'));
  for (const m of mine) {
    el.append(h('div', { class: `mcard${m.state === 'answered' || m.state === 'applied' ? ' sel' : ''}` },
      h('div', { class: 'mtop' }, h('span', { class: 'mtag' }, targetLabel(m.target)), m.kind ? h('span', { class: 'mtag err' }, m.kind) : null, h('span', { class: `mstate ${m.state}` }, m.stateLabel)),
      h('div', { class: 'mmeta' }, `나 · ${fmt(m.at)}${m.state === 'pending' ? (m.copiedAt ? ' · 요청 복사함' : ' · 전달 전') : ''}`),
      h('div', { class: 'mtext' }, m.text),
      m.target?.shot ? h('img', { src: `/__spec/shots/${m.target.shot}`, style: 'max-width:100%;max-height:140px;object-fit:contain;border-radius:6px;border:1px solid var(--line);background:#fff;align-self:flex-start', onerror: (e) => (e.target as HTMLElement).remove() }) : null,
      m.reply ? h('div', { class: 'reply' }, h('div', { class: 'meta' }, `에이전트 · ${fmt(m.reply.at)}`), m.reply.text) : null,
      m.applied ? h('div', { class: 'diff' }, h('div', { class: 'p' }, `반영: ${m.applied.change || '(내용 없음)'}`), h('div', { class: 'mmeta', style: 'margin-top:4px' }, `커밋 ${m.applied.commit || '—'}`)) : null,
      (m.state === 'answered' || m.state === 'applied') ? h('div', { class: 'btns', style: 'justify-content:flex-end' }, h('button', { class: 'btn pri sm', onclick: async () => { await post('/__spec/memo/confirm', { id: m.id }); await c.refresh(); } }, '확인 완료')) : null));
  }
  return el;
}

// ── 승인 ─────────────────────────────────────────────
/** 개발 중 → 테스트 요청 → 승인 세 단계 표시 */
function stepper(st: ScreenStatus): HTMLElement {
  const s = st.status;
  const cls = [s === 'dev' ? 'cur' : 'done', s === 'dev' ? '' : s === 'test-requested' ? 'cur' : s === 'needs-fix' ? 'warn' : 'done', s === 'approved' ? 'done' : s === 'approved-changed' ? 'amber' : ''];
  const mark = [cls[0] === 'done' ? '✓' : '1', cls[1] === 'done' ? '✓' : cls[1] === 'warn' ? '!' : '2', cls[2] === 'done' ? '✓' : cls[2] === 'amber' ? '!' : '3'];
  const step = (i: number, label: string): HTMLElement => h('div', { class: `step ${cls[i]}` }, h('i', null, mark[i]), label);
  return h('div', { class: 'stepper' }, step(0, '개발 중'), h('div', { class: 'stline' }), step(1, '테스트 요청'), h('div', { class: 'stline' }), step(2, s === 'approved-changed' ? '승인 후 변경됨' : '승인'));
}
/** 승인 탭: 확인 목록, 승인, 문제 있음(오류 기록), 승인 후 변경 비교 */
export function approval(c: ScreenCtx): HTMLElement {
  const sc = c.sc(), st = sc.status;
  const el = h('div', { style: 'display:contents' });
  el.append(stepper(st));
  const approve = async (): Promise<void> => {
    try { const shot = await c.uploadShot(await c.capture(), 'approve'); await post('/__spec/status.json', { screen: sc.name, status: 'approved', shot }); c.ap = { problem: false }; await c.refresh(); toast('승인했습니다. 이 소스 버전이 기준이 됩니다'); } catch (e) { toast(errorText(e)); }
  };
  const doneN = sc.does.filter((_, i) => st.checks && st.checks[i]).length;
  const allDone = !sc.does.length || doneN === sc.does.length;
  const checklist = (): HTMLElement => h('div', { class: 'checks' },
    h('div', { style: 'display:flex;justify-content:space-between;font-size:13px' }, h('span', null, h('b', null, '확인 목록'), h('span', { style: 'color:var(--dim)' }, ' — 이 화면의 "사용자가 하는 일"')), h('span', { style: 'color:var(--green);font-weight:700' }, `${doneN} / ${sc.does.length}`)),
    sc.does.map((d, i) => h('div', { class: `ck${st.checks && st.checks[i] ? ' done' : ''}`, onclick: async () => { await post('/__spec/check', { screen: sc.name, index: i, done: !(st.checks && st.checks[i]) }); await c.refresh(); } },
      h('span', { class: 'box' }, st.checks && st.checks[i] ? '✓' : ''), h('div', null, h('b', null, d.title), d.check ? h('small', null, d.check) : null))));
  const problemForm = (): HTMLElement => {
    const ap = c.ap;
    const radios: [string, string][] = [['screen', '이 화면 전체'], ...sc.does.map((d, i): [string, string] => [`item:${i}`, `확인 목록 항목: ${d.title}`]), ['region', '화면 영역을 끌어서 고르기 (왼쪽 화면에서)']];
    const ta = h('textarea', { placeholder: '무엇이 문제인가요? 한 줄로 적어 주세요', oninput: (e) => { ap.text = (e.target as HTMLTextAreaElement).value; } }, ap.text || '');
    return h('div', { class: 'apcard red' }, h('h5', null, '문제 있음 — 오류로 기록'),
      h('div', { style: 'font-size:12px;color:var(--dim);margin-bottom:6px' }, '어디에서 생긴 문제인가'),
      radios.map(([v, l]) => h('div', { class: `rad${(ap.target || 'screen') === v ? ' on' : ''}`, onclick: () => { ap.target = v; if (v === 'region') c.startRegion({ forError: true }); c.render(); } }, h('i'), l)),
      ap.region ? h('div', { style: 'margin:8px 0' }, targetCard(c, ap.region)) : null, ta,
      h('div', { style: 'font-size:12px;color:var(--dim);margin:8px 0' }, `지금 소스 버전(${st.commit || '—'})과 함께 저장된다.`),
      h('div', { class: 'btns', style: 'justify-content:flex-end' }, h('button', { class: 'btn sm', onclick: () => { c.ap = { problem: false }; c.render(); } }, '취소'),
        h('button', { class: 'btn bad sm', onclick: async () => {
          if (!ap.text?.trim()) return toast('문제를 한 줄로 적어 주세요');
          const t = ap.target || 'screen';
          const target: MemoTarget = t === 'region' && ap.region ? { ...ap.region } : { type: 'screen', route: c.route() };
          if (target.shotData) { target.shot = await c.uploadShot(target.shotData, 'memo'); delete target.shotData; }
          const text = t.startsWith('item:') ? `[${sc.does[Number(t.slice(5))].title}] ${ap.text}` : ap.text;
          try { await post('/__spec/memo', { screen: sc.name, target, text, kind: '오류' }); await post('/__spec/status.json', { screen: sc.name, status: 'needs-fix', note: text }); c.ap = { problem: false }; await c.refresh(); toast("오류로 저장했습니다. '처리 요청 복사'로 에이전트에 알려 주세요"); } catch (e) { toast(errorText(e)); }
        } }, '오류로 저장')));
  };
  if (c.ap?.problem) { el.append(problemForm(), h('div', { class: 'hbox' }, h('span', null, '저장하면 → 상태가 '), h('b', { style: 'color:var(--red)' }, '수정 필요'), h('span', null, '로 바뀌고, 이 메모는 사용자가 "처리 요청 복사"를 붙여 넣을 때 에이전트가 읽는다. 고쳐지면 다시 "테스트 요청"이 된다.'))); return el; }
  if (st.status === 'dev') {
    el.append(h('div', { class: 'hbox' }, '아직 개발 중입니다. 에이전트가 자체 점검(경고 0, 화면 열림, 설계서 보기 열림)을 마치고 "테스트 요청"을 남기면, 이곳에 확인 목록과 승인이 열립니다.'));
  } else if (st.status === 'test-requested') {
    el.append(checklist());
    el.append(h('div', { class: 'btns' }, h('button', { class: 'btn bad sm', style: 'min-height:38px;padding:0 18px', onclick: () => { c.ap = { problem: true }; c.render(); } }, '문제 있음'),
      h('button', { class: `btn sm${allDone ? ' ok' : ''}`, disabled: allDone ? null : true, onclick: approve }, allDone ? '승인' : '승인 (모두 확인하면 켜짐)')));
    el.append(h('div', { style: 'font-size:12px;color:var(--dim);line-height:1.6' }, '문제는 "문제 있음"으로 메모에 남긴다. 승인하면 이 소스 버전이 기준이 되고, 승인한 사람과 시각이 기록된다.'));
  } else if (st.status === 'needs-fix') {
    el.append(h('div', { class: 'apcard red' }, h('h5', null, '수정 필요'), h('div', { class: 'kv' }, kv('기록한 사람', st.by === 'user' ? '사용자' : '에이전트'), kv('시각', fmt(st.at)), kv('내용', st.note || '—'))));
    el.append(h('div', { class: 'hbox' }, '에이전트가 이 메모를 읽고 고친 뒤 다시 "테스트 요청"을 남기면 확인 목록이 다시 열린다. 메모 탭에서 "처리 요청 복사"를 붙여 넣으면 에이전트가 읽는다.'));
  } else if (st.status === 'approved') {
    el.append(h('div', { class: 'apcard' }, h('h5', null, '승인됨'), h('div', { class: 'kv' }, kv('승인한 사람', '사용자'), kv('시각', fmt(st.at)), kv('소스 버전', h('b', { class: 'mono' }, st.commit || '—')), kv('기준 화면', st.shot ? h('img', { src: `/__spec/shots/${st.shot}`, style: 'max-width:100%;max-height:150px;border-radius:6px;border:1px solid var(--line);background:#fff', onerror: (e) => (e.target as HTMLElement).replaceWith('스크린샷 없음') }) : '저장 안 됨'), kv('확인한 것', sc.does.length ? `${sc.does.map((d) => d.title).join(' · ')} (${doneN}/${sc.does.length})` : '확인 목록 없음'))));
    el.append(h('div', { class: 'hbox' }, h('span', null, '이후 이 화면의 소스가 바뀌면 자동으로 '), h('b', { style: 'color:var(--amber)' }, '승인 후 변경됨'), h('span', null, '이 되고, 바뀐 곳을 보고 다시 승인한다.')));
    el.append(h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: async () => { await post('/__spec/status.json', { screen: sc.name, status: 'dev', note: '승인 취소' }); await c.refresh(); } }, '승인 취소'), h('button', { class: 'btn pri sm', onclick: () => c.setTab('history') }, '히스토리 보기 ›')));
  } else if (st.status === 'approved-changed') {
    const box = h('div', { class: 'apcard amber' }, h('h5', null, '승인 후 변경됨', h('span', { class: 'mmeta', style: 'float:right;font-weight:400' }, `마지막 승인 ${fmt(st.at)} · ${st.commit || '—'}`)),
      h('div', { style: 'font-size:13px;line-height:1.55;margin-bottom:10px' }, `이 화면이 쓰는 소스(화면 파일과 불러 쓰는 파일 ${st.files}개)가 승인 뒤 바뀌었다. 지금 모습을 확인하고 승인하면 이 상태가 새 기준이 된다.`));
    const nowImg = h('div', { style: 'font-size:12px;color:var(--dim)' }, '지금 화면을 찍는 중…');
    void c.capture().then((d) => { if (d) nowImg.replaceWith(h('img', { src: d, style: 'width:100%;border-radius:6px;background:#fff' })); else nowImg.textContent = '캡처하지 못했다'; });
    box.append(h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;font-size:12px;color:var(--dim)' },
      h('div', null, h('div', { style: 'margin-bottom:4px' }, '승인 때'), st.shot ? h('img', { src: `/__spec/shots/${st.shot}`, style: 'width:100%;border-radius:6px;background:#fff', onerror: (e) => (e.target as HTMLElement).replaceWith('스크린샷 없음') }) : '저장된 스크린샷 없음'),
      h('div', null, h('div', { style: 'margin-bottom:4px' }, '지금'), nowImg)));
    const list = h('div', null, h('div', { style: 'font-size:12px;color:var(--dim)' }, '그 뒤 바뀐 것을 읽는 중…'));
    box.append(list);
    get<{ items: HistoryItem[] }>(`/__spec/history.json?screen=${encodeURIComponent(sc.name)}`).then(({ items }) => {
      const after = items.filter((i): i is HistoryCommit => i.type === 'commit' && i.at > st.at);
      list.replaceChildren(h('div', { style: 'font-size:13px;font-weight:700;margin-bottom:6px' }, `그 뒤 바뀐 것 · ${after.length}`), ...(after.length ? after.map((i) => h('div', { style: 'padding:8px 10px;border-radius:8px;background:var(--inset);margin-bottom:6px;font-size:12px' }, h('span', { class: `kindtag ${i.kind === '오류 수정' ? 'k2' : 'k1'}` }, i.kind), i.title, h('div', { class: 'mmeta mono', style: 'margin-top:4px' }, `${i.hash} · ${fmt(i.at)}${i.request ? ` · 요청: ${i.request.split('—')[0].trim()}` : ''}`))) : [h('div', { style: 'font-size:12px;color:var(--dim)' }, '아직 커밋되지 않은 변경입니다(작업 중인 파일).')]));
    }).catch(() => {});
    box.append(h('div', { class: 'btns', style: 'margin-top:10px' }, h('button', { class: 'btn bad sm', onclick: () => { c.ap = { problem: true }; c.render(); } }, '문제 있음 (메모로)'), h('button', { class: 'btn ok sm', onclick: approve }, '이대로 승인')),
      h('div', { style: 'font-size:12px;color:var(--dim);margin-top:10px;line-height:1.5' }, '승인하면 날짜·승인한 사람·소스 버전이 기록되고 이 소스가 기준으로 저장된다.'));
    el.append(box);
  }
  return el;
}

// ── 히스토리 ─────────────────────────────────────────
// 이 화면이 왜 지금 모습인지: 언제 무엇을 왜 바꿨고(결정), 무엇을 버렸고(기각), 누가 요청·승인했는지. 코드 줄 같은 자세한 내용은 "상세 보기"에 접어 둔다.
/** 이력을 거르는 이름과 조건 */
const FILTERS: [string, (i: HistoryItem) => boolean][] = [['전체', () => true], ['변경', (i) => i.type === 'commit'], ['오류 수정', (i) => i.kind === '오류 수정'], ['승인 기록', (i) => i.type === 'status']];
/** 바뀐 곳의 종류 이름 */
const PLACE_KINDS: Record<string, string> = { spec: '화면 요소', logic: '로직', info: '정보', other: '그 밖' };
/** 바뀐 요소를 화면에 어떻게 표시했는지 설명 */
const SPAN_NOTE: Record<string, string> = { ok: '화면에 표시', big: '화면 대부분을 차지해 표시 생략', logic: '화면에 안 보이는 로직' };

/** 히스토리 탭: 커밋과 승인 기록을 시간 순으로, 결정과 기각을 먼저 보이고 자세한 변경은 접어 둔다 */
export function history(c: ScreenCtx): HTMLElement {
  const sc = c.sc();
  const el = h('div', { style: 'display:contents' });
  const chips = h('div', { class: 'chips' });
  const holder = h('div', { class: 'tl' }, h('div', { style: 'font-size:12px;color:var(--dim)' }, '읽는 중…'));
  el.append(h('div', { style: 'font-size:12.5px;line-height:1.6;color:var(--dim)' }, '이 화면이 왜 지금 모습인지 — 언제 무엇을 왜 바꿨고, 무엇을 버렸는지'), chips, holder);
  get<{ items: HistoryItem[] }>(`/__spec/history.json?screen=${encodeURIComponent(sc.name)}`).then(({ items }) => {
    const thumb = (x: Pick<Snapshot, 'shot'> | null | undefined, cap: string): HTMLElement => h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 'mmeta', style: 'margin-bottom:3px' }, cap),
      x ? h('a', { href: `/__spec/shots/${x.shot}`, target: '_blank', title: '누르면 크게' }, h('img', { src: `/__spec/shots/${x.shot}`, style: 'width:100%;border-radius:6px;border:1px solid var(--line);background:#fff;display:block', onerror: (e) => (e.target as HTMLElement).replaceWith('화면 파일 없음') })) : h('div', { class: 'mmeta' }, '저장된 화면 없음'));
    const placeRow = (pl: HistoryPlace): HTMLElement => {
      const logic = pl.kind === 'spec' && c.model.specs.find((x) => x.id === pl.id)?.kind === 'logic';
      const st = pl.kind === 'spec' && pl.id ? c.spanState(pl.id) : null, open = c.hOpen.has(pl.key);
      return h('div', { style: 'border:1px solid var(--line);border-radius:8px;background:var(--bg2);overflow:hidden' },
        h('button', { style: 'display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 10px;border:0;background:none;text-align:left', onclick: (ev) => {
          ev.stopPropagation();
          if (open) c.hOpen.delete(pl.key); else c.hOpen.add(pl.key);
          if (pl.kind === 'spec' && pl.id && !open) c.setFlash(st === 'ok' ? [pl.id] : []);
          draw(); } },
          h('span', { class: 'kindtag k3', style: 'margin:0;flex:none' }, PLACE_KINDS[logic ? 'logic' : pl.kind]), h('b', { style: 'font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis' }, pl.title),
          h('span', { class: 'mono', style: 'margin-left:auto;flex:none;font-size:11px' }, h('span', { style: 'color:var(--green)' }, `+${pl.added}`), ' ', h('span', { style: 'color:var(--red)' }, `−${pl.removed}`)), h('span', { style: 'flex:none;color:var(--dim)' }, open ? '▾' : '▸')),
        st && SPAN_NOTE[st] ? h('div', { class: 'mmeta', style: `padding:0 10px 8px;color:${st === 'ok' ? 'var(--amber)' : 'var(--dim)'}` }, SPAN_NOTE[st]) : null,
        open ? h('div', { style: 'padding:0 10px 10px;display:flex;flex-direction:column;gap:8px' },
          pl.hunks.map((hk) => h('div', null, h('div', { class: 'mmeta mono', style: 'margin-bottom:3px' }, `${pl.file}:${hk.line}`),
            hk.removed.map((x) => h('div', { class: 'dline m' }, `− ${x}`)), hk.added.map((x) => h('div', { class: 'dline p' }, `+ ${x}`)))),
          pl.kind === 'info' && pl.info ? h('button', { class: 'btn sm', style: 'align-self:flex-start', onclick: (ev) => { ev.stopPropagation(); c.openInfo(pl.info as string, pl.prop || undefined); } }, '정보 상세 열기 ›') : null) : null);
    };
    // 상세 보기: 어디를 어떻게 고쳤는지(개발자도 확인할 수 있는 수준)
    const detail = (i: HistoryCommit): HTMLElement => {
      const places = i.places || [];
      const small = (i.touchedSpecs || []).filter((id) => c.spanState(id) === 'ok');
      return h('div', { style: 'display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;background:var(--bg2);border:1px solid var(--line)' },
        h('div', { class: 'mmeta mono' }, `커밋 ${i.hash}${i.files ? ` · 파일 ${i.files}개` : ''}${i.author ? ` · ${i.author}` : ''}`),
        h('div', { style: 'font-weight:700;font-size:13px' }, `바뀐 곳 · ${places.length}`),
        places.length ? places.slice(0, 8).map(placeRow) : h('div', { style: 'font-size:12px;color:var(--dim)' }, '이 화면의 파일에서 바뀐 줄을 찾지 못했다(이름 변경이나 파일 이동일 수 있다)'),
        places.length > 8 ? h('div', { class: 'mmeta' }, `외 ${places.length - 8}곳`) : null,
        small.length ? h('div', { class: 'mmeta', style: 'color:var(--amber)' }, `왼쪽 화면에 노란 테두리로 표시했다 (${small.length}곳)`) : (places.length ? h('div', { class: 'mmeta' }, '테두리로 보여 줄 작은 화면 요소가 없다. 위 목록의 바뀐 내용으로 확인한다') : null),
        !i.before && !i.after ? h('div', { class: 'mmeta' }, '이 시점의 화면 기록이 없다. 테스트 요청과 승인 때마다 화면이 저장된다') : null);
    };
    const channel = (i: HistoryCommit): HTMLElement | null => (i.request ? h('span', { class: 'chan' }, `요청: ${i.request.split('—')[0].trim()}`) : null);
    const reasonRows = (i: HistoryCommit): Kid[] => [
      ...i.decisions.map((d) => h('div', { class: 'why d' }, h('b', null, '결정'), d)),
      ...i.rejections.map((d) => h('div', { class: 'why r' }, h('b', null, '버림'), d)),
      i.cause ? h('div', { class: 'why c' }, h('b', null, '원인'), i.cause) : null];
    const draw = (): void => {
      chips.replaceChildren(...FILTERS.map(([k, fn]) => h('button', { class: `pill${c.hFilter === k ? ' sel' : ''}`, style: 'min-height:30px;font-size:12px', onclick: () => { c.hFilter = k; draw(); } }, `${k} · ${items.filter(fn).length}`)));
      const fn = (FILTERS.find(([k]) => k === c.hFilter) || FILTERS[0])[1];
      const shown = items.filter(fn);
      holder.replaceChildren(...(shown.length ? shown.map((i) => {
        const key = i.hash + i.at, open = c.hSel === key;
        const dot = i.kind === '오류 수정' || i.kind === '수정 필요' ? 'err' : i.type === 'status' ? 'ap' : '';
        const kindCls = i.kind === '오류 수정' || i.kind === '수정 필요' ? 'k2' : i.kind === '변경' ? 'k1' : 'k3';
        if (i.type === 'status') {
          return h('div', { class: 'ev' }, h('div', { class: `dot ${dot}` }), h('div', { class: 'body' },
            h('div', { class: 'ev-top' }, h('span', { class: 'ev-date mono' }, fmt(i.at)), h('span', { class: `kindtag ${kindCls}` }, i.kind), h('span', { class: 'chan' }, i.author)),
            h('div', { class: 'tit ev-clamp' }, i.title || (i.kind === '승인' ? `${sc.name} 승인` : i.kind)),
            i.shot ? h('div', { style: 'display:flex' }, thumb({ shot: i.shot }, `${i.kind} 때 화면`)) : null,
            i.hash ? h('div', { class: 'mmeta mono' }, `소스 버전 ${i.hash}`) : null));
        }
        return h('div', { class: 'ev' }, h('div', { class: `dot ${dot}` }), h('div', { class: 'body' },
          h('div', { class: 'ev-top' }, h('span', { class: 'ev-date mono' }, fmt(i.at)), h('span', { class: `kindtag ${kindCls}` }, i.kind), channel(i)),
          h('div', { class: 'tit' }, i.title),
          (i.before || i.after) ? h('div', { style: 'display:flex;gap:8px' }, thumb(i.before, '변경 전'), thumb(i.after, '변경 후')) : null,
          ...reasonRows(i),
          h('button', { class: 'btn sm', style: 'align-self:flex-start', onclick: () => { c.hSel = open ? null : key; c.hOpen = new Set(); c.setFlash(open ? [] : (i.touchedSpecs || [])); draw(); } }, open ? '상세 닫기 ▾' : '상세 보기 ▸'),
          open ? detail(i) : null));
      }) : [h('div', { style: 'font-size:12px;color:var(--dim2);line-height:1.6' }, '아직 이력이 없다. 이 화면의 소스를 바꾼 커밋과 승인 기록이 여기에 쌓인다')]));
    };
    draw();
  }).catch((e: unknown) => holder.replaceChildren(h('div', { class: 'note' }, `이력을 읽지 못했다: ${errorText(e)}`)));
  return el;
}
