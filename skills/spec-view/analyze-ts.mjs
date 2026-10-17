// TypeScript 프로젝트의 "정보"(코드에 이름 붙은 데이터 정의)와 그 사용(읽기·쓰기)을 소스에서 자동으로 알아낸다.
// 존재 이유: 설계서를 따로 쓰지 않고도 "어떤 정보가 있고, 누가 만들고 읽고 바꾸나"를 코드에서 바로 보게 하려고. 코드에 있는 것은 읽고,
//   코드에 없는 것(정보의 뜻·용도)만 주석 태그로 받는다. 그래서 분석 결과는 설계 원본이 아니라 언제든 다시 만드는 파생물이다.
// 방식: TypeScript 언어 서비스의 참조 분석(필드 단위, 읽기/쓰기 구분). 프로젝트의 node_modules에 있는 typescript를 쓴다.
// 정보 후보 = export된 interface / type / enum. 어느 한 파일에서만 쓰이는 것도 담되 external=0으로 표시한다.
// 틀릴 수 있는 곳을 숨기지 않는다: 쓰기·읽기가 안 보이는 필드는 "확정"이 아니라, 같은 이름의 다른 정의나 문자열 참조가 있으면 "후보"로 구분한다
//   (같은 정보를 손으로 다시 정의하거나 문자열 이름으로 다루면 TypeScript가 같은 정보로 연결하지 못한다).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const SKIP = /(^|\/)(node_modules|dist|build|\.git|\.expo|ios|android)(\/|$)/;
const isTest = (f) => /(^|\/)__tests__\//.test(f) || /\.(test|spec)\.[tj]sx?$/.test(f);

function findTsconfigs(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP.test(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1); }
      else if (e.name === 'tsconfig.json') out.push(path.join(dir, e.name));
    }
  };
  walk(root, 0);
  return out;
}

export function analyzeTs(root, opts = {}) {
  root = path.resolve(root);
  let ts;
  try { ts = createRequire(path.join(root, 'package.json'))('typescript'); }
  catch { throw new Error(`${root}에서 typescript를 찾지 못했다 (프로젝트에 설치돼 있어야 한다)`); }

  const rel = (f) => path.relative(root, f);
  const areaOf = (file) => {
    const r = rel(file);
    if (isTest(r)) return '테스트';
    let m = r.match(/^apps\/([^/]+)\/src\/([^/]+)\//); if (m) return `${m[1]}/${m[2]}`;
    m = r.match(/^apps\/([^/]+)\//); if (m) return m[1];
    m = r.match(/^packages\/([^/]+)\//); if (m) return `packages/${m[1]}`;
    m = r.match(/^src\/([^/]+)\//); if (m) return m[1];
    return r.split('/')[0];
  };

  const tsconfigs = (opts.tsconfigs || findTsconfigs(root)).map((p) => path.resolve(root, p));
  const infos = new Map();            // 선언 위치 → 정보
  const owners = new Map();           // 필드 이름 → 그 이름을 가진 모든 타입·인라인 타입 (복제 정의 후보 찾기용)
  const strings = new Map();          // 문자열 리터럴 → 위치
  const seenFiles = new Set();
  const startedAt = Date.now();

  const exported = (n) => !!(ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export);
  const nameOf = (m) => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : null);
  const docOf = (n, sf) => {
    const parts = [];
    for (const d of n.jsDoc || []) parts.push(String(typeof d.comment === 'string' ? d.comment : (d.comment || []).map((c) => c.text).join('')) + (d.tags || []).map((t) => `@${t.tagName.text} ${typeof t.comment === 'string' ? t.comment : ''}`).join('\n'));
    if (!parts.length) {
      const text = sf.text; const ranges = ts.getLeadingCommentRanges(text, n.getFullStart()) || [];
      for (const r of ranges) parts.push(text.slice(r.pos, r.end).replace(/^\/\/+|^\/\*+|\*+\/$/gm, '').trim());
    }
    return parts.join('\n').trim();
  };
  // 쓰기 참조가 입력(새 값을 만듦)인지 수정(있던 값을 바꿈)인지: 객체 리터럴에 ...펼침이 없으면 입력, 펼침이 있거나 대입이면 수정
  const writeKind = (sf, pos) => {
    if (!sf) return 'write';
    let node = sf;
    for (let again = true; again;) { again = false; ts.forEachChild(node, (c) => { if (!again && c.getStart() <= pos && pos < c.getEnd()) { node = c; again = true; } }); }
    const par = node.parent;
    if (par && (ts.isPropertyAssignment(par) || ts.isShorthandPropertyAssignment(par)) && ts.isObjectLiteralExpression(par.parent)) {
      return par.parent.properties.some((x) => ts.isSpreadAssignment(x)) ? 'update' : 'create';
    }
    if (par && ts.isPropertyAccessExpression(par) && par.parent && ts.isBinaryExpression(par.parent) && par.parent.left === par) return 'update';
    return 'write';
  };
  const ownerLabel = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if ((ts.isFunctionDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isClassDeclaration(p)) && p.name) return p.name.text;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
      if (ts.isMethodDeclaration(p) && p.name) return p.name.getText();
    }
    return '(이름 없는 인라인 타입)';
  };

  for (const cfgPath of tsconfigs) {
    const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (cfg.error) continue;
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
    const fileNames = parsed.fileNames.filter((f) => !SKIP.test(rel(f)) && f.startsWith(root));
    if (!fileNames.length) continue;
    const host = {
      getScriptFileNames: () => fileNames, getScriptVersion: () => '1',
      getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined),
      getCurrentDirectory: () => path.dirname(cfgPath), getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o), fileExists: ts.sys.fileExists, readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
    };
    const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
    const program = ls.getProgram();
    const inRoot = program.getSourceFiles().filter((s) => s.fileName.startsWith(root) && !SKIP.test(rel(s.fileName)) && !s.isDeclarationFile);

    // 1) 정의 수집 (정보 후보) + 전역 수집(필드 소유자, 문자열)
    const decls = [];
    for (const sf of inRoot) {
      const first = !seenFiles.has(sf.fileName); seenFiles.add(sf.fileName);
      const visit = (n) => {
        if (first && ts.isPropertySignature(n) && nameOf(n)) {
          const key = nameOf(n);
          if (!owners.has(key)) owners.set(key, []);
          owners.get(key).push({ owner: ownerLabel(n), file: rel(sf.fileName), line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, type: (n.type ? n.type.getText() : '').slice(0, 60), declPos: `${sf.fileName}:${n.name.getStart()}` });
        }
        if (first && ts.isStringLiteral(n) && /^[A-Za-z_][A-Za-z0-9_]{3,}$/.test(n.text) && !isTest(rel(sf.fileName))) {
          if (!strings.has(n.text)) strings.set(n.text, []);
          strings.get(n.text).push({ file: rel(sf.fileName), line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
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
        const kind = ts.isInterfaceDeclaration(n) ? 'interface' : ts.isTypeAliasDeclaration(n) ? 'type' : 'enum';
        const members = ts.isInterfaceDeclaration(n) ? n.members : (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type) ? n.type.members : []);
        info = {
          id, name: n.name.text, kind, file: rel(sf.fileName), line: sf.getLineAndCharacterOfPosition(n.name.getStart()).line + 1,
          doc: docOf(n, sf), typeRefs: new Set(), typeAreas: {},
          props: members.filter((m) => ts.isPropertySignature(m) && nameOf(m)).map((m) => ({
            name: nameOf(m), optional: !!m.questionToken, type: (m.type ? m.type.getText() : '').slice(0, 80),
            line: sf.getLineAndCharacterOfPosition(m.getStart()).line + 1, doc: docOf(m, sf), pos: m.name.getStart(), reads: {}, writes: {}, refs: [], seen: new Set(),
          })),
        };
        infos.set(id, info);
      }
      const collect = (pos, onRef) => {
        for (const r of ls.findReferences(sf.fileName, pos) || []) for (const e of r.references) {
          if (e.isDefinition || !e.fileName.startsWith(root) || SKIP.test(rel(e.fileName))) continue;
          onRef(e);
        }
      };
      collect(n.name.getStart(), (e) => {
        const k = `${e.fileName}:${e.textSpan.start}`; if (info.typeRefs.has(k)) return;
        info.typeRefs.add(k); const a = areaOf(e.fileName); info.typeAreas[a] = (info.typeAreas[a] || 0) + 1;
        info.typeFiles = info.typeFiles || new Set(); info.typeFiles.add(rel(e.fileName));
      });
      for (const p of info.props) collect(p.pos, (e) => {
        const k = `${e.fileName}:${e.textSpan.start}`; if (p.seen.has(k)) return; p.seen.add(k);
        const b = e.isWriteAccess ? p.writes : p.reads; const a = areaOf(e.fileName); b[a] = (b[a] || 0) + 1;
        // 어느 파일에서, 읽기인지 쓰기인지(쓰기는 새로 만드는 입력인지 기존 값을 고치는 수정인지)
        const rsf = program.getSourceFile(e.fileName);
        p.refs.push({ file: rel(e.fileName), line: rsf ? rsf.getLineAndCharacterOfPosition(e.textSpan.start).line + 1 : 0, write: !!e.isWriteAccess, kind: e.isWriteAccess ? writeKind(rsf, e.textSpan.start) : 'read' });
      });
    }
  }

  // 3) 상태 판정과 복제 정의·문자열 근거
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const out = [];
  for (const info of infos.values()) {
    const external = [...(info.typeFiles || [])].filter((f) => f !== info.file && !isTest(f)).length;
    let flagged = 0;
    const props = info.props.map((p) => {
      const r = sum(p.reads), w = sum(p.writes);
      const status = r && w ? 'rw' : r ? 'read-only' : w ? 'write-only' : 'none';
      const ev = { dups: [], dupTotal: 0, strs: [] };
      if (status !== 'rw') {
        flagged++;
        const myPos = `${path.join(root, info.file)}:${p.pos}`;
        const dups = (owners.get(p.name) || []).filter((o) => o.declPos !== myPos);
        ev.dupTotal = dups.length; ev.dups = dups.slice(0, 6).map(({ owner, file, line, type }) => ({ owner, file, line, type }));
        ev.strs = (strings.get(p.name) || []).slice(0, 6);
      }
      const maybe = status !== 'rw' && (ev.dupTotal > 0 || (strings.get(p.name) || []).length > 0);
      return { name: p.name, optional: p.optional, type: p.type, line: p.line, doc: p.doc, reads: p.reads, writes: p.writes, refs: p.refs.slice(0, 300), status, maybe, evidence: ev };
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = analyzeTs(process.argv[2] || '.');
  console.log(`정보 ${r.infos.length}개, 영역 ${r.areas.length}개, ${r.ms}ms`);
  // --check: 존재 이유(주석)가 빈 정보·필드를 경고로 낸다 (spec-view 스킬 rules/meta.md "필수 메타정보")
  if (process.argv.includes('--check')) {
    let n = 0;
    // 아무것도 못 읽었는데 통과하면 검사한 것이 아니다 (tsconfig.json이 있는 프로젝트 루트를 줘야 한다)
    if (!r.infos.length) { console.log('경고: 정보를 하나도 읽지 못했다 — tsconfig.json이 있는 프로젝트 루트를 인자로 준다'); n++; }
    // @nonInfo가 달린 타입(이동 약속 등 정보가 아닌 것)은 존재 이유 검사에서 뺀다
    for (const i of r.infos.filter((x) => !/@nonInfo\b/.test(x.doc || ''))) {
      if (!i.doc) { console.log(`경고: 정보 ${i.name}에 존재 이유가 없다 (${i.file}:${i.line})`); n++; }
      for (const p of i.props) if (!p.doc) { console.log(`경고: ${i.name}.${p.name}에 존재 이유가 없다 (${i.file}:${p.line})`); n++; }
    }
    console.log(`정보 경고 ${n}건`);
    process.exit(n ? 1 : 0);
  }
}
