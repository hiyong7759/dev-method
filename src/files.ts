/**
 * @spec screen-files 화면이 쓰는 파일 모으기
 * @why 화면에 속한 컴포넌트·로직을 찾는 기준(상대 import로 닿는 파일)을 한 곳에 둔다.
 * @contract TypeScript 표준 표기(`./x.js`로 쓰고 실제 파일은 `x.ts`)와, 가장 가까운 tsconfig.json의 paths 별칭(예: `@/components/Foo` → src/components/Foo)도 따라간다. 따라가는 범위가 달라지면 화면에 속한 요소가 달라진다.
 */
import fs from 'node:fs';
import path from 'node:path';

/** 가져오기 글자가 .js로 끝나도 실제 파일이 .ts인 경우를 위한 짝 */
const TS_TWIN: Record<string, string> = { '.js': '.ts', '.jsx': '.tsx', '.mjs': '.mts', '.cjs': '.cts' };

/** tsconfig 같은 JSON에서 주석(// 와 /* *​/)과 끝 쉼표를 걷어 낸다. 글자("…") 안은 그대로 둔다("@/*" 같은 별칭에 /* 가 들어 있다) */
function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1); i = j;
    } else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; }
    else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** 폴더별 별칭 표: 가장 가까운 tsconfig.json의 paths를 [접두어, 바꿀 폴더들]로 풀어 둔다(없으면 빈 목록) */
const aliasCache = new Map<string, { dir: string; list: { prefix: string; exact: boolean; to: string[] }[] }>();
function aliasesFor(from: string): { dir: string; list: { prefix: string; exact: boolean; to: string[] }[] } {
  let dir = path.dirname(from);
  for (;;) {
    const hit = aliasCache.get(dir);
    if (hit) return hit;
    const cfg = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(cfg)) {
      const out = { dir, list: [] as { prefix: string; exact: boolean; to: string[] }[] };
      try {
        const text = stripJsonComments(fs.readFileSync(cfg, 'utf8'));
        const o = (JSON.parse(text) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }).compilerOptions ?? {};
        const base = path.resolve(dir, o.baseUrl ?? '.');
        for (const [k, v] of Object.entries(o.paths ?? {})) {
          const star = k.endsWith('/*') || k.endsWith('*');
          out.list.push({ prefix: star ? k.replace(/\*$/, '') : k, exact: !star, to: v.map((x) => path.resolve(base, x.replace(/\*$/, ''))) });
        }
      } catch { /* 읽을 수 없는 tsconfig는 별칭 없음으로 본다 */ }
      aliasCache.set(dir, out);
      return out;
    }
    const up = path.dirname(dir);
    if (up === dir) return { dir, list: [] };
    dir = up;
  }
}

/** import 글자 하나가 가리키는 실제 파일(없으면 null) */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) {
    // 별칭(@/…)이면 바꿀 폴더들에서 찾는다
    for (const a of aliasesFor(from).list) {
      if (a.exact ? spec !== a.prefix : !spec.startsWith(a.prefix)) continue;
      for (const to of a.to) {
        const r = resolveFile(a.exact ? to : path.join(to, spec.slice(a.prefix.length)));
        if (r) return r;
      }
    }
    return null;
  }
  return resolveFile(path.resolve(path.dirname(from), spec));
}

/** 확장자·index를 보태 가며 실제 파일을 찾는다 */
function resolveFile(base: string): string | null {
  const ext = path.extname(base);
  const twin = TS_TWIN[ext] ? base.slice(0, -ext.length) + TS_TWIN[ext] : null;
  const candidates = [
    base, ...(twin ? [twin] : []),
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((e) => base + e),
    ...['.ts', '.tsx', '.js'].map((e) => path.join(base, 'index' + e)),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

/** entry(절대 경로)에서 상대 경로·별칭 import를 따라 닿는 파일 전부(entry 포함) */
export function screenFiles(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (f: string): void => {
    if (seen.has(f)) return;
    seen.add(f);
    let text: string;
    try { text = fs.readFileSync(f, 'utf8'); } catch { return; }
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const r = resolveImport(f, m[1]);
      if (r && !r.includes('node_modules')) visit(r);
    }
  };
  visit(entry);
  return [...seen].sort();
}
