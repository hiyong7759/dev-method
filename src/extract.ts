// 소스 주석의 설계 태그(@screen, @spec …)를 모아 한 덩어리 JSON으로 만든다.
// 존재 이유: 설계서를 따로 쓰지 않고 소스 주석을 유일한 원본으로 두되, 사람이 화면에서 읽을 수 있게 하려고.
// 언어에 묶이지 않게 주석 형식 세 가지(/* */, <!-- -->, 연속된 // 또는 # 줄)만 읽는다.
// 태그 규칙: 한 주석 덩어리에 @screen 또는 @spec 하나가 개체를 열고, 뒤따르는 태그(@why @basis @contract @anchor …)가 그 개체의 칸이 된다.
//   화면은 @route @sample @domain @does @to, 컴포넌트는 @on도 쓴다 (parseBlock 위 설명)
//   @anchor: dom:<CSS 선택자> | 3d:<오브젝트 이름> | (없음 = 화면과 연결 안 된 로직)
//   @open: 처음 화면에 안 보이는 요소를 여는 순서(도구가 스스로 못 찾을 때만). 예: 입력 검색=서울 → 엔터 → 누르기 결과 보기
import fs from 'node:fs';
import path from 'node:path';
import { screenFiles } from './files.js';

const EXTS = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx', '.html', '.vue', '.svelte', '.css', '.py']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'runs']);

// 주석 덩어리 = 줄 번호와 장식 문자를 벗긴 본문 줄들
function commentBlocks(text) {
  const blocks = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  for (const m of text.matchAll(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g)) {
    const lines = m[0].replace(/^\/\*+|\*\/$|^<!--|-->$/g, '').split('\n').map((l) => l.replace(/^\s*\*+\s?/, '').trim());
    blocks.push({ line: lineOf(m.index), lines });
  }
  const all = text.split('\n');
  let run = null;
  all.forEach((raw, i) => {
    const m = raw.match(/^\s*(?:\/\/|#)(.*)$/);
    if (m) { if (!run) run = { line: i + 1, lines: [] }; run.lines.push(m[1].trim()); }
    else if (run) { blocks.push(run); run = null; }
  });
  if (run) blocks.push(run);
  return blocks;
}

// 한 덩어리를 개체 하나로. 태그가 없으면 null
// 한 번만 쓰는 칸(why, basis, contract, anchor, route, sample, domain)과 여러 번 쓰는 칸(does, to, on)이 있다
//   @does 사용자가 하는 일 | 확인 기준        @to 대상 화면 | 행동 | 넘기는 값        @on 이벤트: 효과
const FIELDS = ['why', 'basis', 'contract', 'anchor', 'open', 'route', 'sample', 'domain', 'start'];
const LISTS = ['does', 'to', 'on'];
function parseBlock(block) {
  const entity = { kind: null, id: null, title: null, line: block.line, does: [], to: [], on: [] };
  let cur = null;
  let seen = false;
  const pushList = (tag, val) => entity[tag].push(val);
  for (const line of block.lines) {
    const t = line.match(/^@(\w+)\s*(.*)$/);
    if (t) {
      const [, tag, val] = t;
      if (tag === 'screen') { entity.kind = 'screen'; entity.title = val; seen = true; cur = null; }
      else if (tag === 'spec') {
        entity.kind = 'spec'; seen = true; cur = null;
        const [id, ...rest] = val.split(/\s+/);
        entity.id = id; entity.title = rest.join(' ') || id;
      } else if (FIELDS.includes(tag)) { entity[tag] = val; cur = tag; }
      else if (LISTS.includes(tag)) { pushList(tag, val); cur = { list: tag }; }
      else cur = null;
    } else if (cur && line) {
      if (typeof cur === 'string') entity[cur] = `${entity[cur]} ${line}`.trim();
      else { const l = entity[cur.list]; l[l.length - 1] = `${l[l.length - 1]} ${line}`.trim(); }
    }
  }
  return seen && entity.kind ? entity : null;
}
const splitBar = (v, n) => { const a = v.split('|').map((x) => x.trim()); while (a.length < n) a.push(''); return a; };

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') && ent.name !== '.') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) yield* walk(p); }
    else if (EXTS.has(path.extname(ent.name))) yield p;
  }
}

// @open 한 줄을 단계 목록으로: '누르기 글자', '올리기 글자', '입력 칸이름=값', '엔터'를 → 로 잇는다
const parseOpen = (text) => {
  const steps = [], bad = [];
  for (const raw of String(text || '').split('→').map((x) => x.trim()).filter(Boolean)) {
    const m = raw.match(/^(누르기|올리기|입력|엔터)\s*(.*)$/);
    if (!m) { bad.push(raw); continue; }
    if (m[1] === '엔터') steps.push({ act: '엔터' });
    else if (m[1] === '입력') { const i = m[2].indexOf('='); if (i < 0) { bad.push(raw); continue; } steps.push({ act: '입력', text: m[2].slice(0, i).trim(), value: m[2].slice(i + 1).trim() }); }
    else if (!m[2]) bad.push(raw); else steps.push({ act: m[1], text: m[2] });
  }
  return { steps, bad };
};
const kindOf = (anchor) => (!anchor ? 'logic' : anchor.split(':')[0]);

export function extractSpecs(root) {
  const out = { screens: [], screen: null, specs: [], warnings: [], generatedAt: new Date().toISOString() };
  const ids = new Map();
  const names = new Map();
  for (const file of walk(root)) {
    const rel = path.relative(root, file);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!text.includes('@screen') && !text.includes('@spec')) continue;
    for (const block of commentBlocks(text)) {
      const e = parseBlock(block);
      if (!e) continue;
      const where = { file: rel, line: e.line };
      if (e.kind === 'screen') {
        if (names.has(e.title)) { out.warnings.push(`@screen ${e.title} 중복: ${names.get(e.title)}, ${rel}:${e.line}`); continue; }
        names.set(e.title, `${rel}:${e.line}`);
        out.screens.push({
          name: e.title, why: e.why || '', basis: e.basis || '', route: e.route || '', sample: e.sample || '', domain: e.domain || '', start: e.start !== undefined,
          does: e.does.map((d) => { const [title, check] = splitBar(d, 2); return { title, check }; }),
          to: e.to.map((d) => { const [target, action, pass] = splitBar(d, 3); return { target, action, pass }; }),
          ...where,
        });
        if (!e.why) out.warnings.push(`@screen ${e.title}에 @why가 없다 (${rel}:${e.line})`);
        if (!e.route) out.warnings.push(`@screen ${e.title}에 @route가 없다 — 실제 화면을 끼워 넣으려면 주소가 필요하다 (${rel}:${e.line})`);
      } else {
        if (ids.has(e.id)) { out.warnings.push(`@spec ${e.id} 중복: ${ids.get(e.id)}, ${rel}:${e.line}`); continue; }
        ids.set(e.id, `${rel}:${e.line}`);
        const openParsed = parseOpen(e.open);
        out.specs.push({
          id: e.id, title: e.title, why: e.why || '', basis: e.basis || '', contract: e.contract || '',
          ons: e.on.map((o) => { const i = o.indexOf(':'); return i < 0 ? { event: o.trim(), effect: '' } : { event: o.slice(0, i).trim(), effect: o.slice(i + 1).trim() }; }),
          anchor: e.anchor || '', open: openParsed.steps, kind: kindOf(e.anchor), ...where,
        });
        if (openParsed.bad.length) out.warnings.push(`@spec ${e.id}의 @open을 읽지 못했다: ${openParsed.bad.join(' / ')} — '누르기 글자', '올리기 글자', '입력 칸이름=값', '엔터'를 → 로 잇는다 (${rel}:${e.line})`);
        if (!e.why) out.warnings.push(`@spec ${e.id}에 @why가 없다 (${rel}:${e.line})`);
        // 화면에 안 보이는 로직은 제목이 유일한 식별 단서 — 한 단어나 id 그대로면 무엇을 맡는지 알 수 없다
        if (!e.anchor && (e.title === e.id || e.title.replace(/\s/g, '').length < 4)) out.warnings.push(`@spec ${e.id}의 제목 "${e.title}"이 짧거나 id와 같다 — 무엇을 맡는지 보이게 쓴다 (${rel}:${e.line})`);
      }
    }
  }
  // 파일 경로 순으로 고정해 번호가 매번 같게
  out.specs.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  out.screens.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  // 이동 대상이 실제 화면인지, 컴포넌트가 어느 화면에 속하는지(화면 파일에서 상대 import로 닿는 파일에 있는지)
  const known = new Set(out.screens.map((s) => s.name));
  for (const sc of out.screens) {
    sc.files = screenFiles(path.join(root, sc.file)).map((f) => path.relative(root, f));
    for (const t of sc.to) if (!known.has(t.target)) out.warnings.push(`@screen ${sc.name}의 @to 대상 "${t.target}"이 없는 화면이다 (${sc.file}:${sc.line})`);
  }
  for (const sp of out.specs) {
    sp.screens = out.screens.filter((sc) => sc.files.includes(sp.file)).map((sc) => sc.name);
    if (sp.kind === 'dom' && !sp.screens.length) out.warnings.push(`@spec ${sp.id}는 어느 @screen에도 속하지 않는다 — 화면 파일에서 import로 닿아야 한다 (${sp.file}:${sp.line})`);
  }
  out.screen = out.screens[0] || null;
  if (!out.screens.length) out.warnings.push('@screen이 없다');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const root = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
  const out = extractSpecs(root);
  if (check) { out.warnings.forEach((w) => console.log(`경고: ${w}`)); console.log(`@spec ${out.specs.length}개, 경고 ${out.warnings.length}건`); process.exit(out.warnings.length ? 1 : 0); }
  else console.log(JSON.stringify(out, null, 2));
}
