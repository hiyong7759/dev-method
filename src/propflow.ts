/**
 * @spec prop-flow 화면에 실제로 그려지는 부분 가려내기
 * @why 한 컴포넌트가 입력값(prop)에 따라 여러 화면을 맡는 앱(예: VacationPage section="personal" | "group")은, 파일 단위로 화면을 보면 그 파일의 모든 단추·이동이 모든 화면에 붙는다. 실제로는 입력값에 따라 일부만 그려지므로, 라우트가 정한 입력값으로 조건을 계산해 그려지지 않는 부분을 걷어 낸다.
 * @basis 라우트 선언에서 읽은 입력값을 컴포넌트에 넣고, `cond && <X/>`, 삼항식, if/return, switch를 값이 아는 만큼 계산한다. 입력값은 자식 컴포넌트에도 속성으로 넘겨 같은 계산을 이어 간다. 값을 모르는 조건(권한, 서버 데이터, 사용자 입력, 상태)은 양쪽 다 그려질 수 있는 것으로 둔다. 이름 붙인 함수(const go = () => …)는 그려지는 곳에서 쓰일 때만 살아 있는 것으로 본다.
 * @contract 걷어 내는 것은 "확실히 그려지지 않는 것"뿐이다. 모르면 남긴다(없는 이동을 있다고 하는 쪽이 있는 이동을 없다고 하는 쪽보다 낫다). 결과는 파일별 제외 구간과 제외 파일이며, 쓰는 쪽(nav 등)이 그 구간 안의 것을 건너뛴다. 라우트 입력값을 못 읽으면 아무것도 걷지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type * as tsTypes from 'typescript';

type TsModule = typeof tsTypes;

/** 모르는 값 */
export const UNKNOWN: unique symbol = Symbol('unknown');
/** 아는 값(글자·숫자·참거짓·null·undefined) 또는 모르는 값 */
export type Ev = string | number | boolean | null | undefined | typeof UNKNOWN;
type Env = Map<string, Ev>;

/** 걷어 낸 결과: 파일(소스 폴더 기준)별 제외 구간 [시작, 끝)과, 통째로 그려지지 않는 파일 */
export interface Pruned {
  /** 파일별로 그려지지 않는 글자 위치 구간 */
  ranges: Map<string, Array<[number, number]>>;
  /** 어느 곳에서도 그려지지 않아 통째로 건너뛸 파일 */
  files: Set<string>;
}

/** 시작점: 라우트가 그리는 컴포넌트와 넘긴 입력값 */
export interface Entry {
  /** 컴포넌트가 정의된 파일(소스 폴더 기준) */
  file: string;
  /** 라우트 파일에서 부르는 컴포넌트 이름 */
  component: string;
  /** 라우트가 넘긴 입력값 */
  props: Record<string, string | number | boolean>;
  /** 펼침 속성이 있어 입력값을 다 알 수 없음 */
  spread?: boolean;
}

const MAX_DEPTH = 12;

/** JSX 요소의 속성에서 글자·숫자·참거짓으로 적힌 입력값을 읽는다(그 밖의 것은 빼고 spread 여부만 돌려준다) */
export function literalProps(ts: TsModule, el: tsTypes.JsxOpeningLikeElement): { props: Record<string, string | number | boolean>; spread: boolean } {
  const props: Record<string, string | number | boolean> = {};
  let spread = false;
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a)) { spread = true; continue; }
    const name = a.name.getText();
    const v = attrValue(ts, a, new Map());
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') props[name] = v;
  }
  return { props, spread };
}

function attrValue(ts: TsModule, a: tsTypes.JsxAttribute, env: Env, ev?: (e: tsTypes.Expression) => Ev): Ev {
  const v = a.initializer;
  if (!v) return true;
  if (ts.isStringLiteral(v)) return v.text;
  if (ts.isJsxExpression(v) && v.expression) return ev ? ev(v.expression) : evalLiteral(ts, v.expression, env);
  return UNKNOWN;
}

function evalLiteral(ts: TsModule, e: tsTypes.Expression, env: Env): Ev {
  return evaluate(ts, e, env, () => UNKNOWN);
}

/** 식의 값을 아는 만큼 계산한다. propOf는 props.x 같은 입력값 읽기를 풀어 준다 */
function evaluate(ts: TsModule, e: tsTypes.Node, env: Env, propOf: (obj: string, key: string) => Ev): Ev {
  const go = (n: tsTypes.Node): Ev => evaluate(ts, n, env, propOf);
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) return go(e.expression);
  if (ts.isStringLiteralLike(e)) return e.text;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(e)) {
    if (e.text === 'undefined') return undefined;
    return env.has(e.text) ? env.get(e.text) as Ev : UNKNOWN;
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) return propOf(e.expression.text, e.name.text);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) { const v = go(e.operand); return v === UNKNOWN ? UNKNOWN : !v; }
  if (ts.isConditionalExpression(e)) { const c = go(e.condition); return c === UNKNOWN ? UNKNOWN : c ? go(e.whenTrue) : go(e.whenFalse); }
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    const S = ts.SyntaxKind;
    if (k === S.AmpersandAmpersandToken) { const l = go(e.left); return l === UNKNOWN ? UNKNOWN : l ? go(e.right) : l; }
    if (k === S.BarBarToken) { const l = go(e.left); return l === UNKNOWN ? UNKNOWN : l ? l : go(e.right); }
    if (k === S.QuestionQuestionToken) { const l = go(e.left); return l === UNKNOWN ? UNKNOWN : l == null ? go(e.right) : l; }
    if (k === S.EqualsEqualsEqualsToken || k === S.ExclamationEqualsEqualsToken || k === S.EqualsEqualsToken || k === S.ExclamationEqualsToken) {
      const l = go(e.left), r = go(e.right);
      if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
      const same = (k === S.EqualsEqualsToken || k === S.ExclamationEqualsToken) ? l == r : l === r;
      return (k === S.EqualsEqualsEqualsToken || k === S.EqualsEqualsToken) ? same : !same;
    }
  }
  return UNKNOWN;
}

/** 이 컴포넌트가 어느 파일의 무엇인지 */
interface Ref { file: string; exported: string }

/** 입력값에 따라 그려지지 않는 부분을 걷어 낸다. entries가 여럿이면(같은 화면이 주소 여럿) 한 곳에서라도 그려지는 것은 남긴다 */
export function pruneByProps(ts: TsModule, scanRoot: string, options: tsTypes.CompilerOptions, entries: Entry[]): Pruned {
  const rel = (f: string): string => path.relative(scanRoot, f);
  const abs = (f: string): string => path.join(scanRoot, f);

  interface Info { sf: tsTypes.SourceFile; imports: Map<string, Ref> }
  const infos = new Map<string, Info | null>();
  const info = (file: string): Info | null => {
    if (infos.has(file)) return infos.get(file) ?? null;
    let res: Info | null = null;
    try {
      const f = abs(file);
      const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const imports = new Map<string, Ref>();
      const resolve = (spec: string): string => {
        const r = ts.resolveModuleName(spec, f, options, ts.sys).resolvedModule?.resolvedFileName;
        return r && r.startsWith(scanRoot) && !r.includes('node_modules') ? rel(r) : '';
      };
      const dyn = (n: tsTypes.Node): string | null => {
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
          if (!to) continue;
          if (st.importClause.name) imports.set(st.importClause.name.text, { file: to, exported: 'default' });
          const nb = st.importClause.namedBindings;
          if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports.set(el.name.text, { file: to, exported: (el.propertyName ?? el.name).text });
        } else if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            const spec = ts.isIdentifier(d.name) && d.initializer ? dyn(d.initializer) : null;
            const to = spec ? resolve(spec) : '';
            if (to && ts.isIdentifier(d.name)) imports.set(d.name.text, { file: to, exported: 'default' });
          }
        }
      }
      res = { sf, imports };
    } catch { res = null; }
    infos.set(file, res);
    return res;
  };

  type Fn = tsTypes.ArrowFunction | tsTypes.FunctionExpression | tsTypes.FunctionDeclaration;
  const isFn = (n: tsTypes.Node | undefined): n is Fn => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n));
  /** memo(X), forwardRef(X), 괄호·타입 단언을 벗겨 함수를 찾는다 */
  const unwrap = (e: tsTypes.Node | undefined, sf: tsTypes.SourceFile): Fn | null => {
    let n: tsTypes.Node | undefined = e;
    for (let i = 0; n && i < 6; i++) {
      if (isFn(n)) return n;
      if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) n = n.expression;
      else if (ts.isCallExpression(n) && n.arguments[0]) n = n.arguments[0];
      else if (ts.isIdentifier(n)) return findLocal(sf, n.text);
      else return null;
    }
    return null;
  };
  const findLocal = (sf: tsTypes.SourceFile, name: string): Fn | null => {
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) { const f = unwrap(d.initializer, sf); if (f) return f; }
    }
    return null;
  };
  const findComponent = (sf: tsTypes.SourceFile, exported: string): Fn | null => {
    if (exported !== 'default') return findLocal(sf, exported);
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return st;
      if (ts.isExportAssignment(st)) return unwrap(st.expression, sf);
    }
    return null;
  };

  // 컴포넌트(파일#이름)마다 방문마다의 제외 구간. 같은 컴포넌트를 여러 번 방문하면 모든 방문에서 제외된 구간만 제외한다
  const visits = new Map<string, Array<Set<string>>>();
  const liveFiles = new Set<string>();
  const deadRefs = new Set<string>();
  const seen = new Set<string>();

  const keyOf = (file: string, exported: string): string => `${file}#${exported}`;

  const visitComponent = (file: string, exported: string, props: Map<string, Ev>, spread: boolean, depth: number): void => {
    const key = `${keyOf(file, exported)}|${[...props].map(([k, v]) => `${k}=${v === UNKNOWN ? '?' : JSON.stringify(v)}`).sort().join(',')}|${spread}`;
    if (seen.has(key) || depth > MAX_DEPTH) return;
    seen.add(key);
    const inf = info(file);
    if (!inf) return;
    const fn = findComponent(inf.sf, exported);
    if (!fn) return;
    liveFiles.add(file);
    const dead = new Set<string>();
    const list = visits.get(keyOf(file, exported)) ?? [];
    list.push(dead);
    visits.set(keyOf(file, exported), list);

    const env: Env = new Map();
    const propObjs = new Map<string, (k: string) => Ev>();
    const lookup = (k: string): Ev => props.has(k) ? props.get(k) as Ev : spread ? UNKNOWN : undefined;
    const names = (p: tsTypes.BindingName, out: string[] = []): string[] => {
      if (ts.isIdentifier(p)) out.push(p.text);
      else for (const el of p.elements) if (ts.isBindingElement(el)) names(el.name, out);
      return out;
    };
    const propOf = (obj: string, key: string): Ev => propObjs.has(obj) ? (propObjs.get(obj) as (k: string) => Ev)(key) : UNKNOWN;
    const ev = (e: tsTypes.Node): Ev => evaluate(ts, e, env, propOf);
    const bindPattern = (pat: tsTypes.ObjectBindingPattern, from: (k: string) => Ev): void => {
      for (const el of pat.elements) {
        if (!ts.isIdentifier(el.name)) { for (const n of names(el.name)) env.set(n, UNKNOWN); continue; }
        if (el.dotDotDotToken) { env.set(el.name.text, UNKNOWN); continue; }
        const k = el.propertyName ? el.propertyName.getText() : el.name.text;
        let v = from(k);
        if (v === undefined && el.initializer) v = ev(el.initializer);
        env.set(el.name.text, v);
      }
    };
    const p0 = fn.parameters[0];
    if (p0) {
      if (ts.isObjectBindingPattern(p0.name)) bindPattern(p0.name, lookup);
      else if (ts.isIdentifier(p0.name)) propObjs.set(p0.name.text, lookup);
    }

    const markDead = (start: number, end: number, ...nodes: tsTypes.Node[]): void => {
      dead.add(`${start}-${end}`);
      for (const n of nodes) refsIn(n, inf, (r) => deadRefs.add(r.file));
    };
    // 이름 붙인 함수는 그려지는 곳에서 쓰일 때만 살아 있다
    const pending = new Map<string, { node: tsTypes.Node; body: tsTypes.Node; env: Env }>();
    const run = (n: tsTypes.Node, e: Env): void => { const saved = new Map(env); env.clear(); for (const [k, v] of e) env.set(k, v); try { walk(n); } finally { env.clear(); for (const [k, v] of saved) env.set(k, v); } };

    const exits = (s: tsTypes.Statement): boolean => {
      if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) return true;
      if (ts.isBlock(s)) return s.statements.some(exits);
      if (ts.isIfStatement(s)) return !!s.elseStatement && exits(s.thenStatement) && exits(s.elseStatement);
      return false;
    };

    const walkStatements = (stmts: readonly tsTypes.Statement[]): void => {
      for (const st of stmts) if (ts.isFunctionDeclaration(st) && st.name && st.body) pending.set(st.name.text, { node: st, body: st.body, env: new Map(env) });
      for (let i = 0; i < stmts.length; i++) {
        const st = stmts[i];
        if (ts.isFunctionDeclaration(st) && st.name) continue;
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && isFn(d.initializer)) { pending.set(d.name.text, { node: d, body: d.initializer, env: new Map(env) }); env.set(d.name.text, UNKNOWN); continue; }
            if (d.initializer) walk(d.initializer);
            if (ts.isObjectBindingPattern(d.name) && d.initializer && ts.isIdentifier(d.initializer) && propObjs.has(d.initializer.text)) bindPattern(d.name, propObjs.get(d.initializer.text) as (k: string) => Ev);
            else if (ts.isIdentifier(d.name)) env.set(d.name.text, d.initializer ? ev(d.initializer) : undefined);
            else for (const n of names(d.name)) env.set(n, UNKNOWN);
          }
          continue;
        }
        walk(st);
        // 아는 조건이 참이고 그 안에서 돌려보내면 그 아래는 그려지지 않는다
        if (ts.isIfStatement(st) && i + 1 < stmts.length) {
          const c = ev(st.expression);
          if (c !== UNKNOWN && c && exits(st.thenStatement)) { const rest = stmts.slice(i + 1); markDead(rest[0].getStart(), rest[rest.length - 1].end, ...rest); return; }
        }
        if (exits(st) && i + 1 < stmts.length) {
          const rest = stmts.slice(i + 1).filter((s) => !ts.isFunctionDeclaration(s));
          if (rest.length) markDead(rest[0].getStart(), rest[rest.length - 1].end);
          return;
        }
      }
    };

    const walk = (n: tsTypes.Node): void => {
      if (ts.isIdentifier(n)) {
        const p = pending.get(n.text);
        if (p) { pending.delete(n.text); run(p.body, p.env); }
        return;
      }
      if (ts.isBlock(n)) { const saved = new Map(env); walkStatements(n.statements); env.clear(); for (const [k, v] of saved) env.set(k, v); return; }
      if (ts.isIfStatement(n)) {
        walk(n.expression);
        const c = ev(n.expression);
        const sub = (s: tsTypes.Statement): void => { const saved = new Map(env); walk(s); env.clear(); for (const [k, v] of saved) env.set(k, v); };
        if (c === UNKNOWN) { sub(n.thenStatement); if (n.elseStatement) sub(n.elseStatement); }
        else if (c) { sub(n.thenStatement); if (n.elseStatement) markDead(n.elseStatement.getStart(), n.elseStatement.end, n.elseStatement); }
        else { markDead(n.thenStatement.getStart(), n.thenStatement.end, n.thenStatement); if (n.elseStatement) sub(n.elseStatement); }
        return;
      }
      if (ts.isSwitchStatement(n)) {
        walk(n.expression);
        const v = ev(n.expression);
        let fall = false;
        const labels = n.caseBlock.clauses.map((c) => (ts.isCaseClause(c) ? ev(c.expression) : null));
        const any = v !== UNKNOWN && labels.some((l, i) => ts.isCaseClause(n.caseBlock.clauses[i]) && l !== UNKNOWN && l === v);
        n.caseBlock.clauses.forEach((c, i) => {
          const l = labels[i];
          const hit = v !== UNKNOWN && ts.isCaseClause(c) && l !== UNKNOWN && l === v;
          const live = fall || v === UNKNOWN || (ts.isCaseClause(c) && l === UNKNOWN) || hit || (ts.isDefaultClause(c) && !any);
          if (c.statements.length) {
            if (live) { const saved = new Map(env); walkStatements(c.statements); env.clear(); for (const [k, x] of saved) env.set(k, x); }
            else markDead(c.statements[0].getStart(), c.statements[c.statements.length - 1].end, c);
            fall = live && !c.statements.some(exits) && !c.statements.some((s) => ts.isBreakStatement(s) || (ts.isBlock(s) && s.statements.some((t) => ts.isBreakStatement(t))));
          } else fall = fall || live;
        });
        return;
      }
      if (ts.isConditionalExpression(n)) {
        walk(n.condition);
        const c = ev(n.condition);
        if (c === UNKNOWN) { walk(n.whenTrue); walk(n.whenFalse); }
        else if (c) { walk(n.whenTrue); markDead(n.whenFalse.getStart(), n.whenFalse.end, n.whenFalse); }
        else { markDead(n.whenTrue.getStart(), n.whenTrue.end, n.whenTrue); walk(n.whenFalse); }
        return;
      }
      if (ts.isBinaryExpression(n)) {
        const k = n.operatorToken.kind;
        const S = ts.SyntaxKind;
        if (k === S.AmpersandAmpersandToken || k === S.BarBarToken || k === S.QuestionQuestionToken) {
          walk(n.left);
          const l = ev(n.left);
          const skip = l !== UNKNOWN && (k === S.AmpersandAmpersandToken ? !l : k === S.BarBarToken ? !!l : l != null);
          if (skip) markDead(n.right.getStart(), n.right.end, n.right); else walk(n.right);
          return;
        }
      }
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
        useComponent(n);
        for (const a of n.attributes.properties) { if (ts.isJsxAttribute(a)) { if (a.initializer) walk(a.initializer); } else walk(a); }
        return;
      }
      if (isFn(n)) {
        const saved = new Map(env);
        for (const p of n.parameters) for (const nm of names(p.name)) env.set(nm, UNKNOWN);
        if (n.body) walk(n.body);
        env.clear(); for (const [k, v] of saved) env.set(k, v);
        return;
      }
      ts.forEachChild(n, walk);
    };

    const useComponent = (el: tsTypes.JsxOpeningLikeElement): void => {
      const tag = el.tagName;
      if (!ts.isIdentifier(tag) || !/^[A-Z]/.test(tag.text)) return;
      const target = inf.imports.get(tag.text) ?? (findLocal(inf.sf, tag.text) ? { file, exported: tag.text } : null);
      if (!target) return;
      const next = new Map<string, Ev>();
      let sp = false;
      for (const a of el.attributes.properties) {
        if (!ts.isJsxAttribute(a)) { sp = true; continue; }
        next.set(a.name.getText(), attrValue(ts, a, env, ev));
      }
      visitComponent(target.file, target.exported, next, sp, depth + 1);
    };

    const body = fn.body;
    if (body) {
      if (ts.isBlock(body)) walkStatements(body.statements);
      else walk(body);
    }
    // 끝까지 쓰이지 않은 이름 붙인 함수는 그려지지 않는 것으로 본다
    for (const p of pending.values()) markDead(p.node.getStart(), p.node.end, p.body);
  };

  /** 노드 안에서 쓴 컴포넌트가 가리키는 파일들 */
  function refsIn(n: tsTypes.Node, inf: Info, hit: (r: Ref) => void): void {
    const look = (x: tsTypes.Node): void => {
      if ((ts.isJsxSelfClosingElement(x) || ts.isJsxOpeningElement(x)) && ts.isIdentifier(x.tagName)) { const r = inf.imports.get(x.tagName.text); if (r) hit(r); }
      ts.forEachChild(x, look);
    };
    look(n);
  }

  for (const e of entries) {
    const props = new Map<string, Ev>(Object.entries(e.props));
    // 라우트 파일에서 부르는 이름과 정의된 파일에서의 내보낸 이름이 다를 수 있다(default 내보내기)
    const sf = info(e.file)?.sf;
    visitComponent(e.file, sf && findComponent(sf, e.component) ? e.component : 'default', props, !!e.spread, 0);
  }

  // 컴포넌트별로 모든 방문에서 제외된 구간만 남긴다
  const ranges = new Map<string, Array<[number, number]>>();
  for (const [key, list] of visits) {
    const file = key.slice(0, key.lastIndexOf('#'));
    const common = [...list[0]].filter((r) => list.every((s) => s.has(r)));
    const arr = ranges.get(file) ?? [];
    for (const r of common) { const [a, b] = r.split('-').map(Number); arr.push([a, b]); }
    ranges.set(file, arr);
  }
  const files = new Set([...deadRefs].filter((f) => !liveFiles.has(f)));
  return { ranges, files };
}

/** 위치가 제외 구간 안인가 */
export function isPruned(p: Pruned | null | undefined, file: string, pos: number): boolean {
  if (!p) return false;
  if (p.files.has(file)) return true;
  return !!p.ranges.get(file)?.some(([a, b]) => a <= pos && pos < b);
}
