// 화면 파일이 쓰는 파일 모으기와 내용 해시. 존재 이유: 화면에 속한 컴포넌트·로직과 "승인 후 변경됨" 판단이 같은 기준(상대 import로 닿는 파일)을 쓰게 하려고.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function resolveImport(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((e) => base + e), ...['.ts', '.tsx', '.js'].map((e) => path.join(base, 'index' + e))]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// entry(절대 경로)에서 상대 경로 import를 따라 닿는 파일 전부(entry 포함)
export function screenFiles(entry) {
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { return; }
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const r = resolveImport(f, m[1]);
      if (r && !r.includes('node_modules')) visit(r);
    }
  };
  visit(entry);
  return [...seen].sort();
}

export const hashOf = (files) => {
  const h = crypto.createHash('sha1');
  for (const f of files) { h.update(f); try { h.update(fs.readFileSync(f)); } catch {} }
  return h.digest('hex').slice(0, 12);
};
