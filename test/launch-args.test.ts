/**
 * @why 요청 #90의 약속을 지킨다: 담당 세션을 claude --bg로 띄울 때 설정의 autoCompact가 --autocompact로 걸려, 메시지로는 못 보내는 압축을 세션이 스스로 하게 한다. 값이 없거나 claude가 받지 않는 범위면 옵션을 빼서 세션이 뜨지 않는 일이 없다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchArgs } from '../src/session.js';
import { tempProject } from './helpers.js';

const compactOf = (root: string | undefined): string | undefined => {
  const a = launchArgs(root);
  const i = a.indexOf('--autocompact');
  return i < 0 ? undefined : a[i + 1];
};

test('설정의 autoCompact가 있으면 --autocompact로 건다', () => {
  const { root } = tempProject({ autoCompact: 200000 });
  assert.equal(compactOf(root), '200000');
});

test('값이 없거나 10만~100만 밖이면 옵션을 빼고, 프로젝트를 안 주어도 뺀다', () => {
  const { root } = tempProject();
  const cfg = path.join(root, '.spec', 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({}));
  assert.equal(compactOf(root), undefined);
  fs.writeFileSync(cfg, JSON.stringify({ autoCompact: 50000 }));
  assert.equal(compactOf(root), undefined);
  fs.writeFileSync(cfg, JSON.stringify({ autoCompact: 2000000 }));
  assert.equal(compactOf(root), undefined);
  fs.writeFileSync(cfg, JSON.stringify({ autoCompact: 200000 }));
  assert.equal(compactOf(undefined), undefined);
});
