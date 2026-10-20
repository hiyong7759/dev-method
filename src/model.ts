/**
 * @spec model 설계서 보기 모델
 * @why 화면(뷰어)이 소스를 직접 해석하지 않고, 읽기 전용으로 계산된 결과만 그리게 한다. 주석 태그(extract), 타입 분석(analyze-ts), 상태·메모·요청(.spec), 계산한 관계와 흐름을 한 덩어리로 합친다.
 * @basis 저장물 없이 요청 때마다 소스에서 다시 만든다. 저장하는 것은 .spec의 승인·메모·요청뿐이다. 타입 분석은 느리므로(수백 ms) 소스 파일의 수정 시각과 크기가 그대로면 지난 결과를 쓴다.
 * @contract 만드는 모양은 types.ts의 Model이다. 이 모양을 바꾸면 viewer/ 아래 화면 파일이 함께 바뀌어야 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractSpecs } from './extract.js';
import { analyzeTs } from './analyze-ts.js';
import { allStatus, projectRoot, LABEL } from './status.js';
import { loadMemos, STATE_LABEL } from './memo.js';
import { loadRequests, describeRequests } from './request.js';
import { detectNav } from './nav.js';
import { errorText } from './cli.js';
import type {
  Analysis, AnalyzedInfo, DomHint, Evidence, Extracted, Incoming, Model, ModelInfo, ModelScreen, NavResult, Note, Relation,
  RevealStep, Role, ScreenField, Spec,
} from './types.js';

/** 설명 글에서 @태그가 달린 줄을 뺀 글 */
const clean = (d: string | undefined): string => (d || '').replace(/\s*@\w+[^\n]*/g, '').trim();
/** 화면을 그리는 파일(여기서 읽는 값이 "보여줌"이 된다) */
const UI_EXT = /\.(tsx|jsx|vue|svelte)$/;
/** 정보가 아닌 타입에 다는 표시 */
const NONINFO = /@nonInfo\b/;
const ROLES: Role[] = ['shown', 'input', 'modify', 'judge'];

/** 필드 읽기·쓰기 위치를 가장 가까운 앞 @spec에 붙인다(주석이 컴포넌트 바로 위에 있다는 규칙을 이용한 추정) */
function nearestSpec(specs: Spec[], file: string, line: number): Spec | null {
  let best: Spec | null = null;
  for (const s of specs) if (s.file === file && s.line <= line && (!best || s.line > best.line)) best = s;
  return best;
}

/** 소스 파일들의 수정 시각과 크기를 이은 글. 이게 같으면 소스가 그대로라는 뜻 */
function signature(root: string): string {
  const parts: string[] = [];
  const walk = (dir: string, depth: number): void => {
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

/** 지난 결과를 기억해 두는 곳: 열쇠 → 그때의 소스 서명과 결과 */
type Cached<T> = Map<string, { sig: string; value: T }>;
const analysisCache: Cached<Analysis> = new Map();
const navCache: Cached<NavResult> = new Map();

/** 소스가 그대로면 지난 타입 분석을 쓴다 */
function cachedAnalysis(root: string): Analysis {
  const sig = signature(root);
  const hit = analysisCache.get(root);
  if (hit && hit.sig === sig) return hit.value;
  const value = analyzeTs(root);
  analysisCache.set(root, { sig, value });
  return value;
}
/** 소스가 그대로면 지난 이동 대조를 쓴다 */
function cachedNav(scanRoot: string, root: string, out: Extracted): NavResult {
  const sig = signature(root);
  const hit = navCache.get(scanRoot);
  if (hit && hit.sig === sig) return hit.value;
  const value = detectNav(scanRoot, root, out);
  navCache.set(scanRoot, { sig, value });
  return value;
}

/** 역할별로 모은 이름 집합 */
type RoleSets = Record<Role, Set<string>>;
const newRoleSets = (): RoleSets => ({ shown: new Set(), input: new Set(), modify: new Set(), judge: new Set() });
const listOf = (s: RoleSets): Record<Role, string[]> => ({ shown: [...s.shown], input: [...s.input], modify: [...s.modify], judge: [...s.judge] });

/** 화면이 다루는 필드를 모으는 중의 모습 */
interface FieldAcc { info: string; prop: string; doc: string; roles: Set<Role>; specs: Set<string>; doms: Map<string, DomHint> }

/** 소스 폴더에서 설계서 보기 모델 한 덩어리를 새로 만든다 */
export function buildModel(scanRoot: string): Model {
  const out = extractSpecs(scanRoot);
  const root = projectRoot(scanRoot);
  const rel = (f: string): string => path.relative(scanRoot, path.join(root, f)); // 분석 경로(프로젝트 루트 기준) → 소스 폴더 기준
  const status = allStatus(scanRoot, out);
  const memos = loadMemos(scanRoot).memos;
  let revealMap: Record<string, Record<string, RevealStep[]>> = {};
  try { revealMap = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'reveal.json'), 'utf8')); } catch { /* 없음 */ }
  for (const sp of out.specs) {
    if (sp.open.length) sp.reveal = sp.open;
    else for (const n of sp.screens) { const found = revealMap[n]?.[sp.id]; if (found) { sp.reveal = found; break; } }
  }
  const nav = cachedNav(scanRoot, root, out);
  out.warnings.push(...nav.warnings);

  // ── 정보 ─────────────────────────────────────────────
  let analysis: Analysis | null = null;
  let analysisError = '';
  try { analysis = cachedAnalysis(root); } catch (e) { analysisError = errorText(e); }
  const kept: AnalyzedInfo[] = (analysis?.infos ?? []).filter((i) => i.props.length && !NONINFO.test(i.doc || ''));
  const infos: ModelInfo[] = kept.map((i) => ({
    name: i.name, file: i.file, fileSrc: path.relative(scanRoot, path.join(root, i.file)), line: i.line, unused: i.unused, kind: 'internal', doc: clean(i.doc),
    flow: { shown: [], input: [], modify: [], judge: [] }, flagged: 0, unfilled: i.props.filter((p) => !p.doc).length,
    props: i.props.map((p) => ({ name: p.name, type: p.type, optional: p.optional, doc: clean(p.doc), line: p.line, status: p.status, roles: { shown: [], input: [], modify: [], judge: [] }, evidence: [] })),
  }));
  const infoByName = new Map(infos.map((i) => [i.name, i]));

  // 정보 관계: <이름>Id 필드 = 그 정보를 가리킨다(소유 관계). 필드 주석의 @ref 대상.필드 = 약한 연결
  const relations: Relation[] = [];
  const findTarget = (prefix: string): ModelInfo | null => {
    const want = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    const exact = infoByName.get(want);
    if (exact) return exact;
    const hits = infos.filter((i) => i.name.endsWith(want));
    return hits.length === 1 ? hits[0] : null;
  };
  kept.forEach((ai, k) => {
    const i = infos[k];
    for (const p of ai.props) {
      const m = p.name.match(/^(.+)Id$/);
      if (m && p.name !== 'id') {
        const t = findTarget(m[1]);
        if (t && t.name !== i.name) relations.push({ from: i.name, to: t.name, field: p.name, fieldDoc: clean(p.doc), weak: false, many: p.optional ? '0..N' : 'N' });
      }
      // 필드의 타입이 다른 정보를 담으면(예: screens: ModelScreen[]) 그 정보를 품은 관계다
      for (const other of infoByName.keys()) {
        if (other !== i.name && new RegExp(`\\b${other}\\b`).test(p.type || '') && !relations.some((x) => x.from === i.name && x.to === other && x.field === p.name)) relations.push({ from: i.name, to: other, field: p.name, fieldDoc: clean(p.doc), weak: false, many: /\[\]|Record|Map|Set/.test(p.type || '') ? 'N' : p.optional ? '0..1' : '1' });
      }
      const r = (p.doc || '').match(/@ref\s+(\w+)\.(\w+)/);
      if (r && infoByName.has(r[1])) relations.push({ from: i.name, to: r[1], field: p.name, fieldDoc: clean(p.doc), weak: true, many: 'N', targetField: r[2] });
    }
  });

  // ── 화면과 정보의 흐름 ───────────────────────────────
  const screenOfFile = (file: string): string[] => out.screens.filter((s) => s.files.includes(rel(file))).map((s) => s.name);
  const screenFields: Record<string, Map<string, FieldAcc>> = Object.fromEntries(out.screens.map((s) => [s.name, new Map<string, FieldAcc>()]));
  const addField = (screenName: string, info: ModelInfo, propName: string, propDoc: string, role: Role, sp: Spec | null, dom: DomHint | null): void => {
    const key = `${info.name}.${propName}`;
    const m = screenFields[screenName];
    let f = m.get(key);
    if (!f) { f = { info: info.name, prop: propName, doc: propDoc, roles: new Set(), specs: new Set(), doms: new Map() }; m.set(key, f); }
    f.roles.add(role);
    if (sp) f.specs.add(sp.id);
    if (dom) f.doms.set(`${dom.mode}|${dom.sel}`, dom);
  };
  const specsOfScreen = (name: string): Spec[] => out.specs.filter((s) => s.screens.includes(name));
  kept.forEach((ai, k) => {
    const info = infos[k];
    const flow = newRoleSets();
    ai.props.forEach((p, pk) => {
      const roles = newRoleSets();
      const evidence: Evidence[] = [];
      for (const ref of p.refs) {
        const owners = screenOfFile(ref.file);
        // 화면 파일(@screen이 있거나 거기서 불러오는 파일)에서 읽고 쓰는 것은 JSX가 아니어도 화면의 일로 본다
        const ui = UI_EXT.test(ref.file) || owners.length > 0;
        const sp = nearestSpec(out.specs, rel(ref.file), ref.line);
        if (!ref.write) {
          if (ui) {
            owners.forEach((n) => { roles.shown.add(n); addField(n, info, p.name, info.props[pk].doc, 'shown', sp, ref.dom); });
            if (owners.length) evidence.push({ role: 'shown', who: owners.join('·'), file: rel(ref.file), line: ref.line, kind: ref.kind });
          } else if (!/\/(mock|seed|fixtures?)\//.test(ref.file)) {
            const who = sp?.title || path.basename(ref.file);
            roles.judge.add(who);
            evidence.push({ role: 'judge', who, file: rel(ref.file), line: ref.line, kind: ref.kind });
          }
        } else if (ui) {
          const role: Role = ref.kind === 'create' ? 'input' : 'modify';
          owners.forEach((n) => { roles[role].add(n); addField(n, info, p.name, info.props[pk].doc, role, sp, ref.dom); });
          if (owners.length) evidence.push({ role, who: owners.join('·'), file: rel(ref.file), line: ref.line, kind: ref.kind });
        }
      }
      const seenEv = new Set<string>();
      info.props[pk].evidence = evidence.filter((e) => { const key = `${e.role}|${e.file}|${e.line}`; if (seenEv.has(key)) return false; seenEv.add(key); return true; });
      info.props[pk].roles = listOf(roles);
      for (const role of ROLES) roles[role].forEach((v) => flow[role].add(v));
    });
    info.flow = listOf(flow);
    info.kind = info.flow.shown.length || info.flow.input.length || info.flow.modify.length ? 'screen' : 'internal';
    info.flagged = info.props.filter((p) => !p.doc || p.status !== 'rw').length;
  });

  // ── 화면 흐름: 들어오는 길, 단계(시작에서 몇 번째) ───────────
  const incoming: Record<string, Incoming[]> = Object.fromEntries(out.screens.map((s) => [s.name, []]));
  let moves = 0;
  for (const s of out.screens) for (const t of s.to) if (incoming[t.target]) { incoming[t.target].push({ from: s.name, action: t.action, pass: t.pass }); moves++; }
  const stage: Record<string, number> = {};
  // 시작 화면: @start가 있으면 그 화면. 없으면 들어오는 길이 가장 적은 화면(같으면 주소가 짧은 쪽). 서로 오가는 화면만 있어도 시작이 정해진다
  const flagged = out.screens.filter((s) => s.start).map((s) => s.name);
  const byIn = [...out.screens].sort((a, b) => incoming[a.name].length - incoming[b.name].length || (a.route || '').length - (b.route || '').length);
  const starts = flagged.length ? flagged : out.screens.filter((s) => !incoming[s.name].length).map((s) => s.name);
  const queue = (starts.length ? starts : byIn.slice(0, 1).map((s) => s.name)).map((n) => { stage[n] = 0; return n; });
  while (queue.length) {
    const n = queue.shift() as string;
    const cur = out.screens.find((s) => s.name === n);
    for (const t of cur?.to ?? []) if (stage[t.target] === undefined && incoming[t.target]) { stage[t.target] = stage[n] + 1; queue.push(t.target); }
  }
  out.screens.forEach((s) => { if (stage[s.name] === undefined) stage[s.name] = 0; });

  // ── 화면별 모델 ──────────────────────────────────────
  const screens: ModelScreen[] = out.screens.map((s) => {
    const specs = specsOfScreen(s.name);
    const mine = memos.filter((m) => m.screen === s.name);
    const fields: ScreenField[] = [...screenFields[s.name].values()].map((f) => ({ ...f, roles: [...f.roles], specs: [...f.specs], doms: [...f.doms.values()] }));
    const missing = specs.filter((x) => !x.why).length + (s.why ? 0 : 1);
    const warns = out.warnings.filter((w) => s.files.some((f) => w.includes(`(${f}:`)));
    return {
      ...s, to: s.to.map((t) => ({ ...t, verified: nav.edges.some((e) => e.from === s.name && e.to === t.target) || t.target === s.name })), stage: stage[s.name], incoming: incoming[s.name], status: status[s.name],
      specIds: specs.map((x) => x.id), fields, infoCount: new Set(fields.map((f) => f.info)).size,
      memoCount: mine.length, memoPending: mine.filter((m) => m.state === 'pending').length,
      missing, warnings: warns,
    };
  });

  // ── 확인 필요(사용 흐름 아래 접어 둔 안내) ───────────────────
  const notes: Note[] = [];
  for (const s of screens) if (!s.to.length && screens.length > 1) notes.push({ screen: s.name, text: `${s.name} 화면에서 다른 화면으로 나가는 길이 없다 (돌아가기 포함)` });
  for (const i of infos) if (i.flow.shown.length && !i.flow.input.length && !i.flow.modify.length) notes.push({ info: i.name, text: `${i.name}은 ${i.flow.shown.join('·')}에서 보여주지만 어느 화면에서도 입력하지 않는다` });

  for (const i of infos) for (const p of i.props) p.evidence = p.evidence.slice(0, 12);
  const requests = describeRequests(loadRequests(scanRoot));
  const pendingCopy = memos.filter((m) => m.state === 'pending' && !m.copiedAt).length;
  return {
    project: path.basename(root), generatedAt: new Date().toISOString(),
    screens, specs: out.specs, infos, relations, notes, scenarios: out.scenarios, warnings: out.warnings, analysisError,
    memos: memos.map((m) => ({ ...m, stateLabel: STATE_LABEL[m.state] })),
    requests,
    summary: {
      screens: screens.length, moves, infos: infos.length, relations: relations.length,
      waiting: screens.filter((s) => ['test-requested', 'approved-changed'].includes(s.status.status)).length,
      testRequested: screens.filter((s) => s.status.status === 'test-requested').length,
      changedAfterApproval: screens.filter((s) => s.status.status === 'approved-changed').length,
      requestsMine: requests.filter((r) => r.turn === 'user').length, memosUndelivered: pendingCopy, needCheck: out.warnings.length + notes.length,
    },
    labels: LABEL,
  };
}
