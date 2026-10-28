/**
 * @why 요청 #95의 약속을 지킨다: 합치기(request land)는 워크트리의 추적 안 되는 파일을 저장 안 한 변경으로 세지 않고, 실행 기록(.spec/finish.json)만 충돌하면 main 쪽으로 풀어 합치며, 다른 충돌은 되돌리고 알린다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeBranch } from '../src/land.js';
import { worktreeOf } from '../src/worktree.js';
import { tempProject } from './helpers.js';

const git = (cwd: string, ...a: string[]): string => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });

/** 커밋이 있는 임시 저장소(main)와 그 워크트리(.claude/worktrees/req-1, 브랜치 worktree-req-1) */
function repoWithWorktree(): { root: string; wt: string } {
  const { root } = tempProject();
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(root, '.spec', 'finish.json'), '{"ok":true}\n');
  git(root, 'checkout', '-q', '-b', 'main');
  git(root, 'add', '-f', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  const wt = path.join(root, '.claude', 'worktrees', 'req-1');
  git(root, 'worktree', 'add', '-q', wt, '-b', 'worktree-req-1');
  return { root, wt };
}

test('워크트리의 추적 안 되는 파일은 저장 안 한 변경으로 세지 않고, 추적 중인 파일의 변경만 센다', () => {
  const { root, wt } = repoWithWorktree();
  fs.mkdirSync(path.join(wt, 'node_modules'));
  fs.writeFileSync(path.join(wt, 'node_modules', 'x'), 'x');
  assert.equal(worktreeOf(root, 1)?.dirty, 0);
  fs.writeFileSync(path.join(wt, 'a.txt'), 'changed\n');
  assert.equal(worktreeOf(root, 1)?.dirty, 1);
});

test('실행 기록(finish.json)만 충돌하면 main 쪽으로 풀어 합친다', () => {
  const { root, wt } = repoWithWorktree();
  fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
  fs.writeFileSync(path.join(wt, '.spec', 'finish.json'), '{"ok":"branch"}\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'branch');
  fs.writeFileSync(path.join(root, '.spec', 'finish.json'), '{"ok":"main"}\n');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'main side');
  mergeBranch(root, 'worktree-req-1', 'merge', 'main');
  assert.ok(fs.existsSync(path.join(root, 'b.txt')), '브랜치의 코드가 들어왔다');
  assert.equal(fs.readFileSync(path.join(root, '.spec', 'finish.json'), 'utf8'), '{"ok":"main"}\n');
});

test('main에서 finish를 돌려 저장 안 한 실행 기록이 있어도 합치기가 막히지 않는다', () => {
  const { root, wt } = repoWithWorktree();
  fs.writeFileSync(path.join(wt, '.spec', 'finish.json'), '{"ok":"branch"}\n');
  fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'branch');
  fs.writeFileSync(path.join(root, '.spec', 'finish.json'), '{"ok":"dirty"}\n');
  mergeBranch(root, 'worktree-req-1', 'merge', 'main');
  assert.ok(fs.existsSync(path.join(root, 'b.txt')));
});

test('다른 파일이 충돌하면 합치기를 되돌리고 알린다', () => {
  const { root, wt } = repoWithWorktree();
  fs.writeFileSync(path.join(wt, 'a.txt'), 'branch\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'branch');
  fs.writeFileSync(path.join(root, 'a.txt'), 'main\n');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'main side');
  assert.throws(() => mergeBranch(root, 'worktree-req-1', 'merge', 'main'), /충돌해 되돌렸다/);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'main\n');
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=no').trim(), '');
});

test('커밋 없는 빈 브랜치는 main이 앞서가도 합쳐짐이 아니다', () => {
  const { root } = repoWithWorktree();
  fs.writeFileSync(path.join(root, 'c.txt'), 'c\n');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'main moves');
  assert.equal(worktreeOf(root, 1)?.merged, false);
});

test('합치기 커밋 없이 합쳐진 옛 브랜치(요청 기록의 커밋이 main에 있음)는 합쳐짐이다', () => {
  const { root, wt } = repoWithWorktree();
  fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'branch');
  const c = git(wt, 'rev-parse', '--short', 'HEAD').trim();
  fs.mkdirSync(path.join(root, '.spec', 'requests'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spec', 'requests', '1.json'), JSON.stringify({ id: 1, commits: [c] }));
  assert.equal(worktreeOf(root, 1)?.merged, false, '아직 main에 없다');
  git(root, 'merge', '--ff-only', 'worktree-req-1');
  assert.equal(worktreeOf(root, 1)?.merged, true);
});
