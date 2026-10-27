/**
 * @spec worktree-track 요청 담당 세션의 워크트리 추적
 * @why 요청마다 워크트리에서 일하므로, 사용자가 그 일이 어디까지 왔는지(작업 폴더·브랜치·main보다 앞선 커밋·저장 안 한 변경·main에 합쳐졌는지)를 요청 상세에서 바로 보게 한다.
 * @contract 읽기만 한다. 담당 세션 번호의 앞 8자리 폴더(~/.claude/jobs/<번호8>/state.json)에서 worktreePath·worktreeBranch를 읽고, git -C로 `기준..브랜치` 커밋 수·status를 묻는다. 합쳐짐은 앞선 커밋이 0이고 브랜치 끝이 기준 브랜치 끝과 다를 때(막 만든 빈 브랜치와 구분)다. 워크트리를 쓰지 않는 세션이거나 읽을 수 없으면 null(화면에는 "워크트리 없음"). 기준 브랜치는 main(없으면 master).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ownersOf } from './session.js';
import type { WorktreeInfo } from './types.js';

const git = (cwd: string, args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });

/** 기준 브랜치 이름 */
export function baseBranch(root: string): string {
  for (const b of ['main', 'master']) { try { git(root, ['rev-parse', '--verify', b]); return b; } catch { /* 다음 후보 */ } }
  return 'main';
}

/** 요청의 워크트리 경로와 브랜치(없으면 null). ① 담당 세션 기록(~/.claude/jobs/<번호8>/state.json)에서 찾고, ② 없으면(담당이 바뀌었거나 기록에 워크트리 정보가 없으면) git worktree list에서 경로가 .claude/worktrees/req-<요청번호>인 것을 찾는다 */
export function worktreeRefOf(root: string, id: number): { path: string; branch: string } | null {
  for (const sid of ownersOf(root, id)) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'jobs', sid.slice(0, 8), 'state.json'), 'utf8')) as { worktreePath?: string; worktreeBranch?: string };
      if (s.worktreePath && s.worktreeBranch) return { path: s.worktreePath, branch: s.worktreeBranch };
    } catch { /* 이 세션은 정보가 없다 */ }
  }
  try {
    let cur: { path?: string; branch?: string } = {};
    for (const line of [...git(root, ['worktree', 'list', '--porcelain']).split('\n'), '']) {
      if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
      else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (!line && cur.path && cur.branch && cur.path.endsWith(`/.claude/worktrees/req-${id}`)) return { path: cur.path, branch: cur.branch };
    }
  } catch { /* git을 못 쓰면 워크트리 없음 */ }
  return null;
}

/** 요청의 워크트리 추적 정보 */
export function worktreeOf(root: string, id: number): WorktreeInfo | null {
  const ref = worktreeRefOf(root, id);
  if (!ref) return null;
  const exists = fs.existsSync(ref.path);
  try {
    const base = baseBranch(root);
    const ahead = Number(git(root, ['rev-list', '--count', `${base}..${ref.branch}`]).trim()) || 0;
    const dirty = exists ? git(ref.path, ['status', '--porcelain']).split('\n').filter(Boolean).length : 0;
    // 합침 판정은 "main에 더 얹은 것이 없고 끝이 다르다"라서, 빠른 합치기(fast-forward)로 합치면 끝이 같아 아직으로 보인다. 합치기는 land(--no-ff)로만 한다
    const merged = ahead === 0 && git(root, ['rev-parse', ref.branch]).trim() !== git(root, ['rev-parse', base]).trim();
    return { path: ref.path, branch: ref.branch, ahead, dirty, merged, exists };
  } catch { return { ...ref, ahead: 0, dirty: 0, merged: false, exists }; }
}
