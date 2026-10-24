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
import { projectRoot } from './project.js';
import { loadRequests, describeRequests } from './request.js';
import { costOf } from './session.js';
import { untrackedCommits } from './history.js';
import { designViews } from './design.js';
import { readConfig } from './config.js';
import { loadComments } from './comment.js';
import { loadReports, reportRows, openCount, assignNumbers } from './report.js';
import { loadGlossary } from './glossary.js';
import { detectNav } from './nav.js';
import { errorText } from './cli.js';
import type {
  Analysis, AnalyzedInfo, Request, ReviewItem, DomHint, Evidence, Extracted, Model, ModelInfo, ModelScreen, NavResult, Relation,
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
    name: i.name, fileSrc: path.relative(scanRoot, path.join(root, i.file)), line: i.line, unused: i.unused, kind: 'internal', doc: clean(i.doc),
    flow: { shown: [], input: [], modify: [], judge: [] }, flagged: 0, domains: [],
    props: i.props.map((p) => ({ name: p.name, doc: clean(p.doc), line: p.line, status: p.status, dupTotal: p.evidence.dupTotal, strs: p.evidence.strs.slice(0, 4), roles: { shown: [], input: [], modify: [], judge: [] }, evidence: [] })),
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
    // 확인이 필요한 필드: 설명이 없거나, 어디에서도 쓰이지 않는 것(none). 한쪽(읽기만, 쓰기만)은 값이 JSON으로 넘어가는 등 코드만으로 판단할 수 없어 세지 않는다
    info.flagged = info.props.filter((p) => !p.doc || p.status === 'none').length;
  });

  // ── 화면별 모델 ──────────────────────────────────────
  const screens: ModelScreen[] = out.screens.map((s) => {
    const specs = specsOfScreen(s.name);
    const fields: ScreenField[] = [...screenFields[s.name].values()].map((f) => ({ info: f.info, prop: f.prop, specs: [...f.specs] }));
    return {
      ...s, fields,
    };
  });

  // ── 확인 필요: 기계가 판단할 수 없어 사람이 정해야 하는 것만 올린다. 코드나 주석을 고치면 해소되는 것(메타정보 빠짐, 이동 선언 어긋남 등)은
  //    경고로 올라가 에이전트가 해소해야 커밋되므로 여기에 올리지 않는다.
  const domainOf = new Map(screens.map((s) => [s.name, s.domain || '']));
  const reviews: ReviewItem[] = [];
  const scenariosOfScreens = (names: string[]): string[] => out.scenarios.filter((sc) => sc.steps.some((st) => st.screens.some((n) => names.includes(n)))).map((sc) => sc.name);
  for (const i of infos) {
    const usedScreens = [...new Set([...i.flow.shown, ...i.flow.input, ...i.flow.modify, ...i.flow.judge])].filter((n) => domainOf.has(n));
    i.domains = [...new Set(usedScreens.map((n) => domainOf.get(n) || '').filter(Boolean))];
    if (i.unused) {
      reviews.push({ id: `review:${i.name}`, title: `정보 “${i.name}”를 어디에서도 쓰지 않습니다`, help: '어디에서도 쓰이지 않아 지워도 될 수 있지만, 지울지 남길지는 사람이 정한다', tone: 'warn', where: `${i.fileSrc}:${i.line}`, also: [], info: i.name, prop: '', screens: [], scenarios: [] });
      continue;
    }
    for (const p of i.props) {
      if (p.status !== 'none') continue;
      const found = p.strs.length > 0 || p.dupTotal > 0;
      reviews.push({
        id: `review:${i.name}.${p.name}`, title: `필드 “${p.name}”를 어디에서도 쓰지 않습니다`,
        help: found ? '코드에서는 쓰는 곳을 못 찾았지만 같은 이름이 다른 곳에 나온다 — 값이 JSON이나 글자로 쓰일 수 있어 지우기 전에 아래 곳을 본다' : '코드에서도 글자로도 쓰는 곳이 없습니다 — 지워도 안전해 보입니다',
        tone: found ? 'warn' : 'ok', where: `${i.fileSrc}:${p.line}`, also: p.strs.map((x) => `${x.file}:${x.line}`), info: i.name, prop: p.name, screens: usedScreens, scenarios: scenariosOfScreens(usedScreens),
      });
    }
  }
  const store = loadReports(scanRoot);
  const numbers = assignNumbers(scanRoot, [...store.items.map((a) => a.id), ...reviews.map((r) => r.id).sort()]);
  const rows = reportRows(store.items, reviews, store.decisions, store.notes, numbers, new Set(screens.map((s) => s.name)), new Set(infos.map((i) => i.name)));
  for (const i of infos) i.flagged = rows.filter((r) => r.review && !r.decision && !r.tool && r.review.info === i.name).length;

  for (const i of infos) for (const p of i.props) p.evidence = p.evidence.slice(0, 12);
  const componentsOf = (r: Request): string[] => [...new Set(out.scenarios.filter((sc) => (r.scope.scenarios ?? []).includes(sc.name)).flatMap((sc) => sc.steps.map((st) => st.owner)))];
  const rawRequests = loadRequests(scanRoot);
  const requests = describeRequests(rawRequests, componentsOf).map((r) => ({ ...r, cost: costOf(scanRoot, r.id) }));
  return {
    project: path.basename(root), generatedAt: new Date().toISOString(),
    screens, specs: out.specs, infos, relations, reports: rows, glossary: loadGlossary(scanRoot), scenarios: out.scenarios, warnings: out.warnings, analysisError,
    requests, designs: designViews(root), designCanvas: readConfig(root).designCanvas ?? '', comments: loadComments(scanRoot), untracked: untrackedCommits(scanRoot, rawRequests),
    summary: {
      screens: screens.length, infos: infos.length, relations: relations.length,
      requestsMine: requests.filter((r) => r.turn === 'user').length, needCheck: out.warnings.length, reportsOpen: openCount(rows),
    },
  };
}
