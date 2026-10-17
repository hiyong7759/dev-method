// 화면 이동 선언(@to)과 코드의 실제 이동을 맞춰 본다.
// 존재 이유: 이동을 @to 태그로 손으로 적으면 코드와 어긋나도 모르므로, 코드에서 이동을 읽어 선언과 대조해 어긋남을 경고로 올리려고.
// 읽는 것(타입 라우트 정의를 쓰는 프로젝트 기준): ① 라우트 도우미 호출 toPath('이름', …) — ROUTES 객체의 이름→주소 ② JSX의 to="/주소" (Link·Navigate 등) ③ navigate("/주소") 호출.
// 읽히지 않는 이동(주소를 변수로 조립하는 등)은 라우트 도우미로 바꿔 쓰거나 이 검사의 경고로 남는다. 설정: .spec/config.json "navigation": { "routes": "ROUTES", "helpers": ["toPath"] }
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { extractSpecs } from './extract.mjs';

const rx = (pattern) => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '')}/?$`);

export function detectNav(scanRoot, root, out = extractSpecs(scanRoot)) {
  let ts;
  try { ts = createRequire(path.join(root, 'package.json'))('typescript'); } catch { return { edges: [], warnings: [], skipped: 'typescript를 찾지 못해 이동 대조를 건너뜀' }; }
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'config.json'), 'utf8')); } catch { /* 기본값 */ }
  const routesName = cfg.navigation?.routes || 'ROUTES';
  const helpers = new Set(cfg.navigation?.helpers || ['toPath']);

  const parsed = new Map();
  const parse = (abs) => {
    if (!parsed.has(abs)) {
      const kind = abs.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      try { parsed.set(abs, ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, kind)); } catch { parsed.set(abs, null); }
    }
    return parsed.get(abs);
  };
  const strOf = (n) => {
    if (!n) return null;
    if (ts.isStringLiteralLike(n)) return n.text;
    if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => ':x' + s.literal.text).join('');
    return null;
  };

  // 라우트 표: 이름 → 주소 패턴
  const table = new Map();
  for (const sc of out.screens) for (const rel of sc.files) {
    const sf = parse(path.join(scanRoot, rel)); if (!sf || !/\.(ts|tsx|js|jsx)$/.test(rel)) continue;
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === routesName && n.initializer) {
        let init = n.initializer; while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression?.(init))) init = init.expression;
        if (init && ts.isObjectLiteralExpression(init)) for (const p of init.properties) if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) { const v = strOf(p.initializer); if (v) table.set(p.name.text, v); }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const byPattern = (pattern) => out.screens.find((s) => s.route === pattern) || out.screens.filter((s) => s.route && rx(s.route).test(pattern)).sort((a, b) => b.route.length - a.route.length)[0] || null;
  const edges = [];
  for (const sc of out.screens) {
    for (const rel of sc.files) {
      if (!/\.(tsx?|jsx?)$/.test(rel)) continue;
      const sf = parse(path.join(scanRoot, rel)); if (!sf) continue;
      const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const add = (pattern, n, how) => { const to = pattern && byPattern(pattern); if (to) edges.push({ from: sc.name, to: to.name, file: rel, line: lineOf(n), how }); };
      const visit = (n) => {
        if (ts.isCallExpression(n)) {
          const callee = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
          if (helpers.has(callee)) { const key = strOf(n.arguments[0]); if (key && table.has(key)) add(table.get(key), n, `${callee}('${key}')`); }
          else if (callee === 'navigate' || callee === 'nav') { const v = strOf(n.arguments[0]); if (v && v.startsWith('/')) add(v, n, `${callee}("${v}")`); }
        } else if (ts.isJsxAttribute(n) && n.name.text === 'to' && n.initializer) {
          const e = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
          const v = strOf(e); if (v && v.startsWith('/')) add(v, n, `to="${v}"`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  // 같은 이동은 하나로
  const seen = new Map(); for (const e of edges) { const k = `${e.from}>${e.to}`; if (!seen.has(k)) seen.set(k, e); }
  const found = [...seen.values()];

  const warnings = [];
  for (const sc of out.screens) {
    for (const t of sc.to) {
      if (t.target === sc.name) continue;
      if (!found.some((e) => e.from === sc.name && e.to === t.target)) warnings.push(`@screen ${sc.name}의 @to ${t.target}: 코드에서 이동을 찾지 못했다 — toPath('…') 같은 라우트 도우미 호출이나 to="/주소"로 써야 읽힌다 (${sc.file}:${sc.line})`);
    }
  }
  for (const e of found) {
    if (e.from === e.to) continue;
    const sc = out.screens.find((s) => s.name === e.from);
    if (!sc.to.some((t) => t.target === e.to)) warnings.push(`선언되지 않은 이동 ${e.from} → ${e.to} (${e.file}:${e.line} ${e.how}) — @screen ${e.from}에 @to로 쓴다`);
  }
  return { edges: found, warnings, routes: Object.fromEntries(table) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const root = path.resolve(args.find((a) => !a.startsWith('--') && a !== get('--src')) || '.');
  const scanRoot = path.resolve(root, get('--src') || 'src');
  const r = detectNav(scanRoot, root);
  if (r.skipped) console.log(r.skipped);
  r.warnings.forEach((w) => console.log(`경고: ${w}`));
  console.log(`읽은 이동 ${r.edges.length}개, 경고 ${r.warnings.length}건`);
  if (args.includes('--check')) process.exit(r.warnings.length ? 1 : 0);
  else console.log(JSON.stringify(r.edges, null, 1));
}
