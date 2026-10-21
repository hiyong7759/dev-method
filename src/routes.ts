/**
 * @spec jsx-routes React Router의 <Route> 선언 읽기
 * @why 라우트가 <Route path=… element={<화면 />}>로 선언된 프로젝트는 화면마다 @route를 손으로 또 써야 했다. 같은 사실을 두 번 쓰면 어긋나므로, 라우트 선언에서 주소를 읽어 화면에 이어 준다.
 * @basis 중첩된 <Route>의 path를 이어 붙여 전체 주소를 만들고(index는 부모 주소, 맨 앞이 /가 아니면 부모 뒤에 붙임), element의 컴포넌트가 어느 파일에서 오는지는 그 파일의 import와 lazy(() => import('…')) 에서 읽는다. 파일 위치는 프로젝트 tsconfig의 별칭(@/ 등)까지 따라간다. path가 없는 <Route>(레이아웃·로그인 보호)는 주소를 만들지 않고 아래 경로들에 "감싸는 것"으로 남긴다.
 * @contract 프로젝트에 typescript가 설치돼 있어야 읽고, 없거나 <Route>가 없으면 빈 목록을 돌려준다(도구가 멈추지 않는다). 주소 → 파일 한 쌍씩 돌려주며, 화면과의 짝짓기(화면 파일이 그 파일이거나 그 파일이 import하는 파일)는 부르는 쪽(extract)이 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type * as tsTypes from 'typescript';

type TsModule = typeof tsTypes;

/** 라우트 하나: 전체 주소, element가 가리키는 파일(소스 폴더 기준), 그 주소를 감싸는 컴포넌트들 */
export interface JsxRoute {
  /** 전체 주소(예: /hr/vacation/group, 게시물 상세는 /board/:pstSn) */
  path: string;
  /** element 컴포넌트가 정의된 파일(소스 폴더 기준). 못 찾으면 빈 글 */
  file: string;
  /** element 컴포넌트 이름 */
  component: string;
  /** 그 파일이 바로 import하는 파일들(소스 폴더 기준). 얇은 껍데기 파일이 진짜 화면 파일을 불러오는 경우에 화면과 짝짓는 데 쓴다 */
  imports: string[];
  /** 이 주소를 감싸는 컴포넌트 이름들(바깥부터). 예: PrivateRoute, Layout */
  wrappers: string[];
}

/** 소스 폴더 아래에서 <Route가 들어 있는 파일들 */
function filesWithRoutes(dir: string, out: string[] = []): string[] {
  let names: fs.Dirent[] = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
    const f = path.join(dir, d.name);
    if (d.isDirectory()) filesWithRoutes(f, out);
    else if (/\.(tsx|jsx)$/.test(d.name)) { try { if (fs.readFileSync(f, 'utf8').includes('<Route')) out.push(f); } catch { /* 못 읽는 파일은 건너뜀 */ } }
  }
  return out;
}

/** 부모 주소에 자식 path를 붙인다 */
function joinPath(parent: string, child: string): string {
  if (child.startsWith('/')) return child;
  return `${parent.replace(/\/$/, '')}/${child}`.replace(/\/+/g, '/');
}

/** 소스 폴더의 <Route> 선언을 읽어 주소 → 파일 목록을 만든다 */
export function readJsxRoutes(scanRoot: string, projectRoot: string): JsxRoute[] {
  let ts: TsModule;
  try { ts = createRequire(path.join(projectRoot, 'package.json'))('typescript') as TsModule; } catch { return []; }
  const files = filesWithRoutes(scanRoot);
  if (!files.length) return [];
  // 프로젝트 tsconfig의 별칭(@/ 등)을 파일 위치 찾기에 쓴다
  let options: tsTypes.CompilerOptions = {};
  try {
    const cfgPath = path.join(projectRoot, 'tsconfig.json');
    const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (!cfg.error) options = ts.parseJsonConfigFileContent(cfg.config, ts.sys, projectRoot).options;
  } catch { /* 설정이 없으면 상대 경로만 따라간다 */ }
  const rel = (f: string): string => path.relative(scanRoot, f);
  const out: JsxRoute[] = [];

  for (const file of files) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
    // 이 파일의 컴포넌트 이름 → 파일: import 문과 lazy(() => import('…'))
    const where = new Map<string, string>();
    const resolve = (spec: string): string => {
      const r = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule?.resolvedFileName;
      return r && r.startsWith(scanRoot) && !r.includes('node_modules') ? rel(r) : '';
    };
    const dynamicImport = (n: tsTypes.Node): string | null => {
      let found: string | null = null;
      const look = (x: tsTypes.Node): void => {
        if (ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.ImportKeyword && x.arguments[0] && ts.isStringLiteralLike(x.arguments[0])) found = x.arguments[0].text;
        if (!found) ts.forEachChild(x, look);
      };
      look(n);
      return found;
    };
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause) {
        const to = resolve(st.moduleSpecifier.text);
        if (st.importClause.name) where.set(st.importClause.name.text, to);
        const nb = st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) where.set(el.name.text, to);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const spec = ts.isIdentifier(d.name) && d.initializer ? dynamicImport(d.initializer) : null;
          if (spec && ts.isIdentifier(d.name)) where.set(d.name.text, resolve(spec));
        }
      }
    }
    const attr = (el: tsTypes.JsxOpeningLikeElement, name: string): tsTypes.JsxAttribute | undefined =>
      el.attributes.properties.find((a): a is tsTypes.JsxAttribute => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === name);
    const textOf = (a: tsTypes.JsxAttribute | undefined): string | null => {
      const v = a?.initializer;
      if (!v) return null;
      if (ts.isStringLiteral(v)) return v.text;
      if (ts.isJsxExpression(v) && v.expression && ts.isStringLiteralLike(v.expression)) return v.expression.text;
      return null;
    };
    /** element={<이름 …/>} 에서 바깥 컴포넌트 이름 */
    const elementName = (a: tsTypes.JsxAttribute | undefined): string => {
      const v = a?.initializer;
      if (!v || !ts.isJsxExpression(v) || !v.expression) return '';
      let e: tsTypes.Expression = v.expression;
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isJsxSelfClosingElement(e)) return e.tagName.getText();
      if (ts.isJsxElement(e)) return e.openingElement.tagName.getText();
      return '';
    };

    const walk = (node: tsTypes.Node, parent: string, wrappers: string[]): void => {
      let here = parent, wr = wrappers;
      let children: readonly tsTypes.Node[] = [];
      let opening: tsTypes.JsxOpeningLikeElement | null = null;
      if (ts.isJsxElement(node)) { opening = node.openingElement; children = node.children; }
      else if (ts.isJsxSelfClosingElement(node)) opening = node;
      if (opening && opening.tagName.getText() === 'Route') {
        const p = textOf(attr(opening, 'path'));
        const isIndex = !!attr(opening, 'index');
        const comp = elementName(attr(opening, 'element'));
        if (p != null) here = joinPath(parent, p);
        const target = (p != null || isIndex) ? here : '';
        if (target && comp) out.push({ path: target, file: where.get(comp) ?? '', component: comp, imports: [], wrappers });
        // 주소가 없는 <Route element=…>는 레이아웃·보호 장치이고, 주소가 있어도 자식이 있으면 그 element는 아래를 감싼다
        if (comp && (children.length > 0)) wr = [...wrappers, comp];
      } else if (opening) {
        // Routes, 또는 <Route>를 품은 다른 요소: 자식 안의 Route를 계속 찾는다
        children = ts.isJsxElement(node) ? node.children : [];
      } else {
        ts.forEachChild(node, (c) => walk(c, parent, wrappers));
        return;
      }
      for (const c of children) walk(c, here, wr);
    };
    walk(sf, '/', []);
  }
  // element 파일이 바로 import하는 파일들(껍데기 파일이 진짜 화면을 불러오는 경우)
  const importsCache = new Map<string, string[]>();
  const importsOf = (fileRel: string): string[] => {
    if (!fileRel) return [];
    const hit = importsCache.get(fileRel);
    if (hit) return hit;
    const abs = path.join(scanRoot, fileRel);
    const found: string[] = [];
    try {
      const text = fs.readFileSync(abs, 'utf8');
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
        const r = ts.resolveModuleName(m[1], abs, options, ts.sys).resolvedModule?.resolvedFileName;
        if (r && r.startsWith(scanRoot) && !r.includes('node_modules')) found.push(rel(r));
      }
    } catch { /* 못 읽는 파일은 빈 목록 */ }
    importsCache.set(fileRel, found);
    return found;
  };
  for (const r of out) r.imports = importsOf(r.file);
  // 같은 주소가 중복 선언돼도 하나로(먼저 읽은 것)
  const seen = new Set<string>();
  return out.filter((r) => { const k = `${r.path}|${r.file}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
