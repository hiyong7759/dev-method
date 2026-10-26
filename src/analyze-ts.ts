/**
 * @spec analyze-ts 코드에서 정보와 그 사용 읽기
 * @why 설계서를 따로 쓰지 않고도 "어떤 정보가 있고, 누가 만들고 읽고 바꾸나"를 코드에서 바로 보게 한다. 코드에 있는 것은 읽고, 코드에 없는 것(정보의 뜻·용도)만 주석으로 받는다. 그래서 분석 결과는 설계 원본이 아니라 언제든 다시 만드는 파생물이다.
 * @basis TypeScript 언어 서비스의 참조 분석(필드 단위, 읽기와 쓰기 구분)을 쓴다. 분석 대상 프로젝트의 node_modules에 있는 typescript를 쓴다. 정보 후보는 export된 interface, type, enum이고, 한 파일에서만 쓰이는 것도 담되 external=0으로 표시한다.
 * @contract 틀릴 수 있는 곳을 숨기지 않는다. 쓰기·읽기가 안 보이는 필드는 "확정"이 아니라, 같은 이름의 다른 정의나 문자열 참조가 있으면 "후보"로 구분한다(같은 정보를 손으로 다시 정의하거나 문자열 이름으로 다루면 TypeScript가 같은 정보로 연결하지 못한다). 결과의 모양은 types.ts의 Analysis다.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type * as tsTypes from 'typescript';
import { parseArgs } from './cli.js';
import type { Analysis, AnalyzedInfo, AnalyzedProp, DomHint, DupDef, Place, PropRef, PropStatus } from './types.js';

type TsModule = typeof tsTypes;

/** 분석에서 뺄 폴더(내려받은 것, 빌드 결과, 모바일 프로젝트 폴더 등) */
const SKIP = /(^|\/)(node_modules|dist|build|\.git|\.expo|ios|android)(\/|$)/;
/** 테스트 파일인가 */
const isTest = (f: string): boolean => /(^|\/)__tests__\//.test(f) || /\.(test|spec)\.[tj]sx?$/.test(f);

/** 프로젝트 안(세 단계 깊이까지)의 tsconfig.json들 */
function findTsconfigs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP.test(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1); }
      else if (e.name === 'tsconfig.json') out.push(path.join(dir, e.name));
    }
  };
  walk(root, 0);
  return out;
}

/** 분석 중에 쌓는 필드(마지막에 AnalyzedProp으로 다듬는다) */
interface RawProp {
  name: string; optional: boolean; type: string; line: number; doc: string; pos: number;
  reads: Record<string, number>; writes: Record<string, number>; refs: PropRef[]; seen: Set<string>; fnDone: Set<string> | null;
}
/** 분석 중에 쌓는 정보 */
interface RawInfo {
  id: string; name: string; kind: AnalyzedInfo['kind']; file: string; line: number; doc: string;
  typeRefs: Set<string>; typeAreas: Record<string, number>; typeFiles?: Set<string>; props: RawProp[];
}
/** 필드 이름을 가진 모든 타입(복제 정의 후보를 찾는 데 쓴다) */
interface OwnerEntry extends DupDef { declPos: string }

/** 프로젝트 루트의 TypeScript 프로젝트들을 읽어 정보와 필드의 쓰임을 분석한다 */
export function analyzeTs(rootIn: string, opts: { tsconfigs?: string[] } = {}): Analysis {
  const root = path.resolve(rootIn);
  let ts: TsModule;
  try { ts = createRequire(path.join(root, 'package.json'))('typescript') as TsModule; }
  catch { throw new Error(`${root}에서 typescript를 찾지 못했다 (프로젝트에 설치돼 있어야 한다)`); }

  const rel = (f: string): string => path.relative(root, f);
  /** 파일이 앱의 어느 영역에 속하는지(쓰임을 영역별로 세려고) */
  const areaOf = (file: string): string => {
    const r = rel(file);
    if (isTest(r)) return '테스트';
    let m = r.match(/^apps\/([^/]+)\/src\/([^/]+)\//); if (m) return `${m[1]}/${m[2]}`;
    m = r.match(/^apps\/([^/]+)\//); if (m) return m[1];
    m = r.match(/^packages\/([^/]+)\//); if (m) return `packages/${m[1]}`;
    m = r.match(/^src\/([^/]+)\//); if (m) return m[1];
    return r.split('/')[0];
  };

  const tsconfigs = (opts.tsconfigs || findTsconfigs(root)).map((p) => path.resolve(root, p));
  const infos = new Map<string, RawInfo>();           // 선언 위치 → 정보
  const owners = new Map<string, OwnerEntry[]>();     // 필드 이름 → 그 이름을 가진 모든 타입·인라인 타입
  const strings = new Map<string, Place[]>();         // 문자열 리터럴 → 위치
  const seenFiles = new Set<string>();
  const startedAt = Date.now();

  const exported = (n: tsTypes.Node): boolean => !!(ts.getCombinedModifierFlags(n as tsTypes.Declaration) & ts.ModifierFlags.Export);
  const nameOf = (m: tsTypes.NamedDeclaration | tsTypes.TypeElement): string | null => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : null);
  /** 파일의 pos 위치를 가장 안쪽에서 품은 노드 */
  const nodeAt = (sf: tsTypes.SourceFile, pos: number): tsTypes.Node => {
    let node: tsTypes.Node = sf;
    for (let again = true; again;) { again = false; ts.forEachChild(node, (c) => { if (!again && c.getStart() <= pos && pos < c.getEnd()) { node = c; again = true; } }); }
    return node;
  };
  /** 정의 바로 위 주석(JSDoc 또는 일반 주석)의 글 */
  const docOf = (n: tsTypes.Node, sf: tsTypes.SourceFile): string => {
    const parts: string[] = [];
    for (const d of (n as tsTypes.Node & { jsDoc?: tsTypes.JSDoc[] }).jsDoc || []) {
      const text = typeof d.comment === 'string' ? d.comment : (d.comment || []).map((c) => c.text).join('');
      // 줄 중간의 "@이름"도 TS는 태그로 쪼개므로, 줄 맨 앞이 아닌 태그는 본문에 이어 붙여 선언(@external 등)으로 읽히지 않게 한다
      let body = text;
      for (const t of d.tags || []) {
        const lineStart = sf.text.lastIndexOf('\n', t.getStart()) + 1;
        const atLineHead = /^[\s*/]*$/.test(sf.text.slice(lineStart, t.getStart()));
        body += `${atLineHead ? '\n' : ' '}@${t.tagName.text} ${typeof t.comment === 'string' ? t.comment : ''}`;
      }
      parts.push(body);
    }
    if (!parts.length) {
      const text = sf.text;
      for (const r of ts.getLeadingCommentRanges(text, n.getFullStart()) || []) parts.push(text.slice(r.pos, r.end).replace(/^\/\/+|^\/\*+|\*+\/$/gm, '').trim());
    }
    return parts.join('\n').trim();
  };
  /** 쓰기 참조가 입력(새 값을 만듦)인지 수정(있던 값을 바꿈)인지: 객체 리터럴에 ...펼침이 없으면 입력, 펼침이 있거나 대입이면 수정 */
  /** 참조가 구조 분해(`const { a } = 값`, 함수 인자 `({ a }: 타입)`)에서 속성 이름을 꺼내 쓰는 자리인가. 언어 서비스는 이것을 쓰기로 알려 주지만 값을 읽는 것이다 */
  const isDestructureRead = (sf: tsTypes.SourceFile | undefined, pos: number): boolean => {
    if (!sf) return false;
    const par = nodeAt(sf, pos).parent;
    return !!par && ts.isBindingElement(par) && ts.isObjectBindingPattern(par.parent);
  };
  const writeKind = (sf: tsTypes.SourceFile | undefined, pos: number): 'create' | 'update' | 'write' => {
    if (!sf) return 'write';
    const par = nodeAt(sf, pos).parent;
    if (par && (ts.isPropertyAssignment(par) || ts.isShorthandPropertyAssignment(par)) && ts.isObjectLiteralExpression(par.parent)) {
      return par.parent.properties.some((x) => ts.isSpreadAssignment(x)) ? 'update' : 'create';
    }
    if (par && ts.isPropertyAccessExpression(par) && par.parent && ts.isBinaryExpression(par.parent) && par.parent.left === par) return 'update';
    return 'write';
  };
  // 이 참조가 화면에 값을 그리는 곳이면, 그 요소를 화면에서 찾을 선택자 힌트를 만든다.
  // {값}이 든 JSX 요소의 className(첫 고정 이름)을 쓰고, 없으면 가까운 className 조상 아래의 태그로 찾는다. 요소 안에 다른 것이 섞여 있으면 mode:'text'(그 요소의 글자 부분만)
  // 함수 안(필터·정렬 콜백 등)에서 읽은 값은 화면에 그리는 곳이 아니므로 힌트를 만들지 않는다
  type JsxEl = tsTypes.JsxElement | tsTypes.JsxSelfClosingElement | tsTypes.JsxOpeningElement;
  /** JSX 요소의 className에서 첫 고정 이름 하나 */
  const classToken = (el: JsxEl): string | null => {
    const open = ts.isJsxElement(el) ? el.openingElement : el;
    const attr = open.attributes.properties.find((a) => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === 'className') as tsTypes.JsxAttribute | undefined;
    if (!attr || !attr.initializer) return null;
    let text: string | null = null;
    const init = attr.initializer;
    if (ts.isStringLiteral(init)) text = init.text;
    else if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isStringLiteralLike(e)) text = e.text;
      else if (ts.isTemplateExpression(e)) text = e.head.text;
      else if (ts.isConditionalExpression(e) && ts.isStringLiteralLike(e.whenTrue)) text = e.whenTrue.text;
    }
    const tok = (text || '').trim().split(/\s+/)[0];
    return tok && /^[\w-]+$/.test(tok) ? tok : null;
  };
  const domHint = (sf: tsTypes.SourceFile | undefined, pos: number): DomHint | null => {
    if (!sf || !/\.(tsx|jsx)$/.test(sf.fileName)) return null;
    let cur: tsTypes.Node | undefined = nodeAt(sf, pos);
    let expr: tsTypes.JsxExpression | null = null;
    while (cur && cur !== sf) {
      if (ts.isJsxExpression(cur)) { expr = cur; break; }
      if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur) || ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur) || ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) return null;
      cur = cur.parent;
    }
    if (!expr) return null;
    let el: JsxEl;
    let mode: DomHint['mode'] = 'el';
    // 속성에 쓴 값은 눈에 보이는 속성(모양·글자·그림)일 때만 인정한다. to·href·key·onClick 같은 것은 화면에 안 나온다
    const parent = expr.parent;
    if (ts.isJsxAttribute(parent)) {
      if (!ts.isIdentifier(parent.name) || !['className', 'style', 'value', 'defaultValue', 'checked', 'src', 'alt', 'placeholder', 'title', 'label'].includes(parent.name.text)) return null;
      el = parent.parent.parent;
    } else if (ts.isJsxElement(parent)) {
      el = parent;
      const real = parent.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
      mode = real.length === 1 ? 'el' : 'text';
    } else return null;
    const tag = (ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName).getText();
    const own = classToken(el);
    let sel = own ? `.${own}` : null;
    if (!sel && /^[a-z]/.test(tag)) {
      for (let a: tsTypes.Node | undefined = el.parent; a; a = a.parent) {
        if ((ts.isJsxElement(a) || ts.isJsxSelfClosingElement(a)) && classToken(a)) { sel = `.${classToken(a)} ${tag}`; break; }
      }
    }
    return sel ? { sel, mode } : null;
  };
  /** 이 위치를 품은 이름 있는 함수(function foo / const foo = () => …). 화면 파일이 아닌 곳에서 필드를 읽는 함수를 찾는 데 쓴다 */
  const fnAt = (sf: tsTypes.SourceFile | undefined, pos: number): { name: string; pos: number; file: string } | null => {
    if (!sf) return null;
    for (let cur: tsTypes.Node | undefined = nodeAt(sf, pos); cur && cur !== sf; cur = cur.parent) {
      if (ts.isFunctionDeclaration(cur) && cur.name) return { name: cur.name.text, pos: cur.name.getStart(), file: sf.fileName };
      if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name) && cur.initializer && (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))) return { name: cur.name.text, pos: cur.name.getStart(), file: sf.fileName };
    }
    return null;
  };
  /** 필드가 속한 타입(또는 함수·변수)의 이름 */
  const ownerLabel = (node: tsTypes.Node): string => {
    for (let p: tsTypes.Node | undefined = node.parent; p; p = p.parent) {
      if ((ts.isFunctionDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isClassDeclaration(p)) && p.name) return p.name.text;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
      if (ts.isMethodDeclaration(p) && p.name) return p.name.getText();
    }
    return '(이름 없는 인라인 타입)';
  };
  const lineIn = (sf: tsTypes.SourceFile, pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;

  for (const cfgPath of tsconfigs) {
    const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (cfg.error) continue;
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
    const fileNames = parsed.fileNames.filter((f) => !SKIP.test(rel(f)) && f.startsWith(root));
    if (!fileNames.length) continue;
    const host: tsTypes.LanguageServiceHost = {
      getScriptFileNames: () => fileNames, getScriptVersion: () => '1',
      getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined),
      getCurrentDirectory: () => path.dirname(cfgPath), getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o), fileExists: ts.sys.fileExists, readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
    };
    const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
    const program = ls.getProgram();
    if (!program) continue;
    const inRoot = program.getSourceFiles().filter((s) => s.fileName.startsWith(root) && !SKIP.test(rel(s.fileName)) && !s.isDeclarationFile);

    // 1) 정의 수집 (정보 후보) + 전역 수집(필드 소유자, 문자열)
    const decls: { n: tsTypes.InterfaceDeclaration | tsTypes.TypeAliasDeclaration | tsTypes.EnumDeclaration; sf: tsTypes.SourceFile }[] = [];
    for (const sf of inRoot) {
      const first = !seenFiles.has(sf.fileName);
      seenFiles.add(sf.fileName);
      const visit = (n: tsTypes.Node): void => {
        if (first && ts.isPropertySignature(n) && nameOf(n)) {
          const key = nameOf(n) as string;
          const list = owners.get(key) ?? [];
          list.push({ owner: ownerLabel(n), file: rel(sf.fileName), line: lineIn(sf, n.getStart()), type: (n.type ? n.type.getText() : '').slice(0, 60), declPos: `${sf.fileName}:${n.name.getStart()}` });
          owners.set(key, list);
        }
        if (first && ts.isStringLiteral(n) && /^[A-Za-z_][A-Za-z0-9_]{3,}$/.test(n.text) && !isTest(rel(sf.fileName))) {
          const list = strings.get(n.text) ?? [];
          list.push({ file: rel(sf.fileName), line: lineIn(sf, n.getStart()) });
          strings.set(n.text, list);
        }
        if (n.parent === sf && exported(n) && (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n))) decls.push({ n, sf });
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }

    // 2) 정의마다 참조 분석
    for (const { n, sf } of decls) {
      const id = `${rel(sf.fileName)}:${n.name.text}`;
      let info = infos.get(id);
      if (!info) {
        const kind: RawInfo['kind'] = ts.isInterfaceDeclaration(n) ? 'interface' : ts.isTypeAliasDeclaration(n) ? 'type' : 'enum';
        const members: readonly tsTypes.TypeElement[] = ts.isInterfaceDeclaration(n) ? n.members : (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type) ? n.type.members : []);
        info = {
          id, name: n.name.text, kind, file: rel(sf.fileName), line: lineIn(sf, n.name.getStart()),
          doc: docOf(n, sf), typeRefs: new Set(), typeAreas: {},
          props: members.filter((m): m is tsTypes.PropertySignature => ts.isPropertySignature(m) && !!nameOf(m)).map((m): RawProp => ({
            name: nameOf(m) as string, optional: !!m.questionToken, type: (m.type ? m.type.getText() : '').slice(0, 80),
            line: lineIn(sf, m.getStart()), doc: docOf(m, sf), pos: m.name.getStart(), reads: {}, writes: {}, refs: [], seen: new Set(), fnDone: null,
          })),
        };
        infos.set(id, info);
      }
      const cur = info;
      const collect = (pos: number, onRef: (e: tsTypes.ReferenceEntry) => void): void => {
        for (const r of ls.findReferences(sf.fileName, pos) || []) for (const e of r.references) {
          if (e.isDefinition || !e.fileName.startsWith(root) || SKIP.test(rel(e.fileName))) continue;
          onRef(e);
        }
      };
      collect(n.name.getStart(), (e) => {
        const k = `${e.fileName}:${e.textSpan.start}`;
        if (cur.typeRefs.has(k)) return;
        cur.typeRefs.add(k);
        const a = areaOf(e.fileName);
        cur.typeAreas[a] = (cur.typeAreas[a] || 0) + 1;
        cur.typeFiles = cur.typeFiles || new Set();
        cur.typeFiles.add(rel(e.fileName));
      });
      for (const p of cur.props) collect(p.pos, (e) => {
        const k = `${e.fileName}:${e.textSpan.start}`;
        if (p.seen.has(k)) return;
        p.seen.add(k);
        const rsf0 = program.getSourceFile(e.fileName);
        const isWrite = !!e.isWriteAccess && !isDestructureRead(rsf0, e.textSpan.start);
        const bucket = isWrite ? p.writes : p.reads;
        const a = areaOf(e.fileName);
        bucket[a] = (bucket[a] || 0) + 1;
        // 어느 파일에서, 읽기인지 쓰기인지(쓰기는 새로 만드는 입력인지 기존 값을 고치는 수정인지)
        const rsf = program.getSourceFile(e.fileName);
        p.refs.push({ file: rel(e.fileName), line: rsf ? lineIn(rsf, e.textSpan.start) : 0, write: isWrite, kind: isWrite ? writeKind(rsf, e.textSpan.start) : 'read', dom: domHint(rsf, e.textSpan.start) });
        // 화면이 아닌 파일의 함수가 읽는 값이면(예: 날짜로 기간 문구를 만드는 함수), 화면이 그 함수를 JSX 안에서 호출하는 자리를 '보여주는 자리'로 더한다
        if (!isWrite && rsf && !/\.(tsx|jsx)$/.test(e.fileName)) {
          const fn = fnAt(rsf, e.textSpan.start);
          if (fn) {
            const fk = `${fn.file}:${fn.pos}`;
            if (!p.fnDone) p.fnDone = new Set();
            if (!p.fnDone.has(fk)) {
              p.fnDone.add(fk);
              for (const r2 of ls.findReferences(fn.file, fn.pos) || []) for (const e2 of r2.references) {
                if (e2.isDefinition || !/\.(tsx|jsx)$/.test(e2.fileName) || SKIP.test(rel(e2.fileName))) continue;
                const sf2 = program.getSourceFile(e2.fileName);
                const dom2 = domHint(sf2, e2.textSpan.start);
                if (dom2 && sf2) p.refs.push({ file: rel(e2.fileName), line: lineIn(sf2, e2.textSpan.start), write: false, kind: 'via', via: fn.name, dom: dom2 });
              }
            }
          }
        }
      });
    }
  }

  // 3) 상태 판정과 복제 정의·문자열 근거
  const sum = (o: Record<string, number>): number => Object.values(o).reduce((a, b) => a + b, 0);
  const out: AnalyzedInfo[] = [];
  for (const info of infos.values()) {
    const external = [...(info.typeFiles || [])].filter((f) => f !== info.file && !isTest(f)).length;
    let flagged = 0;
    const props = info.props.map((p): AnalyzedProp => {
      const r = sum(p.reads), w = sum(p.writes);
      const status: PropStatus = r && w ? 'rw' : r ? 'read-only' : w ? 'write-only' : 'none';
      const ev: AnalyzedProp['evidence'] = { dups: [], dupTotal: 0, strs: [] };
      if (status !== 'rw') {
        flagged++;
        const myPos = `${path.join(root, info.file)}:${p.pos}`;
        const dups = (owners.get(p.name) || []).filter((o) => o.declPos !== myPos);
        ev.dupTotal = dups.length;
        ev.dups = dups.slice(0, 6).map(({ owner, file, line, type }) => ({ owner, file, line, type }));
        ev.strs = (strings.get(p.name) || []).slice(0, 6);
      }
      const maybe = status !== 'rw' && (ev.dupTotal > 0 || (strings.get(p.name) || []).length > 0);
      const external = externalOf(p.doc) || externalOf(info.doc);
      return { name: p.name, optional: p.optional, type: p.type, line: p.line, doc: p.doc, reads: p.reads, writes: p.writes, refs: p.refs.slice(0, 300), status, maybe, evidence: ev, external };
    });
    out.push({
      id: info.id, name: info.name, kind: info.kind, file: info.file, line: info.line, doc: info.doc,
      typeAreas: info.typeAreas, external, unused: external === 0 && sum(info.typeAreas) === 0, props, flagged,
    });
  }
  out.sort((a, b) => b.external - a.external || a.name.localeCompare(b.name));
  const areas = [...new Set(out.flatMap((i) => [...Object.keys(i.typeAreas), ...i.props.flatMap((p) => [...Object.keys(p.reads), ...Object.keys(p.writes)])]))].sort();
  return { project: path.basename(root), root, tsVersion: ts.version, programs: tsconfigs.length, ms: Date.now() - startedAt, generatedAt: new Date().toISOString(), areas, infos: out };
}

/** 주석의 `@external 읽는 쪽 설명`에서 설명을 꺼낸다(선언이 없으면 빈 글, 선언만 있고 설명이 없으면 "(설명 없음)") */
export function externalOf(doc: string | undefined): string {
  const m = (doc || '').match(/(?:^|\n)[ \t]*@external\b[ \t]*([^\n]*)/);
  return m ? m[1].trim() || '(설명 없음)' : '';
}

/** 명령: analyze-ts <프로젝트 루트> [--check] — --check이면 존재 이유가 빈 정보·필드를 경고로 낸다(rules/meta.md "필수 메타정보") */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, flags } = parseArgs(argv, ['check']);
  const r = analyzeTs(pos[0] || '.');
  console.log(`정보 ${r.infos.length}개, 영역 ${r.areas.length}개, ${r.ms}ms`);
  if (!flags.has('check')) return undefined;
  let n = 0;
  // 아무것도 못 읽었는데 통과하면 검사한 것이 아니다 (tsconfig.json이 있는 프로젝트 루트를 줘야 한다)
  if (!r.infos.length) { console.log('경고: 정보를 하나도 읽지 못했다 — tsconfig.json이 있는 프로젝트 루트를 인자로 준다'); n++; }
  // @nonInfo가 달린 타입(이동 약속 등 정보가 아닌 것)은 존재 이유 검사에서 뺀다
  for (const i of r.infos.filter((x) => !/@nonInfo\b/.test(x.doc || ''))) {
    if (!i.doc) { console.log(`경고: 정보 ${i.name}에 존재 이유가 없다 (${i.file}:${i.line})`); n++; }
    for (const p of i.props) {
      if (!p.doc) { console.log(`경고: ${i.name}.${p.name}에 존재 이유가 없다 (${i.file}:${p.line})`); n++; }
      if (p.external === '(설명 없음)') { console.log(`경고: ${i.name}.${p.name}의 @external에 읽는 쪽 설명이 없다 — 누가 어떻게 읽는지 적는다 (${i.file}:${p.line})`); n++; }
      // 필드에 직접 단 선언만 낡았는지 본다(타입 전체 선언은 일부 필드를 코드가 읽어도 맞다)
      else if (externalOf(p.doc) && p.status !== 'none') { console.log(`경고: ${i.name}.${p.name}은 코드가 이미 쓰고 있어 @external이 필요 없다 — 선언을 지운다 (${i.file}:${p.line})`); n++; }
    }
  }
  console.log(`정보 경고 ${n}건`);
  return n ? 1 : 0;
}
