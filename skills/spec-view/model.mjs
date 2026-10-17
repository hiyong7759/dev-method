// 설계서 보기 화면이 읽는 모델 한 덩어리 — 주석 태그(extract), 타입 분석(analyze-ts), 상태·메모(.spec), 계산한 관계와 흐름을 합친다.
// 존재 이유: 화면(뷰어)이 소스를 직접 해석하지 않고, 읽기 전용으로 계산된 결과만 그리게 하려고. 저장물 없이 요청 때마다 소스에서 다시 만든다(.spec의 승인·메모만 저장).
import fs from 'node:fs';
import path from 'node:path';
import { extractSpecs } from './extract.mjs';
import { analyzeTs } from './analyze-ts.mjs';
import { allStatus, projectRoot, LABEL } from './status.mjs';
import { loadMemos, STATE_LABEL } from './memo.mjs';
import { detectNav } from './nav.mjs';

const clean = (d) => (d || '').replace(/\s*@\w+[^\n]*/g, '').trim();
const UI_EXT = /\.(tsx|jsx|vue|svelte)$/;
const NONINFO = /@nonInfo\b/;

// 필드 읽기·쓰기 위치를 가장 가까운 앞 @spec에 붙인다(주석이 컴포넌트 바로 위에 있다는 규칙을 이용한 추정)
function nearestSpec(specs, file, line) {
  let best = null;
  for (const s of specs) if (s.file === file && s.line <= line && (!best || s.line > best.line)) best = s;
  return best;
}

// 타입 분석은 느리다(수백 ms). 소스 파일의 수정 시각·크기가 그대로면 지난 결과를 쓴다.
const cache = new Map();
function signature(root) {
  const parts = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist' || e.name === 'build') continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f, depth + 1);
      else if (/\.(tsx?|jsx?|json)$/.test(e.name)) { const st = fs.statSync(f); parts.push(`${f}:${st.mtimeMs}:${st.size}`); }
    }
  };
  walk(root, 0);
  return parts.join('|');
}
function cachedAnalysis(root) {
  const sig = signature(root);
  const hit = cache.get(root);
  if (hit && hit.sig === sig) return hit.value;
  const value = analyzeTs(root);
  cache.set(root, { sig, value });
  return value;
}

const navCache = new Map();
function cachedNav(scanRoot, root, out) {
  const sig = signature(root);
  const hit = navCache.get(scanRoot);
  if (hit && hit.sig === sig) return hit.value;
  const value = detectNav(scanRoot, root, out);
  navCache.set(scanRoot, { sig, value });
  return value;
}

export function buildModel(scanRoot) {
  const out = extractSpecs(scanRoot);
  const root = projectRoot(scanRoot);
  const rel = (f) => path.relative(scanRoot, path.join(root, f)); // 분석 경로(프로젝트 루트 기준) → 소스 폴더 기준
  const status = allStatus(scanRoot, out);
  const memos = loadMemos(scanRoot).memos;
  let revealMap = {};
  try { revealMap = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'reveal.json'), 'utf8')); } catch { /* 없음 */ }
  for (const sp of out.specs) { for (const n of sp.screens) { if (revealMap[n]?.[sp.id]) { sp.reveal = revealMap[n][sp.id]; break; } } }
  const nav = cachedNav(scanRoot, root, out);
  out.warnings.push(...nav.warnings);

  // ── 정보 ─────────────────────────────────────────────
  let analysis = { infos: [] };
  let analysisError = '';
  try { analysis = cachedAnalysis(root); } catch (e) { analysisError = String(e.message); }
  const infos = analysis.infos
    .filter((i) => i.props.length && !NONINFO.test(i.doc || ''))
    .map((i) => ({ name: i.name, file: i.file, fileSrc: path.relative(scanRoot, path.join(root, i.file)), line: i.line, unused: i.unused, doc: i.doc.replace(/@\w+[^\n]*/g, '').trim(), props: i.props }));
  const infoByName = new Map(infos.map((i) => [i.name, i]));

  // 정보 관계: <이름>Id 필드 = 그 정보를 가리킨다(소유 관계). 필드 주석의 @ref 대상.필드 = 약한 연결
  const relations = [];
  const findTarget = (prefix) => {
    const want = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    if (infoByName.has(want)) return infoByName.get(want);
    const hits = infos.filter((i) => i.name.endsWith(want));
    return hits.length === 1 ? hits[0] : null;
  };
  for (const i of infos) for (const p of i.props) {
    const m = p.name.match(/^(.+)Id$/);
    if (m && p.name !== 'id') { const t = findTarget(m[1]); if (t && t.name !== i.name) relations.push({ from: i.name, to: t.name, field: p.name, fieldDoc: clean(p.doc), weak: false, many: p.optional ? '0..N' : 'N' }); }
    const r = (p.doc || '').match(/@ref\s+(\w+)\.(\w+)/);
    if (r && infoByName.has(r[1])) relations.push({ from: i.name, to: r[1], field: p.name, fieldDoc: clean(p.doc), weak: true, many: 'N', targetField: r[2] });
  }

  // ── 화면과 정보의 흐름 ───────────────────────────────
  const screenOfFile = (file) => out.screens.filter((s) => s.files.includes(rel(file))).map((s) => s.name);
  const fieldRoles = {}; // info.field → { shown, input, modify, judge: Set }
  const screenFields = Object.fromEntries(out.screens.map((s) => [s.name, new Map()]));
  const specsOfScreen = (name) => out.specs.filter((s) => s.screens.includes(name));
  for (const i of infos) {
    i.flow = { shown: new Set(), input: new Set(), modify: new Set(), judge: new Set() };
    for (const p of i.props) {
      const roles = { shown: new Set(), input: new Set(), modify: new Set(), judge: new Set() };
      p.evidence = [];
      for (const ref of p.refs || []) {
        const ui = UI_EXT.test(ref.file);
        const owners = screenOfFile(ref.file);
        const sp = nearestSpec(out.specs, rel(ref.file), ref.line);
        if (!ref.write) {
          if (ui) { owners.forEach((n) => { roles.shown.add(n); addField(n, i, p, 'shown', sp, ref.dom); }); if (owners.length) p.evidence.push({ role: 'shown', who: owners.join('·'), file: rel(ref.file), line: ref.line, kind: ref.kind }); }
          else if (!/\/(mock|seed|fixtures?)\//.test(ref.file)) { const who = sp?.title || path.basename(ref.file); roles.judge.add(who); p.evidence.push({ role: 'judge', who, file: rel(ref.file), line: ref.line, kind: ref.kind }); }
        } else if (ui) {
          const k = ref.kind === 'create' ? 'input' : 'modify';
          owners.forEach((n) => { roles[k].add(n); addField(n, i, p, k, sp, ref.dom); });
          if (owners.length) p.evidence.push({ role: k, who: owners.join('·'), file: rel(ref.file), line: ref.line, kind: ref.kind });
        }
      }
      { const seenEv = new Set(); p.evidence = p.evidence.filter((e) => { const k = `${e.role}|${e.file}|${e.line}`; if (seenEv.has(k)) return false; seenEv.add(k); return true; }); }
      p.roles = Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, [...v]]));
      for (const k of Object.keys(roles)) roles[k].forEach((v) => i.flow[k].add(v));
    }
  }
  function addField(screenName, info, prop, role, sp, dom) {
    const key = `${info.name}.${prop.name}`;
    const m = screenFields[screenName];
    if (!m.has(key)) m.set(key, { info: info.name, prop: prop.name, doc: clean(prop.doc), roles: new Set(), specs: new Set(), doms: new Map() });
    const f = m.get(key); f.roles.add(role); if (sp) f.specs.add(sp.id);
    if (dom) f.doms.set(`${dom.mode}|${dom.sel}`, dom);
  }

  // ── 화면 흐름: 들어오는 길, 단계(시작에서 몇 번째) ───────────
  const incoming = Object.fromEntries(out.screens.map((s) => [s.name, []]));
  let moves = 0;
  for (const s of out.screens) for (const t of s.to) if (incoming[t.target]) { incoming[t.target].push({ from: s.name, action: t.action, pass: t.pass }); moves++; }
  const stage = {};
  // 시작 화면: @start가 있으면 그 화면. 없으면 들어오는 길이 가장 적은 화면(같으면 주소가 짧은 쪽). 서로 오가는 화면만 있어도 시작이 정해진다
  const flagged = out.screens.filter((s) => s.start).map((s) => s.name);
  const byIn = [...out.screens].sort((a, b) => incoming[a.name].length - incoming[b.name].length || (a.route || '').length - (b.route || '').length);
  const starts = flagged.length ? flagged : out.screens.filter((s) => !incoming[s.name].length).map((s) => s.name);
  const queue = (starts.length ? starts : byIn.slice(0, 1).map((s) => s.name)).map((n) => { stage[n] = 0; return n; });
  while (queue.length) { const n = queue.shift(); for (const t of out.screens.find((s) => s.name === n).to) if (stage[t.target] === undefined && incoming[t.target]) { stage[t.target] = stage[n] + 1; queue.push(t.target); } }
  out.screens.forEach((s) => { if (stage[s.name] === undefined) stage[s.name] = 0; });

  // ── 화면별 모델 ──────────────────────────────────────
  const screens = out.screens.map((s) => {
    const specs = specsOfScreen(s.name);
    const mine = memos.filter((m) => m.screen === s.name);
    const fields = [...screenFields[s.name].values()].map((f) => ({ ...f, roles: [...f.roles], specs: [...f.specs], doms: [...f.doms.values()] }));
    const missing = specs.filter((x) => !x.why).length + (s.why ? 0 : 1);
    const warns = out.warnings.filter((w) => s.files.some((f) => w.includes(`(${f}:`)));
    const st = status[s.name];
    return {
      ...s, to: s.to.map((t) => ({ ...t, verified: nav.edges.some((e) => e.from === s.name && e.to === t.target) || t.target === s.name })), stage: stage[s.name], incoming: incoming[s.name], status: st,
      specIds: specs.map((x) => x.id), fields, infoCount: new Set(fields.map((f) => f.info)).size,
      memoCount: mine.length, memoPending: mine.filter((m) => m.state === 'pending').length,
      missing, warnings: warns,
    };
  });

  // ── 확인 필요(화면 흐름 왼쪽 안내) ───────────────────
  const notes = [];
  for (const s of screens) if (!s.to.length && screens.length > 1) notes.push({ screen: s.name, text: `${s.name} 화면에서 다른 화면으로 나가는 길이 없다 (돌아가기 포함)` });
  for (const i of infos) if (i.flow.shown.size && !i.flow.input.size && !i.flow.modify.size) notes.push({ info: i.name, text: `${i.name}은 ${[...i.flow.shown].join('·')}에서 보여주지만 어느 화면에서도 입력하지 않는다` });

  const infoOut = infos.map((i) => ({
    name: i.name, file: i.file, fileSrc: i.fileSrc, line: i.line, doc: i.doc, unused: i.unused,
    flow: Object.fromEntries(Object.entries(i.flow).map(([k, v]) => [k, [...v]])),
    props: i.props.map((p) => ({ name: p.name, type: p.type, optional: p.optional, doc: clean(p.doc), line: p.line, status: p.status, roles: p.roles, evidence: (p.evidence || []).slice(0, 12) })),
    flagged: i.props.filter((p) => !clean(p.doc) || p.status !== 'rw').length,
    unfilled: i.props.filter((p) => !p.doc).length,
  }));

  const pendingCopy = memos.filter((m) => m.state === 'pending' && !m.copiedAt).length;
  return {
    project: path.basename(root), generatedAt: new Date().toISOString(),
    screens, specs: out.specs, infos: infoOut, relations, notes, warnings: out.warnings, analysisError,
    memos: memos.map((m) => ({ ...m, stateLabel: STATE_LABEL[m.state] })),
    summary: {
      screens: screens.length, moves, infos: infos.length, relations: relations.length,
      waiting: screens.filter((s) => ['test-requested', 'approved-changed'].includes(s.status.status)).length,
      testRequested: screens.filter((s) => s.status.status === 'test-requested').length,
      changedAfterApproval: screens.filter((s) => s.status.status === 'approved-changed').length,
      memosUndelivered: pendingCopy, needCheck: out.warnings.length + notes.length,
    },
    labels: LABEL,
  };
}
