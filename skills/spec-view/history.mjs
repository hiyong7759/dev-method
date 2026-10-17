// 화면의 변경 이력 — 그 화면의 소스 파일을 바꾼 git 커밋에서 읽는다(제목, 요청, 결정, 기각, 원인)와 승인 기록.
// 존재 이유: 이력을 따로 쓰지 않고 커밋 메시지(결정·기각 포함)를 유일한 원본으로 두려고.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectRoot } from './status.mjs';

const SEP = '\x1e', FIELD = '\x1f';
// 커밋이 바꾼 줄(새 파일 기준)을 파일별로 읽는다
function changedLines(root, hash, relFiles) {
  const out = {};
  let raw = '';
  try { raw = execFileSync('git', ['show', '--unified=0', '--no-color', '--format=', hash, '--', ...relFiles], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }).toString(); } catch { return out; }
  let file = null;
  for (const l of raw.split('\n')) {
    const f = l.match(/^\+\+\+ b\/(.+)$/); if (f) { file = f[1]; out[file] = out[file] || []; continue; }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) { const start = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2]); out[file].push([start, n === 0 ? start : start + n - 1]); }
  }
  return out;
}
// 구역: 파일 안에서 표시 줄(@spec/@screen, 정보·필드 정의)부터 다음 표시 줄 앞까지가 그 것의 자리
function owners(marks, file, a, b) {
  const list = marks.filter((m) => m.file === file).sort((x, y) => x.line - y.line);
  return list.filter((m, i) => { const end = i + 1 < list.length ? list[i + 1].line - 1 : Infinity; return a <= end && b >= m.line; });
}

export function screenHistory(scanRoot, sc, statusRec, ctx = {}) {
  const root = projectRoot(scanRoot);
  const files = sc.files.map((f) => path.relative(root, path.join(scanRoot, f)));
  let raw = '';
  try { raw = execFileSync('git', ['log', `--format=${SEP}%h${FIELD}%aI${FIELD}%an${FIELD}%s${FIELD}%b`, '--name-only', '--', ...files], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }).toString(); } catch { /* git 없음 */ }
  const items = [];
  const specMarks = [...(ctx.specs || []).map((x) => ({ file: x.file, line: x.line, id: x.id, title: x.title })), ...(ctx.screens || []).map((x) => ({ file: x.file, line: x.line, id: null }))];
  // 정보: 정의 줄은 그 한 줄만, 필드는 (앞 필드 다음 줄 ~ 자기 줄)이라 필드 바로 위 설명 주석도 그 필드의 자리다
  const infoMarks = (ctx.infos || []).flatMap((i) => [{ file: i.fileSrc, line: i.line, info: i.name, prop: null }, ...i.props.map((p, k) => ({ file: i.fileSrc, line: k === 0 ? i.line + 1 : i.props[k - 1].line + 1, info: i.name, prop: p.name }))]);
  for (const chunk of raw.split(SEP).filter(Boolean)) {
    const [hash, at, author, subject, rest = ''] = chunk.split(FIELD);
    const body = rest.split('\n');
    const fileList = body.filter((l) => /^[\w.\/-]+\.\w+$/.test(l.trim()) && !l.includes(':')).map((l) => l.trim());
    const msg = rest.split('\n').filter((l) => /^(요청|결정|기각|원인|검증|수정|한계|다음)\s*:/.test(l));
    const field = (k) => msg.filter((l) => l.startsWith(k)).map((l) => l.replace(/^[^:]+:\s*/, ''));
    const fix = /^fix(\(|:)/.test(subject);
    // 이 커밋이 실제로 고친 줄이 닿은 컴포넌트와 정보 필드(파일이 아니라 줄 단위)
    const lines = ctx.specs ? changedLines(root, hash, files) : {};
    const touchedSpecs = new Set(), touchedInfos = new Map();
    for (const [rf, ranges] of Object.entries(lines)) {
      const sf = path.relative(scanRoot, path.join(root, rf));
      for (const [a, b] of ranges) {
        owners(specMarks, sf, a, b).forEach((m) => { if (m.id) touchedSpecs.add(m.id); });
        owners(infoMarks, sf, a, b).forEach((m) => { const cur = touchedInfos.get(m.info) || new Set(); if (m.prop) cur.add(m.prop); touchedInfos.set(m.info, cur); });
      }
    }
    items.push({
      type: 'commit', kind: fix ? '오류 수정' : '변경', hash, at, author,
      title: subject.replace(/^\w+(\([^)]*\))?:\s*/, '').replace(/^"|"$/g, ''),
      request: field('요청')[0] || '', decisions: field('결정'), rejections: field('기각'), cause: field('원인')[0] || '', files: fileList.filter((f) => files.includes(f)).length || undefined,
      fileList: fileList.filter((f) => files.includes(f)).map((f) => path.relative(scanRoot, path.join(root, f))),
      touchedSpecs: [...touchedSpecs], touchedInfos: [...touchedInfos].map(([name, f]) => ({ name, fields: [...f] })),
    });
  }
  for (const h of statusRec?.history || []) {
    if (h.status === 'approved' || h.status === 'needs-fix' || h.status === 'test-requested') {
      items.push({ type: 'status', kind: h.status === 'approved' ? '승인' : h.status === 'needs-fix' ? '수정 필요' : '테스트 요청', hash: h.commit, at: h.at, author: h.by === 'user' ? '사용자' : '에이전트', title: h.note || '', decisions: [], rejections: [] });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items;
}
