/**
 * @why 테스트 계정 파일(.spec/local.json)이 커밋에 올라가지 않는지 지킨다. 로그인은 확인 에이전트가 ego-browser로 하므로 도구가 로그인하는 시험은 없다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { LAUNCHER } from '../src/paths.js';
import { tempProject } from './helpers.js';

test('테스트 계정 파일(.spec/local.json)을 커밋하려 하면 막는다', () => {
  const { root } = tempProject();
  fs.writeFileSync(path.join(root, '.spec', 'local.json'), '{}');
  execFileSync('git', ['add', '-f', '.spec/local.json'], { cwd: root });
  const r = spawnSync(process.execPath, [LAUNCHER, 'precommit', root], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /local\.json/);
});
