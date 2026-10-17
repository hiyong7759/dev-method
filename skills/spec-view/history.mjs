// 화면의 변경 이력 — 그 화면의 소스 파일을 바꾼 git 커밋에서 읽는다(제목, 요청, 결정, 기각, 원인)와 승인 기록.
// 존재 이유: 이력을 따로 쓰지 않고 커밋 메시지(결정·기각 포함)를 유일한 원본으로 두려고.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectRoot } from './status.mjs';

const SEP = '\x1e', FIELD = '\x1f';
export function screenHistory(scanRoot, sc, statusRec) {
  const root = projectRoot(scanRoot);
  const files = sc.files.map((f) => path.relative(root, path.join(scanRoot, f)));
  let raw = '';
  try { raw = execFileSync('git', ['log', `--format=${SEP}%h${FIELD}%aI${FIELD}%an${FIELD}%s${FIELD}%b`, '--name-only', '--', ...files], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }).toString(); } catch { /* git 없음 */ }
  const items = [];
  for (const chunk of raw.split(SEP).filter(Boolean)) {
    const [hash, at, author, subject, rest = ''] = chunk.split(FIELD);
    const body = rest.split('\n');
    const fileList = body.filter((l) => /^[\w.\/-]+\.\w+$/.test(l.trim()) && !l.includes(':')).map((l) => l.trim());
    const msg = rest.split('\n').filter((l) => /^(요청|결정|기각|원인|검증|수정|한계|다음)\s*:/.test(l));
    const field = (k) => msg.filter((l) => l.startsWith(k)).map((l) => l.replace(/^[^:]+:\s*/, ''));
    const fix = /^fix(\(|:)/.test(subject);
    items.push({
      type: 'commit', kind: fix ? '오류 수정' : '변경', hash, at, author,
      title: subject.replace(/^\w+(\([^)]*\))?:\s*/, '').replace(/^"|"$/g, ''),
      request: field('요청')[0] || '', decisions: field('결정'), rejections: field('기각'), cause: field('원인')[0] || '', files: fileList.filter((f) => files.includes(f)).length || undefined,
      fileList: fileList.filter((f) => files.includes(f)).map((f) => path.relative(scanRoot, path.join(root, f))),
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
