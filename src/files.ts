/**
 * @spec screen-files 화면이 쓰는 파일 모으기와 내용 해시
 * @why 화면에 속한 컴포넌트·로직을 찾는 일과 "승인 후 변경됨" 판단이 같은 기준(상대 import로 닿는 파일)을 쓰게 한다.
 * @contract TypeScript 표준 표기(`./x.js`로 쓰고 실제 파일은 `x.ts`)도 따라간다. 따라가는 범위가 달라지면 화면에 속한 요소와 승인 후 변경됨 판단이 함께 달라진다.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 가져오기 글자가 .js로 끝나도 실제 파일이 .ts인 경우를 위한 짝 */
const TS_TWIN: Record<string, string> = { '.js': '.ts', '.jsx': '.tsx', '.mjs': '.mts', '.cjs': '.cts' };

/** import 글자 하나가 가리키는 실제 파일(없으면 null) */
function resolveImport(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  const ext = path.extname(base);
  const twin = TS_TWIN[ext] ? base.slice(0, -ext.length) + TS_TWIN[ext] : null;
  const candidates = [
    base, ...(twin ? [twin] : []),
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((e) => base + e),
    ...['.ts', '.tsx', '.js'].map((e) => path.join(base, 'index' + e)),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

/** entry(절대 경로)에서 상대 경로 import를 따라 닿는 파일 전부(entry 포함) */
export function screenFiles(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (f: string): void => {
    if (seen.has(f)) return;
    seen.add(f);
    let text: string;
    try { text = fs.readFileSync(f, 'utf8'); } catch { return; }
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const r = resolveImport(f, m[1]);
      if (r && !r.includes('node_modules')) visit(r);
    }
  };
  visit(entry);
  return [...seen].sort();
}

/** 파일들의 이름과 내용을 합친 짧은 해시. 승인 때와 지금이 같은지 비교하는 데 쓴다 */
export const hashOf = (files: string[]): string => {
  const h = crypto.createHash('sha1');
  for (const f of files) { h.update(f); try { h.update(fs.readFileSync(f)); } catch { /* 없는 파일은 이름만 */ } }
  return h.digest('hex').slice(0, 12);
};
