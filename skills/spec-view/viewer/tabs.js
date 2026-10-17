// 화면 설계서 오른쪽 패널의 다섯 탭: 개요, 컴포넌트, 메모, 승인, 히스토리. c는 screen.js가 넘기는 제어 객체.
import { h, get, post, fmt, ROLES, ROLE_LABEL, statusChip, toast } from './util.js';

const kv = (k, v) => [h('span', { class: 'k' }, k), h('span', null, v)];

// ── 개요 ─────────────────────────────────────────────
export function overview(c) {
  const sc = c.sc();
  const el = h('div', { style: 'display:contents' });
  el.append(h('div', { class: 'reason' }, h('div', { class: 'k' }, '존재 이유'),
    sc.why ? h('div', { class: 'v' }, sc.why) : h('div', { class: 'v', style: 'color:var(--dim2);font-style:italic' }, '미작성'),
    h('div', { class: 'w mono' }, `${sc.file}:${sc.line}`)));
  el.append(h('div', { class: 'sec' }, h('h4', null, '사용자가 하는 일'),
    sc.does.length ? h('div', { class: 'chips' }, sc.does.map((d) => h('span', { class: 'tag', title: d.check }, d.title))) : h('div', { style: 'font-size:12px;color:var(--dim2)' }, '없음 — 화면의 @does를 쓰면 승인 때 확인 목록이 된다')));
  // 화면 이동: 가운데가 이 화면, 왼쪽은 들어옴, 오른쪽은 나감. 배지를 누르면 이벤트(행동)와 넘기는 값이 아래에 나온다
  const valuesOf = (v) => (v || '').split(/[,·]/).map((x) => x.trim()).filter((x) => x && x !== '(없음)');
  const detail = h('div', { class: 'mv-detail hidden' });
  let picked = null;
  const showDetail = (dir, w, other, btn) => {
    el.querySelectorAll('.mv-pill.sel').forEach((n) => n.classList.remove('sel'));
    if (picked === btn) { picked = null; detail.classList.add('hidden'); return; }
    picked = btn; btn.classList.add('sel');
    const vals = valuesOf(w.pass);
    detail.className = `mv-detail ${dir}`;
    detail.replaceChildren(...[
      h('div', { class: 'mv-dl' }, h('span', { class: 'mv-screen' }, dir === 'in' ? other : sc.name), h('span', { class: 'mv-ar' }, '→'), h('span', { class: 'mv-screen' }, dir === 'in' ? sc.name : other)),
      h('div', { class: 'mv-row' }, h('span', { class: 'mv-vk' }, '이벤트'), h('span', null, w.action || '적지 않음')),
      h('div', { class: 'mv-row' }, h('span', { class: 'mv-vk' }, dir === 'in' ? '받는 값' : '넘기는 값'), vals.length ? h('span', { class: 'mv-vals' }, vals.map((v) => h('span', { class: 'mv-val mono' }, v))) : h('span', { style: 'color:var(--dim2)' }, '없음')),
      dir === 'out' && w.verified === false ? h('div', { class: 'mv-warn' }, '코드에서 이 이동을 찾지 못했다') : null,
      h('button', { class: 'smallbtn', style: 'align-self:flex-start', onclick: () => c.go(other) }, `${other} 열기 ›`)].filter(Boolean));
  };
  const pill = (dir, w, other) => { const b = h('button', { class: `mv-pill ${dir}`, title: w.action || '', onclick: () => showDetail(dir, w, other, b) }, dir === 'in' ? [other, h('i', null, '→')] : [h('i', null, '→'), other, dir === 'out' && w.verified === false ? h('em', { title: '코드에서 못 찾음' }, '!') : null]); return b; };
  const col = (dir, list, other) => h('div', { class: `mv-col ${dir}` }, h('div', { class: `mv-colhead ${dir}` }, dir === 'in' ? '들어옴' : '나감', h('span', null, list.length)),
    list.length ? list.map((w) => pill(dir, w, other(w))) : h('div', { class: `mv-none${dir === 'out' && c.model.screens.length > 1 ? ' warn' : ''}` }, dir === 'in' ? '시작 화면' : '나가는 이동 없음'));
  el.append(h('div', { class: 'sec' }, h('h4', null, '화면 이동', h('small', null, '누르면 이벤트와 값')),
    h('div', { class: 'mv-grid' }, col('in', sc.incoming, (w) => w.from), h('div', { class: 'mv-center' }, '이 화면'), col('out', sc.to, (w) => w.target)), detail));
  // 다루는 정보: 한 줄짜리 작은 행. 올리면 화면에서 그 정보가 보이는 자리가 강조되고, 누르면 정보 상세(이 화면에서의 쓰임이 맨 위에 나온다)가 열린다
  const fields = sc.fields;
  const counts = Object.fromEntries(ROLES.map((r) => [r, fields.filter((f) => f.roles.includes(r)).length]));
  const sel = c.fieldRole;
  el.append(h('div', { class: 'sec' }, h('h4', null, `다루는 정보 · ${fields.length}`, h('small', null, '누르면 정보 상세')),
    h('div', { class: 'chips', style: 'margin-bottom:10px' }, ROLES.filter((r) => counts[r]).map((r) => h('button', { class: `role ${r}`, style: `background:${sel === r ? 'var(--accent-bg)' : 'none'};cursor:pointer;padding:3px 9px`, onclick: () => { c.fieldRole = sel === r ? null : r; c.render(); } }, `${ROLE_LABEL[r]} ${counts[r]}`))),
    fields.length ? h('div', { class: 'fi-list' }, fields.filter((f) => !sel || f.roles.includes(sel)).map((f) => h('button', {
      class: `fi-row${c.focus && c.focus.info === f.info && c.focus.prop === f.prop ? ' on' : ''}`, title: f.doc || '존재 이유 미작성',
      onmouseenter: () => c.setHL(new Set(f.specs)), onmouseleave: () => c.setHL(new Set()),
      onclick: () => c.openInfo(f.info, f.prop),
    }, h('span', { class: 'fi-name' }, h('span', { class: 'i' }, `${f.info}.`), h('b', null, f.prop)), h('span', { class: 'fi-roles' }, f.roles.map((r) => h('span', { class: `role ${r}` }, ROLE_LABEL[r])))))) : h('div', { style: 'font-size:12px;color:var(--dim2)' }, '이 화면이 읽거나 쓰는 정보 필드가 없다')));
  return el;
}

// ── 컴포넌트 ─────────────────────────────────────────
export function components(c) {
  const el = h('div', { style: 'display:contents' });
  const dom = c.specs.filter((s) => s.kind !== 'logic'), logic = c.specs.filter((s) => s.kind === 'logic');
  const card = (s) => {
    const memoForm = c.draft && c.draft.type === 'component' && c.draft.spec === s.id;
    return h('div', { class: `comp${c.active === s.id ? ' on' : ''}${c.active && c.active !== s.id ? ' dim' : ''}`, style: s.kind === 'logic' ? '' : 'cursor:pointer', onclick: (e) => { if (e.target.closest('button, textarea')) return; c.pickComp(s.id); } },
      h('div', { class: 'ct' }, h('span', { class: `num${s.kind === 'logic' ? ' logic' : ''}` }, c.num(s.id)), h('b', null, s.title), h('span', { class: 'kind', style: s.kind === 'logic' ? 'color:var(--purple);border-color:#6a5a99' : 'color:var(--accent);border-color:var(--accent-deep)' }, s.kind === 'logic' ? '로직' : s.kind)),
      h('div', { class: 'where mono' }, `${s.file}:${s.line}`),
      h('div', { class: 'crow' }, h('span', { class: 'k' }, '이유'), s.why ? h('span', { class: 'v' }, s.why) : h('span', { class: 'v empty' }, '미작성')),
      s.basis ? h('div', { class: 'crow' }, h('span', { class: 'k' }, '근거'), h('span', { class: 'v' }, s.basis)) : null,
      s.contract ? h('div', { class: 'crow' }, h('span', { class: 'k' }, '약속'), h('span', { class: 'v' }, s.contract)) : null,
      s.kind !== 'logic' ? h('div', { class: 'crow' }, h('span', { class: 'k' }, '동작'),
        s.ons.length ? h('div', { class: 'v' }, s.ons.map((o) => h('div', { style: 'margin-bottom:6px' }, h('span', { class: 'evt' }, o.event), h('div', null, o.effect)))) : h('span', { class: 'v empty' }, '@on 없음 — 표시만 하는 요소이거나 아직 적지 않았다')) : null,
      memoForm ? memoEditor(c) : h('div', null, h('button', { class: 'smallbtn', onclick: () => c.startMemoFor(s) }, '메모 남기기')));
  };
  el.append(h('div', { class: 'zone' }, '화면 요소', h('small', null, `${dom.length}개`)));
  dom.forEach((s) => el.append(card(s)));
  if (!dom.length) el.append(h('div', { style: 'font-size:12px;color:var(--dim2)' }, '이 화면에서 찾은 컴포넌트가 없다'));
  if (logic.length) { el.append(h('div', { class: 'zone' }, '로직 (화면에 없음)', h('small', null, `${logic.length}개`))); logic.forEach((s) => el.append(card(s))); }
  return el;
}

// ── 메모 ─────────────────────────────────────────────
function targetLabel(t) {
  if (!t) return '화면 전체';
  if (t.type === 'component') return t.title || t.spec;
  if (t.type === 'region') return `화면 영역 · ${t.nearest?.title || '요소 없음'}`;
  if (t.type === 'empty') return '빈 영역';
  return '화면 전체';
}
function targetCard(c, d) {
  const where = d.type === 'component' ? [h('b', null, d.title), h('div', { class: 'mono', style: 'font-size:11px;color:var(--dim)' }, d.file || '')] : [
    h('div', { style: 'display:flex;gap:12px;align-items:center' }, d.shotData ? h('img', { src: d.shotData, style: 'width:120px;max-height:80px;object-fit:contain;border:1px dashed #e0575a;border-radius:4px;background:#fff' }) : h('div', { class: 'thumb' }), h('div', null, h('b', null, d.type === 'empty' ? '빈 영역 — 요소 없음' : '선택한 영역', d.shotData ? ' · 스크린샷 첨부됨' : ''), h('div', { class: 'mono', style: 'font-size:11px;color:var(--dim);margin-top:4px' }, `${d.route || ''} · x ${d.rect.x} y ${d.rect.y} · ${d.rect.w}×${d.rect.h}`))),
    d.type === 'empty'
      ? h('div', { style: 'font-size:12px;line-height:1.7;color:#d9d1c6' }, h('div', null, h('b', null, '주변'), ' (자동 추정 — 위치 힌트로 에이전트에게 간다)'), h('div', null, `위  ${d.neighbors.above || '화면 맨 위 여백'}`), h('div', null, `아래  ${d.neighbors.below || '화면 끝까지 여백'}`))
      : h('div', { style: 'font-size:12px;color:#d9d1c6;line-height:1.6' }, h('b', null, '가장 가까운 컴포넌트'), ' (자동 추정) ', h('div', { class: 'tag', style: 'display:inline-block;margin-top:4px' }, d.nearest ? `${d.nearest.title}` : '없음'), d.nearest?.file ? h('div', { class: 'mono', style: 'font-size:11px;color:var(--dim)' }, d.nearest.file) : null)];
  return h('div', { class: 'target' }, h('div', { class: 'tt' }, '대상'), where);
}
export function memoEditor(c) {
  const d = c.draft;
  const ta = h('textarea', { placeholder: '한 줄로 적어 주세요', oninput: (e) => { c.draftText = e.target.value; } }, c.draftText || '');
  const save = async () => {
    if (!c.draftText?.trim()) return toast('메모 내용을 적어 주세요');
    try {
      const target = { ...d, route: d.route || c.route() };
      if (d.shotData) { target.shot = await c.uploadShot(d.shotData, 'memo'); delete target.shotData; }
      await post('/__spec/memo', { screen: c.sc().name, target, text: c.draftText });
      c.draft = null; c.draftText = ''; await c.refresh(); toast("저장했습니다. 다음: '처리 요청 복사' → 에이전트에 붙여 넣기");
    } catch (e) { toast(e.message); }
  };
  return h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
    d.type !== 'component' ? targetCard(c, d) : null, ta,
    h('div', { style: 'font-size:12px;color:var(--dim);line-height:1.5' }, "저장한 뒤 '처리 요청 복사'를 에이전트에 붙여 넣으면 같이 고칩니다. 붙여 넣기 전까지 메모는 대기로 남습니다."),
    h('div', { class: 'btns', style: 'justify-content:flex-end' }, h('button', { class: 'smallbtn', onclick: () => { c.draft = null; c.draftText = ''; c.render(); } }, '취소'), h('button', { class: 'smallbtn pri', onclick: save }, '저장')));
}
export function memoTab(c) {
  const sc = c.sc();
  const el = h('div', { style: 'display:contents' });
  const mine = c.model.memos.filter((m) => m.screen === sc.name).sort((a, b) => b.id - a.id);
  const n = (s) => mine.filter((m) => m.state === s).length;
  if (c.draft && c.draft.type !== 'component') el.append(h('div', { class: 'sec' }, h('h4', null, `새 메모 — ${c.draft.type === 'empty' ? '화면 영역' : '화면 영역'}`), memoEditor(c)));
  else if (c.draft) el.append(h('div', { class: 'sec' }, h('h4', null, '새 메모 — 컴포넌트'), h('div', { style: 'font-size:12px;color:var(--dim)' }, '컴포넌트 탭의 카드에서 이어서 적는다')));
  else el.append(h('div', { class: 'btns' },
    h('button', { class: 'smallbtn pri', onclick: () => c.startRegion() }, '화면 영역 메모'),
    h('button', { class: 'smallbtn', onclick: () => c.startMemoFor(null) }, '화면 전체 메모'),
    h('button', { class: 'smallbtn', onclick: () => c.setTab('components') }, '컴포넌트에 남기기')));
  el.append(h('div', { class: 'sec' }, h('h4', null, `이 화면의 메모 · ${mine.length}`, h('small', null, `대기 ${n('pending')} · 응답됨 ${n('answered')} · 반영됨 ${n('applied')}`))));
  if (!mine.length) el.append(h('div', { style: 'font-size:12px;color:var(--dim2);line-height:1.6' }, '아직 메모가 없다. 컴포넌트 카드의 "메모 남기기"나 화면 위 영역 선택으로 한 줄을 남기면 된다.'));
  for (const m of mine) {
    el.append(h('div', { class: `mcard${m.state === 'answered' || m.state === 'applied' ? ' sel' : ''}` },
      h('div', { class: 'mtop' }, h('span', { class: 'mtag' }, targetLabel(m.target)), m.kind ? h('span', { class: 'mtag err' }, m.kind) : null, h('span', { class: `mstate ${m.state}` }, m.stateLabel)),
      h('div', { class: 'mmeta' }, `나 · ${fmt(m.at)}${m.state === 'pending' ? (m.copiedAt ? ' · 요청 복사함' : ' · 전달 전') : ''}`),
      h('div', { class: 'mtext' }, m.text),
      m.target?.shot ? h('img', { src: `/__spec/shots/${m.target.shot}`, style: 'max-width:100%;max-height:140px;object-fit:contain;border-radius:6px;border:1px solid var(--line);background:#fff;align-self:flex-start', onerror: (e) => e.target.remove() }) : null,
      m.reply ? h('div', { class: 'reply' }, h('div', { class: 'meta' }, `에이전트 · ${fmt(m.reply.at)}`), m.reply.text) : null,
      m.applied ? h('div', { class: 'diff' }, h('div', { class: 'p' }, `반영: ${m.applied.change || '(내용 없음)'}`), h('div', { class: 'mmeta', style: 'margin-top:4px' }, `커밋 ${m.applied.commit || '—'}`)) : null,
      (m.state === 'answered' || m.state === 'applied') ? h('div', { class: 'btns', style: 'justify-content:flex-end' }, h('button', { class: 'smallbtn pri', onclick: async () => { await post('/__spec/memo/confirm', { id: m.id }); c.refresh(); } }, '확인 완료')) : null));
  }
  return el;
}

// ── 승인 ─────────────────────────────────────────────
function stepper(st) {
  const s = st.status;
  const cls = [s === 'dev' ? 'cur' : 'done', s === 'dev' ? '' : s === 'test-requested' ? 'cur' : s === 'needs-fix' ? 'warn' : 'done', s === 'approved' ? 'done' : s === 'approved-changed' ? 'amber' : ''];
  const mark = [cls[0] === 'done' ? '✓' : '1', cls[1] === 'done' ? '✓' : cls[1] === 'warn' ? '!' : '2', cls[2] === 'done' ? '✓' : cls[2] === 'amber' ? '!' : '3'];
  const step = (i, label) => h('div', { class: `step ${cls[i]}` }, h('i', null, mark[i]), label);
  return h('div', { class: 'stepper' }, step(0, '개발 중'), h('div', { class: 'stline' }), step(1, '테스트 요청'), h('div', { class: 'stline' }), step(2, s === 'approved-changed' ? '승인 후 변경됨' : '승인'));
}
export function approval(c) {
  const sc = c.sc(), st = sc.status;
  const el = h('div', { style: 'display:contents' });
  el.append(stepper(st));
  const approve = async () => { try { const shot = await c.uploadShot(await c.capture(), 'approve'); await post('/__spec/status.json', { screen: sc.name, status: 'approved', shot }); c.ap = { problem: false }; await c.refresh(); toast('승인했습니다. 이 소스 버전이 기준이 됩니다'); } catch (e) { toast(e.message); } };
  const doneN = sc.does.filter((_, i) => st.checks && st.checks[i]).length;
  const allDone = !sc.does.length || doneN === sc.does.length;
  const checklist = () => h('div', { class: 'checks' },
    h('div', { style: 'display:flex;justify-content:space-between;font-size:13px' }, h('span', null, h('b', null, '확인 목록'), h('span', { style: 'color:var(--dim)' }, ' — 이 화면의 "사용자가 하는 일"')), h('span', { style: 'color:var(--green);font-weight:700' }, `${doneN} / ${sc.does.length}`)),
    sc.does.map((d, i) => h('div', { class: `ck${st.checks && st.checks[i] ? ' done' : ''}`, onclick: async () => { await post('/__spec/check', { screen: sc.name, index: i, done: !(st.checks && st.checks[i]) }); c.refresh(); } },
      h('span', { class: 'box' }, st.checks && st.checks[i] ? '✓' : ''), h('div', null, h('b', null, d.title), d.check ? h('small', null, d.check) : null))));
  const problemForm = () => {
    const ap = c.ap;
    const radios = [['screen', '이 화면 전체'], ...sc.does.map((d, i) => [`item:${i}`, `확인 목록 항목: ${d.title}`]), ['region', '화면 영역을 끌어서 고르기 (왼쪽 화면에서)']];
    const ta = h('textarea', { placeholder: '무엇이 문제인가요? 한 줄로 적어 주세요', oninput: (e) => { ap.text = e.target.value; } }, ap.text || '');
    return h('div', { class: 'apcard red' }, h('h5', null, '문제 있음 — 오류로 기록'),
      h('div', { style: 'font-size:12px;color:var(--dim);margin-bottom:6px' }, '어디에서 생긴 문제인가'),
      radios.map(([v, l]) => h('div', { class: `rad${(ap.target || 'screen') === v ? ' on' : ''}`, onclick: () => { ap.target = v; if (v === 'region') c.startRegion({ forError: true }); c.render(); } }, h('i'), l)),
      ap.region ? h('div', { style: 'margin:8px 0' }, targetCard(c, ap.region)) : null, ta,
      h('div', { style: 'font-size:12px;color:var(--dim);margin:8px 0' }, `지금 소스 버전(${st.commit || '—'})과 함께 저장된다.`),
      h('div', { class: 'btns', style: 'justify-content:flex-end' }, h('button', { class: 'smallbtn', onclick: () => { c.ap = { problem: false }; c.render(); } }, '취소'),
        h('button', { class: 'smallbtn', style: 'background:#ff9d9d;color:#2a1214;border-color:#ff9d9d;font-weight:700', onclick: async () => {
          if (!ap.text?.trim()) return toast('문제를 한 줄로 적어 주세요');
          const t = ap.target || 'screen';
          const target = t === 'region' && ap.region ? { ...ap.region } : { type: 'screen', route: c.route() };
          if (target.shotData) { target.shot = await c.uploadShot(target.shotData, 'memo'); delete target.shotData; }
          const text = t.startsWith('item:') ? `[${sc.does[Number(t.slice(5))].title}] ${ap.text}` : ap.text;
          try { await post('/__spec/memo', { screen: sc.name, target, text, kind: '오류' }); await post('/__spec/status.json', { screen: sc.name, status: 'needs-fix', note: text }); c.ap = { problem: false }; await c.refresh(); toast("오류로 저장했습니다. '처리 요청 복사'로 에이전트에 알려 주세요"); } catch (e) { toast(e.message); }
        } }, '오류로 저장'))); };
  if (c.ap?.problem) { el.append(problemForm(), h('div', { class: 'hbox' }, h('span', null, '저장하면 → 상태가 '), h('b', { style: 'color:var(--red)' }, '수정 필요'), h('span', null, '로 바뀌고, 이 메모는 사용자가 "처리 요청 복사"를 붙여 넣을 때 에이전트가 읽는다. 고쳐지면 다시 "테스트 요청"이 된다.'))); return el; }
  if (st.status === 'dev') {
    el.append(h('div', { class: 'hbox' }, '아직 개발 중입니다. 에이전트가 자체 점검(경고 0, 화면 열림, 설계서 보기 열림)을 마치고 "테스트 요청"을 남기면, 이곳에 확인 목록과 승인이 열립니다.'));
  } else if (st.status === 'test-requested') {
    el.append(h('div', { class: 'msg' }, h('div', { class: 'meta' }, `에이전트 · ${fmt(st.at)} · 소스 버전 ${st.commit || '—'}`), st.note || '테스트를 요청했습니다. 아래 순서로 눌러 보고 확인해 주세요.'));
    el.append(checklist());
    el.append(h('div', { class: 'btns' }, h('button', { class: 'smallbtn bad', style: 'min-height:38px;padding:0 18px', onclick: () => { c.ap = { problem: true }; c.render(); } }, '문제 있음'),
      h('button', { class: `smallbtn ${allDone ? 'good' : ''}`, style: 'min-height:38px;padding:0 18px', disabled: allDone ? null : true, onclick: approve }, allDone ? '승인' : '승인 (모두 확인하면 켜짐)')));
    el.append(h('div', { style: 'font-size:12px;color:var(--dim);line-height:1.6' }, '문제는 "문제 있음"으로 메모에 남긴다. 승인하면 이 소스 버전이 기준이 되고, 승인한 사람과 시각이 기록된다.'));
  } else if (st.status === 'needs-fix') {
    el.append(h('div', { class: 'apcard red' }, h('h5', null, '수정 필요'), h('div', { class: 'kv' }, kv('기록한 사람', st.by === 'user' ? '사용자' : '에이전트'), kv('시각', fmt(st.at)), kv('내용', st.note || '—'))));
    el.append(h('div', { class: 'hbox' }, '에이전트가 이 메모를 읽고 고친 뒤 다시 "테스트 요청"을 남기면 확인 목록이 다시 열린다. 메모 탭에서 "처리 요청 복사"를 붙여 넣으면 에이전트가 읽는다.'));
  } else if (st.status === 'approved') {
    el.append(h('div', { class: 'apcard' }, h('h5', null, '승인됨'), h('div', { class: 'kv' }, kv('승인한 사람', '사용자'), kv('시각', fmt(st.at)), kv('소스 버전', h('b', { class: 'mono' }, st.commit || '—')), kv('기준 화면', st.shot ? h('img', { src: `/__spec/shots/${st.shot}`, style: 'max-width:100%;max-height:150px;border-radius:6px;border:1px solid var(--line);background:#fff', onerror: (e) => e.target.replaceWith('스크린샷 없음') }) : '저장 안 됨'), kv('확인한 것', sc.does.length ? `${sc.does.map((d) => d.title).join(' · ')} (${doneN}/${sc.does.length})` : '확인 목록 없음'))));
    el.append(h('div', { class: 'hbox' }, h('span', null, '이후 이 화면의 소스가 바뀌면 자동으로 '), h('b', { style: 'color:var(--amber)' }, '승인 후 변경됨'), h('span', null, '이 되고, 바뀐 곳을 보고 다시 승인한다.')));
    el.append(h('div', { class: 'btns' }, h('button', { class: 'smallbtn', onclick: async () => { await post('/__spec/status.json', { screen: sc.name, status: 'dev', note: '승인 취소' }); c.refresh(); } }, '승인 취소'), h('button', { class: 'smallbtn pri', onclick: () => c.setTab('history') }, '히스토리 보기 ›')));
  } else if (st.status === 'approved-changed') {
    const box = h('div', { class: 'apcard amber' }, h('h5', null, '승인 후 변경됨', h('span', { class: 'mmeta', style: 'float:right;font-weight:400' }, `마지막 승인 ${fmt(st.at)} · ${st.commit || '—'}`)),
      h('div', { style: 'font-size:13px;line-height:1.55;margin-bottom:10px' }, `이 화면이 쓰는 소스(화면 파일과 불러 쓰는 파일 ${st.files}개)가 승인 뒤 바뀌었다. 지금 모습을 확인하고 승인하면 이 상태가 새 기준이 된다.`));
    const nowImg = h('div', { style: 'font-size:12px;color:var(--dim)' }, '지금 화면을 찍는 중…');
    c.capture().then((d) => { if (d) nowImg.replaceWith(h('img', { src: d, style: 'width:100%;border-radius:6px;background:#fff' })); else nowImg.textContent = '캡처하지 못했다'; });
    box.append(h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;font-size:12px;color:var(--dim)' },
      h('div', null, h('div', { style: 'margin-bottom:4px' }, '승인 때'), st.shot ? h('img', { src: `/__spec/shots/${st.shot}`, style: 'width:100%;border-radius:6px;background:#fff', onerror: (e) => e.target.replaceWith('스크린샷 없음') }) : '저장된 스크린샷 없음'),
      h('div', null, h('div', { style: 'margin-bottom:4px' }, '지금'), nowImg)));
    const list = h('div', null, h('div', { style: 'font-size:12px;color:var(--dim)' }, '그 뒤 바뀐 것을 읽는 중…')); box.append(list);
    get(`/__spec/history.json?screen=${encodeURIComponent(sc.name)}`).then(({ items }) => {
      const after = items.filter((i) => i.type === 'commit' && i.at > st.at);
      list.replaceChildren(h('div', { style: 'font-size:13px;font-weight:700;margin-bottom:6px' }, `그 뒤 바뀐 것 · ${after.length}`), after.length ? after.map((i) => h('div', { style: 'padding:8px 10px;border-radius:8px;background:#14161f;margin-bottom:6px;font-size:12px' }, h('span', { class: `kindtag ${i.kind === '오류 수정' ? 'k2' : 'k1'}` }, i.kind), i.title, h('div', { class: 'mmeta mono', style: 'margin-top:4px' }, `${i.hash} · ${fmt(i.at)}${i.request ? ` · 요청: ${i.request.split('—')[0].trim()}` : ''}`))) : h('div', { style: 'font-size:12px;color:var(--dim)' }, '아직 커밋되지 않은 변경입니다(작업 중인 파일).'));
    }).catch(() => {});
    box.append(h('div', { class: 'btns', style: 'margin-top:10px' }, h('button', { class: 'smallbtn bad', onclick: () => { c.ap = { problem: true }; c.render(); } }, '문제 있음 (메모로)'), h('button', { class: 'smallbtn good', onclick: approve }, '이대로 승인')),
      h('div', { style: 'font-size:12px;color:var(--dim);margin-top:10px;line-height:1.5' }, '승인하면 날짜·승인한 사람·소스 버전이 기록되고 이 소스가 기준으로 저장된다.'));
    el.append(box);
  }
  return el;
}

// ── 히스토리 ─────────────────────────────────────────
export function history(c) {
  const sc = c.sc();
  const el = h('div', { style: 'display:contents' });
  const holder = h('div', { class: 'tl' }, h('div', { style: 'font-size:12px;color:var(--dim)' }, '읽는 중…'));
  const chips = h('div', { class: 'chips' });
  el.append(chips, holder);
  get(`/__spec/history.json?screen=${encodeURIComponent(sc.name)}`).then(({ items }) => {
    const kinds = ['전체', '오류 수정', '변경', '승인'];
    const count = (k) => (k === '전체' ? items.length : items.filter((i) => i.kind === k).length);
    const draw = () => {
      chips.replaceChildren(...kinds.map((k) => h('button', { class: `pill${c.hFilter === k ? ' sel' : ''}`, style: 'min-height:30px;font-size:12px', onclick: () => { c.hFilter = k; draw(); } }, `${k} · ${count(k)}`)));
      const shown = items.filter((i) => c.hFilter === '전체' || i.kind === c.hFilter);
      const touched = (i) => ({ specs: c.model.specs.filter((x) => (i.touchedSpecs || []).includes(x.id)), infos: i.touchedInfos || [] });
      const pick = (i) => { c.hSel = c.hSel === i.hash + i.at ? null : i.hash + i.at; c.setHL(new Set(c.hSel ? touched(i).specs.map((x) => x.id) : [])); draw(); };
      holder.replaceChildren(...(shown.length ? shown.map((i) => h('div', { class: `ev${c.hSel === i.hash + i.at ? ' sel' : ''}`, style: 'cursor:pointer', onclick: () => pick(i) },
        h('div', { class: `dot${i.kind === '오류 수정' ? ' err' : i.kind === '승인' ? ' ap' : i.kind === '수정 필요' ? ' err' : i.kind === '테스트 요청' ? ' ap' : ''}` }),
        h('div', { class: 'body' },
          h('div', { class: 'tit' }, h('span', { class: `kindtag ${i.kind === '오류 수정' || i.kind === '수정 필요' ? 'k2' : i.kind === '변경' ? 'k1' : 'k3'}` }, i.kind), i.title || (i.kind === '승인' ? `${sc.name} 승인 (${i.author})` : i.kind)),
          h('div', { class: 'meta mono' }, `${i.hash || '—'} · ${fmt(i.at)}${i.request ? ` · 요청: ${i.request.split('—')[0].trim()}` : ''}${i.files ? ` · 파일 ${i.files}` : ''}`),
          c.hSel === i.hash + i.at ? (() => {
            const t = touched(i); const fieldChips = t.infos.flatMap((x) => (x.fields.length ? x.fields.map((f) => ({ info: x.name, prop: f })) : [{ info: x.name, prop: null }]));
            const more = (n) => (n > 6 ? h('span', { class: 'mmeta' }, `외 ${n - 6}개`) : null);
            return h('div', { class: 'dec', style: 'border:1px solid var(--accent-deep)' },
              h('div', { style: 'font-weight:700;margin-bottom:2px' }, '이 변경이 바꾼 것'),
              h('div', { style: 'color:var(--dim);font-size:12px;margin-bottom:8px' }, '이 변경에서 실제로 고친 부분이 걸린 화면 요소와 정보다. 화면 요소는 왼쪽 화면에 강조된다.'),
              t.specs.length ? h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, h('span', { class: 'mmeta', style: 'flex:none;width:56px' }, '화면 요소'), t.specs.slice(0, 6).map((x) => h('span', { class: 'tag' }, x.title)), more(t.specs.length)) : null,
              fieldChips.length ? h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'mmeta', style: 'flex:none;width:56px' }, '정보'), fieldChips.slice(0, 6).map((f) => h('button', { class: 'tag', style: 'cursor:pointer', onclick: (ev) => { ev.stopPropagation(); c.openInfo(f.info, f.prop || undefined); } }, f.prop ? `${f.info}.${f.prop}` : f.info)), more(fieldChips.length)) : null,
              !t.specs.length && !fieldChips.length ? h('div', { style: 'font-size:12px;color:var(--dim)' }, '화면 요소와 정보 정의는 그대로다. 안쪽 동작이나 모양만 바뀌었다.') : null); })() : null,
          i.decisions.length || i.rejections.length || i.cause ? h('div', { class: 'dec' }, i.cause ? h('div', null, `원인: ${i.cause}`) : null, i.decisions.map((d) => h('div', null, `결정: ${d}`)), i.rejections.map((d) => h('div', null, `기각: ${d}`))) : null))) : [h('div', { style: 'font-size:12px;color:var(--dim2);line-height:1.6' }, '아직 이력이 없다. 이 화면의 소스를 바꾼 커밋과 승인 기록이 여기에 쌓인다.')]));
    };
    draw();
  }).catch((e) => holder.replaceChildren(h('div', { class: 'note' }, `이력을 읽지 못했다: ${e.message}`)));
  return el;
}
