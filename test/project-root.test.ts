/**
 * @why 요청 #92의 약속을 지킨다: 요청·담당 기록(.spec)은 어느 폴더에서 도구를 불러도 main 작업 폴더 한 곳을 읽고 쓴다. 워크트리 안에서 request 명령을 불러도 화면(모델)이 읽는 main의 기록이 바뀐다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectRoot, specDir } from '../src/project.js';
import { loadRequests } from '../src/request.js';

const git = (cwd: string, ...a: string[]): void => { execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'ignore' }); };

test('워크트리 안에서 불러도 프로젝트 루트와 .spec은 main 작업 폴더를 가리키고, 거기 쓴 요청 기록을 읽는다', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-')));
  const main = path.join(base, 'main');
  fs.mkdirSync(path.join(main, 'src'), { recursive: true });
  fs.writeFileSync(path.join(main, 'src', 'a.ts'), '');
  git(main, 'init', '-q', '-b', 'main'); git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'x');
  const wt = path.join(base, 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'b', wt);
  assert.equal(projectRoot(path.join(wt, 'src')), main);
  assert.equal(projectRoot(path.join(main, 'src')), main);
  assert.equal(specDir(path.join(wt, 'src')), path.join(main, '.spec'));
  fs.mkdirSync(path.join(main, '.spec', 'requests'), { recursive: true });
  fs.writeFileSync(path.join(main, '.spec', 'requests', '1.json'), JSON.stringify({ id: 1, title: 't', stage: 'test', step: 'x', events: [], scope: {}, agent: { name: '' } }));
  assert.equal(loadRequests(path.join(wt, 'src')).length, 1);
  assert.equal(fs.existsSync(path.join(wt, '.spec')), false);
});
