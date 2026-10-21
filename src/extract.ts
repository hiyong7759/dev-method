/**
 * @spec extract 소스 주석 태그 읽기
 * @why 설계서를 따로 쓰지 않고 소스 주석을 유일한 원본으로 두되, 사람이 화면에서 읽을 수 있게 한다.
 * @basis 언어에 묶이지 않게 주석 형식 세 가지(블록 주석, HTML 주석, 연속된 // 또는 # 줄)만 읽는다.
 * @contract 한 주석 덩어리에 @screen 또는 @spec 하나가 개체를 열고, 뒤따르는 태그(@why @basis @contract @anchor …)가 그 개체의 칸이 된다. 화면은 @route @sample @domain @does @to, 컴포넌트는 @on도 쓴다. @anchor는 dom:<CSS 선택자> 또는 3d:<오브젝트 이름>이고 없으면 화면과 연결 안 된 로직이다. @open은 처음 화면에 안 보이는 요소를 여는 순서(도구가 스스로 못 찾을 때만)로, 예는 "입력 검색=서울 → 엔터 → 누르기 결과 보기"다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { screenFiles } from './files.js';
import { readJsxRoutes } from './routes.js';
import { projectRoot } from './project.js';
import { parseArgs } from './cli.js';
import { buildScenarios } from './scenarios.js';
import type { Does, Extracted, Move, OnEffect, OpenAct, OpenStep, ScreenTag, Spec, SpecKind } from './types.js';

/** 읽는 파일 확장자(주석이 있을 수 있는 소스 파일) */
const EXTS = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx', '.html', '.vue', '.svelte', '.css', '.py']);
/** 뒤지지 않는 폴더(내려받은 것, 빌드 결과, 가상환경 등) */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'runs']);

/** 주석 덩어리: 줄 번호와 장식 문자를 벗긴 본문 줄들 */
interface Block { line: number; lines: string[] }

/** 파일 안의 주석 덩어리를 모두 모은다 */
function commentBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (idx: number): number => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  for (const m of text.matchAll(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g)) {
    const lines = m[0].replace(/^\/\*+|\*\/$|^<!--|-->$/g, '').split('\n').map((l) => l.replace(/^\s*\*+\s?/, '').trim());
    blocks.push({ line: lineOf(m.index ?? 0), lines });
  }
  let run: Block | null = null;
  text.split('\n').forEach((raw, i) => {
    const m = raw.match(/^\s*(?:\/\/|#)(.*)$/);
    if (m) { if (!run) run = { line: i + 1, lines: [] }; run.lines.push(m[1].trim()); }
    else if (run) { blocks.push(run); run = null; }
  });
  if (run) blocks.push(run);
  return blocks;
}

/** @does 한 줄을 읽는다: 일 | 확인 기준 | 시나리오#단계 | → 다음 단계,… | 조건 (앞의 둘 뒤는 시나리오에 속하는 일일 때만) */
function parseDoes(line: string): Does {
  const [title, check, ref, next, cond] = splitBar(line, 5);
  const i = ref.indexOf('#');
  return {
    title, check, scenario: i < 0 ? ref : ref.slice(0, i).trim(), step: i < 0 ? '' : ref.slice(i + 1).trim(),
    next: next.replace(/^→\s*/, '').split(',').map((x) => x.trim()).filter(Boolean), cond,
  };
}

/** 한 번만 쓰는 칸(why, basis, contract, anchor …)과 여러 번 쓰는 칸(does, to, on) */
const FIELDS = ['why', 'basis', 'contract', 'anchor', 'open', 'route', 'sample', 'domain', 'start'] as const;
const LISTS = ['does', 'to', 'on'] as const;
type Field = (typeof FIELDS)[number];
type ListName = (typeof LISTS)[number];

/** 주석 덩어리에서 읽은 개체 하나(아직 화면인지 요소인지에 따라 다듬기 전) */
interface Entity extends Partial<Record<Field, string>> {
  kind: 'screen' | 'spec' | null; id: string; title: string; line: number; does: string[]; to: string[]; on: string[];
}

/**
 * 한 덩어리를 개체 하나로 읽는다. 태그가 없으면 null.
 * @does 사용자가 하는 일 | 확인 기준 | 시나리오#단계 | → 다음 단계,… | 조건(셋째 칸부터는 시나리오에 속하는 일일 때만. 컴포넌트에도 쓴다), @to 대상 화면 | 행동 | 넘기는 값, @on 이벤트: 효과
 */
function parseBlock(block: Block): (Entity & { kind: 'screen' | 'spec' }) | null {
  const entity: Entity = { kind: null, id: '', title: '', line: block.line, does: [], to: [], on: [] };
  let cur: Field | { list: ListName } | null = null;
  let seen = false;
  for (const line of block.lines) {
    const t = line.match(/^@(\w+)\s*(.*)$/);
    if (t) {
      const [, tag, val] = t;
      if (tag === 'screen') { entity.kind = 'screen'; entity.title = val; seen = true; cur = null; }
      else if (tag === 'spec') {
        entity.kind = 'spec'; seen = true; cur = null;
        const [id, ...rest] = val.split(/\s+/);
        entity.id = id; entity.title = rest.join(' ') || id;
      } else if ((FIELDS as readonly string[]).includes(tag)) { entity[tag as Field] = val; cur = tag as Field; }
      else if ((LISTS as readonly string[]).includes(tag)) { entity[tag as ListName].push(val); cur = { list: tag as ListName }; }
      else cur = null;
    } else if (cur && line) {
      if (typeof cur === 'string') entity[cur] = `${entity[cur] ?? ''} ${line}`.trim();
      else { const l = entity[cur.list]; l[l.length - 1] = `${l[l.length - 1]} ${line}`.trim(); }
    }
  }
  return seen && entity.kind ? (entity as Entity & { kind: 'screen' | 'spec' }) : null;
}

/** "a | b | c"를 정해진 칸 수만큼 나눈다(모자라면 빈 글자) */
function splitBar(v: string, n: number): string[] {
  const a = v.split('|').map((x) => x.trim());
  while (a.length < n) a.push('');
  return a;
}

/** 폴더 아래의 읽을 만한 소스 파일을 모두 돌려준다 */
function* walk(dir: string): Generator<string> {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') && ent.name !== '.') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) yield* walk(p); }
    else if (EXTS.has(path.extname(ent.name))) yield p;
  }
}

/** @open 한 줄을 단계 목록으로: '누르기 글자', '올리기 글자', '입력 칸이름=값', '엔터'를 → 로 잇는다. 읽지 못한 조각은 bad에 모은다 */
function parseOpen(text: string | undefined): { steps: OpenStep[]; bad: string[] } {
  const steps: OpenStep[] = [], bad: string[] = [];
  for (const raw of (text ?? '').split('→').map((x) => x.trim()).filter(Boolean)) {
    const m = raw.match(/^(누르기|올리기|입력|엔터)\s*(.*)$/);
    if (!m) { bad.push(raw); continue; }
    const act = m[1] as OpenAct;
    if (act === '엔터') steps.push({ act });
    else if (act === '입력') {
      const i = m[2].indexOf('=');
      if (i < 0) { bad.push(raw); continue; }
      steps.push({ act, text: m[2].slice(0, i).trim(), value: m[2].slice(i + 1).trim() });
    } else if (!m[2]) bad.push(raw);
    else steps.push({ act, text: m[2] });
  }
  return { steps, bad };
}

/** @anchor 글자에서 요소의 종류를 읽는다. 모르는 앞머리면 null */
function kindOf(anchor: string | undefined): SpecKind | null {
  if (!anchor) return 'logic';
  const k = anchor.split(':')[0];
  return k === 'dom' || k === '3d' ? k : null;
}

/** 소스 폴더의 주석 태그를 모두 읽어 화면과 요소 목록, 경고를 만든다 */
export function extractSpecs(root: string): Extracted {
  const out: Extracted = { screens: [], screen: null, specs: [], scenarios: [], warnings: [], generatedAt: new Date().toISOString() };
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  for (const file of walk(root)) {
    const rel = path.relative(root, file);
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!text.includes('@screen') && !text.includes('@spec')) continue;
    for (const block of commentBlocks(text)) {
      const e = parseBlock(block);
      if (!e) continue;
      const where = { file: rel, line: e.line };
      if (e.kind === 'screen') {
        const dup = names.get(e.title);
        if (dup) { out.warnings.push(`@screen ${e.title} 중복: ${dup}, ${rel}:${e.line}`); continue; }
        names.set(e.title, `${rel}:${e.line}`);
        const screen: ScreenTag = {
          name: e.title, why: e.why || '', basis: e.basis || '', route: e.route || '', routes: e.route ? [e.route] : [], sample: e.sample || '', domain: e.domain || '', start: e.start !== undefined,
          does: e.does.map(parseDoes),
          to: e.to.map((d): Move => { const [target, action, pass] = splitBar(d, 3); return { target, action, pass }; }),
          files: [], ...where,
        };
        out.screens.push(screen);
        if (!e.why) out.warnings.push(`@screen ${e.title}에 @why가 없다 (${rel}:${e.line})`);
      } else {
        const dup = ids.get(e.id);
        if (dup) { out.warnings.push(`@spec ${e.id} 중복: ${dup}, ${rel}:${e.line}`); continue; }
        ids.set(e.id, `${rel}:${e.line}`);
        const openParsed = parseOpen(e.open);
        const kind = kindOf(e.anchor);
        const spec: Spec = {
          id: e.id, title: e.title, why: e.why || '', basis: e.basis || '', contract: e.contract || '',
          ons: e.on.map((o): OnEffect => { const i = o.indexOf(':'); return i < 0 ? { event: o.trim(), effect: '' } : { event: o.slice(0, i).trim(), effect: o.slice(i + 1).trim() }; }),
          anchor: e.anchor || '', open: openParsed.steps, kind: kind ?? 'logic', screens: [], does: e.does.map(parseDoes), ...where,
        };
        out.specs.push(spec);
        if (kind === null) out.warnings.push(`@spec ${e.id}의 @anchor "${e.anchor}"를 읽지 못했다 — dom:<선택자> 또는 3d:<오브젝트 이름>으로 쓴다 (${rel}:${e.line})`);
        if (openParsed.bad.length) out.warnings.push(`@spec ${e.id}의 @open을 읽지 못했다: ${openParsed.bad.join(' / ')} — '누르기 글자', '올리기 글자', '입력 칸이름=값', '엔터'를 → 로 잇는다 (${rel}:${e.line})`);
        if (!e.why) out.warnings.push(`@spec ${e.id}에 @why가 없다 (${rel}:${e.line})`);
        // 화면에 안 보이는 로직은 제목이 유일한 식별 단서 — 한 단어나 id 그대로면 무엇을 맡는지 알 수 없다
        if (!e.anchor && (e.title === e.id || e.title.replace(/\s/g, '').length < 4)) out.warnings.push(`@spec ${e.id}의 제목 "${e.title}"이 짧거나 id와 같다 — 무엇을 맡는지 보이게 쓴다 (${rel}:${e.line})`);
      }
    }
  }
  // 파일 경로 순으로 고정해 번호가 매번 같게
  const byPlace = (a: { file: string; line: number }, b: { file: string; line: number }): number => a.file.localeCompare(b.file) || a.line - b.line;
  out.specs.sort(byPlace);
  out.screens.sort(byPlace);
  // 이동 대상이 실제 화면인지, 컴포넌트가 어느 화면에 속하는지(화면 파일에서 상대 import로 닿는 파일에 있는지)
  const known = new Set(out.screens.map((s) => s.name));
  for (const sc of out.screens) {
    sc.files = screenFiles(path.join(root, sc.file)).map((f) => path.relative(root, f));
    for (const t of sc.to) if (!known.has(t.target)) out.warnings.push(`@screen ${sc.name}의 @to 대상 "${t.target}"이 없는 화면이다 (${sc.file}:${sc.line})`);
  }
  // @route가 없는 화면은 <Route> 선언에서 주소를 읽어 채운다: 화면 파일이 element 파일이거나, element 파일이 화면 파일을 바로 import하면 그 화면의 주소다
  const lacking = out.screens.filter((s) => !s.route);
  if (lacking.length) {
    const jsx = readJsxRoutes(root, projectRoot(root));
    for (const sc of lacking) {
      const mine = [...new Set(jsx.filter((r) => r.file === sc.file || r.imports.includes(sc.file)).map((r) => r.path))];
      if (mine.length) { sc.route = mine[0]; sc.routes = mine; }
    }
  }
  for (const sc of out.screens) if (!sc.route) out.warnings.push(`@screen ${sc.name}에 @route가 없다 — 실제 화면을 끼워 넣으려면 주소가 필요하다 (${sc.file}:${sc.line})`);
  for (const sp of out.specs) {
    sp.screens = out.screens.filter((sc) => sc.files.includes(sp.file)).map((sc) => sc.name);
    if (sp.kind === 'dom' && !sp.screens.length) out.warnings.push(`@spec ${sp.id}는 어느 @screen에도 속하지 않는다 — 화면 파일에서 import로 닿아야 한다 (${sp.file}:${sp.line})`);
  }
  out.scenarios = buildScenarios(out);
  out.screen = out.screens[0] || null;
  if (!out.screens.length) out.warnings.push('@screen이 없다');
  return out;
}

/** 명령: extract <소스 폴더> [--check] — 읽은 결과를 JSON으로 내거나, --check이면 경고만 낸다 */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, flags } = parseArgs(argv, ['check']);
  const out = extractSpecs(path.resolve(pos[0] || '.'));
  if (!flags.has('check')) { console.log(JSON.stringify(out, null, 2)); return undefined; }
  out.warnings.forEach((w) => console.log(`경고: ${w}`));
  console.log(`@spec ${out.specs.length}개, 경고 ${out.warnings.length}건`);
  return out.warnings.length ? 1 : 0;
}
