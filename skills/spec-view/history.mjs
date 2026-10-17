// 화면의 변경 이력 — 그 화면의 소스 파일을 바꾼 git 커밋에서 읽는다(제목, 요청, 결정, 기각, 원인)와 승인 기록.
// 존재 이유: 이력을 따로 쓰지 않고 커밋 메시지(결정·기각 포함)를 유일한 원본으로 두려고.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectRoot } from './status.mjs';

const SEP = '\x1e', FIELD = '\x1f';
// 커밋이 바꾼 곳(새 파일 기준 줄 범위)과 바뀐 내용(지운 줄·새 줄)을 파일별로 읽는다
function changedHunks(root, hash, relFiles) {
  const out = {};
  let raw = '';
  try { raw = execFileSync('git', ['show', '--unified=0', '--no-color', '--format=', hash, '--', ...relFiles], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }).toString(); } catch { return out; }
  let file = null, cur = null;
  for (const l of raw.split('\n')) {
    const f = l.match(/^\+\+\+ b\/(.+)$/); if (f) { file = f[1]; out[file] = out[file] || []; cur = null; continue; }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) { const start = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2]); cur = { range: [start, n === 0 ? start : start + n - 1], removed: [], added: [] }; out[file].push(cur); continue; }
    if (!cur || l.startsWith('---') || l.startsWith('+++')) continue;
    if (l.startsWith('+')) cur.added.push(l.slice(1)); else if (l.startsWith('-')) cur.removed.push(l.slice(1));
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
    // 이 커밋이 실제로 고친 곳: 화면 요소·정보 필드·그 밖(스타일·설정 등)으로 나눠 곳마다 바뀐 내용을 묶는다
    const lines = ctx.specs ? changedHunks(root, hash, files) : {};
    const touchedSpecs = new Set(), touchedInfos = new Map(), places = new Map();
    const clip = (arr) => arr.slice(0, 8).map((x) => (x.length > 140 ? `${x.slice(0, 140)}…` : x));
    for (const [rf, hunks] of Object.entries(lines)) {
      const sf = path.relative(scanRoot, path.join(root, rf));
      for (const hk of hunks) {
        const [a, b] = hk.range;
        const sps = owners(specMarks, sf, a, b).filter((m) => m.id), ins = owners(infoMarks, sf, a, b);
        sps.forEach((m) => touchedSpecs.add(m.id));
        ins.forEach((m) => { const cur = touchedInfos.get(m.info) || new Set(); if (m.prop) cur.add(m.prop); touchedInfos.set(m.info, cur); });
        const own = sps[0] ? { kind: 'spec', key: `spec:${sps[0].id}`, id: sps[0].id, title: sps[0].title } : ins[0] ? { kind: 'info', key: `info:${ins[0].info}.${ins[0].prop || ''}`, info: ins[0].info, prop: ins[0].prop, title: ins[0].prop ? `${ins[0].info}.${ins[0].prop}` : ins[0].info } : { kind: 'other', key: `other:${sf}`, title: path.basename(sf) };
        const pl = places.get(own.key) || { ...own, file: sf, line: a, added: 0, removed: 0, hunks: [] };
        pl.added += hk.added.length; pl.removed += hk.removed.length;
        if (pl.hunks.length < 4) pl.hunks.push({ line: a, removed: clip(hk.removed), added: clip(hk.added) });
        places.set(own.key, pl);
      }
    }
    items.push({
      type: 'commit', kind: fix ? '오류 수정' : '변경', hash, at, author,
      title: subject.replace(/^\w+(\([^)]*\))?:\s*/, '').replace(/^"|"$/g, ''),
      request: field('요청')[0] || '', decisions: field('결정'), rejections: field('기각'), cause: field('원인')[0] || '', files: fileList.filter((f) => files.includes(f)).length || undefined,
      fileList: fileList.filter((f) => files.includes(f)).map((f) => path.relative(scanRoot, path.join(root, f))),
      places: [...places.values()].slice(0, 12), touchedSpecs: [...touchedSpecs], touchedInfos: [...touchedInfos].map(([name, f]) => ({ name, fields: [...f] })),
    });
  }
  for (const h of statusRec?.history || []) {
    if (h.status === 'approved' || h.status === 'needs-fix' || h.status === 'test-requested') {
      items.push({ type: 'status', kind: h.status === 'approved' ? '승인' : h.status === 'needs-fix' ? '수정 필요' : '테스트 요청', hash: h.commit, at: h.at, author: h.by === 'user' ? '사용자' : '에이전트', title: h.note || '', decisions: [], rejections: [] });
    }
  }
  // 화면이 어떻게 달라졌는지: 이 커밋 직전·직후에 저장된 화면 스냅샷(테스트 요청·승인 때 저장)
  const snaps = (statusRec?.history || []).filter((h) => h.shot).map((h) => ({ shot: h.shot, at: h.at, label: h.status === 'approved' ? '승인' : '테스트 요청' })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const it of items) {
    if (it.type !== 'commit') { if (statusRec?.history) { const m = (statusRec.history || []).find((h) => h.at === it.at && h.shot); if (m) it.shot = m.shot; } continue; }
    const t = Date.parse(it.at);
    it.before = [...snaps].reverse().find((x) => Date.parse(x.at) <= t) || null;
    it.after = snaps.find((x) => Date.parse(x.at) > t) || null;
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items;
}
