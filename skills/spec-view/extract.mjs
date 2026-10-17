// 소스 주석의 설계 태그(@screen, @spec …)를 모아 한 덩어리 JSON으로 만든다.
// 존재 이유: 설계서를 따로 쓰지 않고 소스 주석을 유일한 원본으로 두되, 사람이 화면에서 읽을 수 있게 하려고.
// 언어에 묶이지 않게 주석 형식 세 가지(/* */, <!-- -->, 연속된 // 또는 # 줄)만 읽는다.
// 태그 규칙: 한 주석 덩어리에 @screen 또는 @spec 하나가 개체를 열고, 뒤따르는 @why @basis @contract @anchor가 그 개체의 칸이 된다.
//   @anchor: dom:<CSS 선택자> | 3d:<오브젝트 이름> | (없음 = 화면과 연결 안 된 로직)
import fs from 'node:fs';
import path from 'node:path';

const EXTS = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx', '.html', '.vue', '.svelte', '.css', '.py']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'runs', 'data']);
const FIELDS = ['why', 'basis', 'contract', 'anchor'];

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
function parseBlock(block) {
  const entity = { kind: null, id: null, title: null, line: block.line };
  let cur = null;
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
      } else if (FIELDS.includes(tag)) { entity[tag] = val; cur = tag; }
      else cur = null;
    } else if (cur && line) entity[cur] = `${entity[cur]} ${line}`.trim();
  }
  return seen && entity.kind ? entity : null;
}

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') && ent.name !== '.') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) yield* walk(p); }
    else if (EXTS.has(path.extname(ent.name))) yield p;
  }
}

const kindOf = (anchor) => (!anchor ? 'logic' : anchor.split(':')[0]);

export function extractSpecs(root) {
  const out = { screen: null, specs: [], warnings: [], generatedAt: new Date().toISOString() };
  const ids = new Map();
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
        if (out.screen) out.warnings.push(`@screen이 둘 이상: ${out.screen.file}:${out.screen.line}, ${rel}:${e.line}`);
        else out.screen = { name: e.title, why: e.why || '', basis: e.basis || '', ...where };
      } else {
        if (ids.has(e.id)) { out.warnings.push(`@spec ${e.id} 중복: ${ids.get(e.id)}, ${rel}:${e.line}`); continue; }
        ids.set(e.id, `${rel}:${e.line}`);
        out.specs.push({
          id: e.id, title: e.title, why: e.why || '', basis: e.basis || '', contract: e.contract || '',
          anchor: e.anchor || '', kind: kindOf(e.anchor), ...where,
        });
        if (!e.why) out.warnings.push(`@spec ${e.id}에 @why가 없다 (${rel}:${e.line})`);
        // 화면에 안 보이는 로직은 제목이 유일한 식별 단서 — 한 단어나 id 그대로면 무엇을 맡는지 알 수 없다
        if (!e.anchor && (e.title === e.id || e.title.replace(/\s/g, '').length < 4)) out.warnings.push(`@spec ${e.id}의 제목 "${e.title}"이 짧거나 id와 같다 — 무엇을 맡는지 보이게 쓴다 (${rel}:${e.line})`);
      }
    }
  }
  // 파일 경로 순으로 고정해 번호가 매번 같게
  out.specs.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  if (!out.screen) out.warnings.push('@screen이 없다');
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
