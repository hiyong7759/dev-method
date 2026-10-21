/**
 * @spec nav-check 화면 이동 선언과 코드 대조
 * @why 이동을 @to 태그로 손으로 적으면 코드와 어긋나도 모르므로, 코드에서 이동을 읽어 선언과 대조해 어긋남을 경고로 올린다.
 * @basis 타입 라우트 정의를 쓰는 프로젝트를 기준으로 네 가지를 읽는다: ④ 주소를 만드는 도우미 hash('보는 곳', 대상)(설정의 hashHelpers) — 화면 주소가 #/…인 앱용. ① 라우트 도우미 호출 toPath('이름', …) — ROUTES 객체의 이름 → 주소 ② JSX의 to="/주소"(Link, Navigate 등) ③ navigate("/주소") 호출.
 * @contract 읽히지 않는 이동(주소를 변수로 조립하는 등)은 라우트 도우미로 바꿔 쓰거나 이 검사의 경고로 남는다. 설정은 프로젝트 .spec/config.json의 "navigation": { "routes": "ROUTES", "helpers": ["toPath"] }다. 프로젝트에 typescript가 설치돼 있어야 읽는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type * as tsTypes from 'typescript';
import { extractSpecs } from './extract.js';
import { parseArgs } from './cli.js';
import { readConfig } from './config.js';
import type { Extracted, NavEdge, NavResult, ScreenTag } from './types.js';

type TsModule = typeof tsTypes;

/** 주소 모양(/trips/:id)과 실제 주소를 맞춰 보는 식 */
const rx = (pattern: string): RegExp => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '')}/?$`);

/** 프로젝트 소스의 화면 이동을 읽어, 선언(@to)과 어긋난 곳을 경고로 모은다 */
export function detectNav(scanRoot: string, root: string, out: Extracted = extractSpecs(scanRoot)): NavResult {
  let ts: TsModule;
  try { ts = createRequire(path.join(root, 'package.json'))('typescript') as TsModule; } catch { return { edges: [], warnings: [], skipped: 'typescript를 찾지 못해 이동 대조를 건너뜀' }; }
  const cfg = readConfig(root);
  const routesName = cfg.navigation?.routes || 'ROUTES';
  const helpers = new Set(cfg.navigation?.helpers || ['toPath']);
  const hashHelpers = new Set(cfg.navigation?.hashHelpers || []);
  const hashPrefix = cfg.navigation?.hashPrefix || '/';
  // 프로젝트가 쓰는 TypeScript가 오래된 버전이면 없을 수 있는 판별 함수
  const isSatisfies = (n: tsTypes.Node): boolean => !!(ts as unknown as { isSatisfiesExpression?: (n: tsTypes.Node) => boolean }).isSatisfiesExpression?.(n);

  const parsed = new Map<string, tsTypes.SourceFile | null>();
  const parse = (abs: string): tsTypes.SourceFile | null => {
    if (!parsed.has(abs)) {
      const kind = abs.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      try { parsed.set(abs, ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, kind)); } catch { parsed.set(abs, null); }
    }
    return parsed.get(abs) ?? null;
  };
  /** 글자 상수(템플릿이면 ${…} 자리를 :x로)를 읽는다. 아니면 null */
  const strOf = (n: tsTypes.Node | undefined): string | null => {
    if (!n) return null;
    if (ts.isStringLiteralLike(n)) return n.text;
    if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => ':x' + s.literal.text).join('');
    return null;
  };

  /** 글자 상수를 모두 읽는다. 삼항식(a ? '/x' : '/y')은 두 갈래를 다 돌려준다 */
  const strsOf = (n: tsTypes.Node | undefined): string[] => {
    if (!n) return [];
    if (ts.isParenthesizedExpression(n)) return strsOf(n.expression);
    if (ts.isConditionalExpression(n)) return [...strsOf(n.whenTrue), ...strsOf(n.whenFalse)];
    const v = strOf(n);
    return v == null ? [] : [v];
  };

  // 라우트 표: 이름 → 주소 패턴
  const table = new Map<string, string>();
  for (const sc of out.screens) for (const rel of sc.files) {
    const sf = parse(path.join(scanRoot, rel));
    if (!sf || !/\.(ts|tsx|js|jsx)$/.test(rel)) continue;
    const visit = (n: tsTypes.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === routesName && n.initializer) {
        let init: tsTypes.Expression | undefined = n.initializer;
        while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || isSatisfies(init))) init = (init as tsTypes.AsExpression).expression;
        if (init && ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) {
            if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) { const v = strOf(p.initializer); if (v) table.set(p.name.text, v); }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  /** 주소(또는 주소 모양)에 맞는 화면 */
  const byPattern = (addr: string): ScreenTag | null => {
    // 일반 주소 뒤의 ?질문=값 은 화면을 가르지 않는다(/board/write?id=1 은 /board/write 화면). #/…로 화면을 가르는 주소는 그대로 둔다
    const pattern = addr.includes('#/') ? addr : addr.split('?')[0] || addr;
    return out.screens.find((s) => s.routes.includes(pattern)) || out.screens.map((s) => ({ s, hit: s.routes.filter((r) => rx(r).test(pattern)).sort((a, b) => b.length - a.length)[0] })).filter((x) => x.hit).sort((a, b) => b.hit.length - a.hit.length)[0]?.s || null;
  };
  const edges: NavEdge[] = [];
  for (const sc of out.screens) {
    for (const rel of sc.files) {
      if (!/\.(tsx?|jsx?)$/.test(rel)) continue;
      const sf = parse(path.join(scanRoot, rel));
      if (!sf) continue;
      const lineOf = (n: tsTypes.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const add = (pattern: string | null, n: tsTypes.Node, how: string): void => {
        const to = pattern && byPattern(pattern);
        if (to) edges.push({ from: sc.name, to: to.name, file: rel, line: lineOf(n), how });
      };
      const visit = (n: tsTypes.Node): void => {
        if (ts.isCallExpression(n)) {
          const callee = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
          if (hashHelpers.has(callee)) {
            // hash('보는 곳', 대상): 주소 #/보는 곳(/대상). 대상이 비어 있으면 붙이지 않는다
            const view = strOf(n.arguments[0]);
            const arg = n.arguments[1];
            const lit = arg ? strOf(arg) : '';
            // 대상이 글자 상수면(예: 'reports') 그대로, 변수면 :x로 둔다. 글자 상수여야 고정 주소(#/manage/reports)와 맞춰 볼 수 있다
            if (view) add(`${hashPrefix}#/${view}${lit === '' ? '' : `/${lit ?? ':x'}`}`, n, `${callee}('${view}')`);
          } else if (helpers.has(callee)) { const key = strOf(n.arguments[0]); const addr = key ? table.get(key) : undefined; if (key && addr) add(addr, n, `${callee}('${key}')`); }
          else if (callee === 'navigate' || callee === 'nav' || ((callee === 'assign' || callee === 'replace') && /location$/.test(ts.isPropertyAccessExpression(n.expression) ? n.expression.expression.getText() : ''))) { for (const v of strsOf(n.arguments[0])) if (v.startsWith('/')) add(v, n, `${callee}("${v}")`); }
        } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && /(^|\.)location(\.href)?$/.test(n.left.getText())) {
          for (const v of strsOf(n.right)) if (v.startsWith('/')) add(v, n, `location = "${v}"`);
        } else if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text === 'to' && n.initializer) {
          const e = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
          for (const v of strsOf(e)) if (v.startsWith('/')) add(v, n, `to="${v}"`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  // 같은 이동은 하나로
  const seen = new Map<string, NavEdge>();
  for (const e of edges) { const k = `${e.from}>${e.to}`; if (!seen.has(k)) seen.set(k, e); }
  const found = [...seen.values()];

  const warnings: string[] = [];
  for (const sc of out.screens) {
    for (const t of sc.to) {
      if (t.target === sc.name) continue;
      if (!found.some((e) => e.from === sc.name && e.to === t.target)) warnings.push(`@screen ${sc.name}의 @to ${t.target}: 코드에서 이동을 찾지 못했다 — toPath('…') 같은 라우트 도우미 호출이나 to="/주소"로 써야 읽힌다 (${sc.file}:${sc.line})`);
    }
  }
  // 선언되지 않은 이동. 여러 화면이 함께 쓰는 파일(껍데기가 같은 화면을 불러 쓰는 경우 등)에서 읽은 이동은 어느 화면의 것인지 코드로 가를 수 없으므로,
  // 같은 자리·같은 대상은 한 묶음으로 보고 묶음 안의 어느 화면이든 @to로 선언했으면 맞는 것으로, 아무도 안 했으면 경고를 한 번만 낸다
  const groups = new Map<string, { edge: NavEdge; screens: string[]; declared: boolean }>();
  for (const e of found) {
    if (e.from === e.to) continue;
    const sc = out.screens.find((x) => x.name === e.from);
    if (!sc) continue;
    const key = `${e.file === sc.file ? `${sc.name}|` : ''}${e.file}:${e.line}>${e.to}`;
    const g = groups.get(key) ?? { edge: e, screens: [], declared: false };
    g.screens.push(e.from);
    if (sc.to.some((t) => t.target === e.to)) g.declared = true;
    groups.set(key, g);
  }
  for (const { edge: e, screens, declared } of groups.values()) {
    if (declared) continue;
    const where = `${e.file}:${e.line} ${e.how}`;
    warnings.push(screens.length === 1
      ? `선언되지 않은 이동 ${e.from} → ${e.to} (${where}) — @screen ${e.from}에 @to로 쓴다`
      : `선언되지 않은 이동 ${screens.join('·')} → ${e.to} (${where}) — 이 화면들이 함께 쓰는 파일이라 어느 화면의 이동인지 코드로 가를 수 없다. 해당하는 화면에 @to로 쓴다(하나라도 쓰면 맞는 것으로 본다)`);
  }
  return { edges: found, warnings, routes: Object.fromEntries(table) };
}

/** 명령: nav <프로젝트 루트> --src <소스 폴더> [--check] */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts, flags } = parseArgs(argv, ['check']);
  const root = path.resolve(pos[0] || '.');
  const r = detectNav(path.resolve(root, opts.src || 'src'), root);
  if (r.skipped) console.log(r.skipped);
  r.warnings.forEach((w) => console.log(`경고: ${w}`));
  console.log(`읽은 이동 ${r.edges.length}개, 경고 ${r.warnings.length}건`);
  if (flags.has('check')) return r.warnings.length ? 1 : 0;
  console.log(JSON.stringify(r.edges, null, 1));
  return undefined;
}
