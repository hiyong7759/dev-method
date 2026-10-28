/**
 * @why 요청 #95의 약속을 지킨다: 합치기(request land)는 워크트리의 추적 안 되는 파일을 저장 안 한 변경으로 세지 않고, 실행 기록(.spec/finish.json)만 충돌하면 main 쪽으로 풀어 합치며, 다른 충돌은 되돌리고 알린다. 요청 #104의 약속도 지킨다: 합치기 전 확인(범위·시험)에 걸리면 합치지 않고, main 폴더의 저장 안 한 변경은 충돌이 아니라고 알리며 거부하고, 합쳐짐은 요청 기록의 커밋으로 판정한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeBranch, landRequest } from '../src/land.js';
import { addRequest, startDesign, submitDesign, approveDesign, requestTest, approveTest } from '../src/request.js';
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

/** 테스트 승인까지 끝난 요청 #1과 그 브랜치(b.txt·package.json을 바꾼 커밋 하나). testScript는 브랜치의 `npm test`가 하는 일 */
function approvedRequest(testScript: string, extra: string[] = []): { root: string; src: string } {
  const { root, wt } = repoWithWorktree();
  const src = path.join(root, 'src');
  addRequest(src, { title: '합치기' }); startDesign(src, 1);
  submitDesign(src, 1, { understanding: '이해', approach: '방법', files: [{ path: 'b.txt', why: '시험' }, { path: 'package.json', why: '시험' }] });
  approveDesign(src, 1); requestTest(src, 1); approveTest(src, 1, true);
  fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
  fs.writeFileSync(path.join(wt, 'package.json'), JSON.stringify({ scripts: { typecheck: 'node -e 0', test: testScript } }));
  for (const f of extra) fs.writeFileSync(path.join(wt, f), 'x\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'branch');
  return { root, src };
}

test('합치기 전 확인이 모두 통과하면 합친다', () => {
  const { root, src } = approvedRequest('node -e 0');
  landRequest(src, 1);
  assert.ok(fs.existsSync(path.join(root, 'b.txt')));
});

test('설계 범위 밖 파일을 바꿨으면 합치지 않고 이유를 던진다', () => {
  const { root, src } = approvedRequest('node -e 0', ['other.txt']);
  assert.throws(() => landRequest(src, 1), /합치기 전 확인에 걸려.*설계 범위.*other\.txt/);
  assert.ok(!fs.existsSync(path.join(root, 'b.txt')), '아무것도 합쳐지지 않았다');
});

test('시험이 실패하면 합치지 않고 이유를 던진다', () => {
  const { root, src } = approvedRequest('node -e process.exit(1)');
  assert.throws(() => landRequest(src, 1), /합치기 전 확인에 걸려.*시험/);
  assert.ok(!fs.existsSync(path.join(root, 'b.txt')));
});

test('main 폴더에 저장 안 한 추적 파일 변경이 있으면 충돌이 아니라고 알리며 거부한다', () => {
  const { root, src } = approvedRequest('node -e 0');
  fs.writeFileSync(path.join(root, 'a.txt'), 'dirty\n');
  assert.throws(() => landRequest(src, 1), /저장\(커밋\)하지 않은 변경이 1개.*충돌 아님/);
  assert.ok(!fs.existsSync(path.join(root, 'b.txt')));
});

test('main 폴더에서 실행 기록(finish.json)만 바뀐 것은 거부하지 않는다', () => {
  const { root, src } = approvedRequest('node -e 0');
  fs.writeFileSync(path.join(root, '.spec', 'finish.json'), '{"ok":"dirty"}\n');
  landRequest(src, 1);
  assert.ok(fs.existsSync(path.join(root, 'b.txt')));
});
