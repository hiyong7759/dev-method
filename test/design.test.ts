/**
 * @why 시안 판이 "구현과 같음"으로 기록된 뒤 대응 소스가 바뀌면 "소스가 더 최신"으로 바뀌는지, 아직 구현 전인 시안과 대조 안 한 판이 구분되는지 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { freshness, readMap } from '../src/design.js';
import { main } from '../src/design.js';
import { tempProject } from './helpers.js';

const git = (root: string, ...a: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' });

test('판 표시: 같음 → 소스 바뀜 → 다시 맞춤, 그리고 시안·대조 안 됨·참고용', async () => {
  const { root } = tempProject();
  fs.writeFileSync(path.join(root, 'a.ts'), '1');
  fs.writeFileSync(path.join(root, '.spec', 'design-map.json'), JSON.stringify({ boards: [
    { board: 'A.dc.html', no: '1', title: '가', files: ['a.ts'], state: 'unchecked' },
    { board: 'B.dc.html', no: '2', title: '나', files: ['a.ts'], state: 'draft', request: 7 },
    { board: 'C.dc.html', no: '3', title: '다', files: [], state: 'unchecked' },
  ] }));
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'x');
  const get = (n: number) => freshness(root, readMap(root).boards[n]);
  assert.equal(get(0).mark, '?');
  assert.equal(get(1).mark, '◇'); assert.match(get(1).text, /#7/);
  assert.equal(get(2).mark, '·');
  const old = process.cwd(); process.chdir(root);
  try { assert.equal(await main(['sync', 'A']), 0); assert.equal(get(0).mark, '✓');
    fs.writeFileSync(path.join(root, 'a.ts'), '2'); assert.equal(await main(['sync', 'A']), 1, '커밋 안 한 소스가 있으면 맞추지 않는다');
    git(root, 'add', '-A'); git(root, 'commit', '-qm', 'y');
    assert.equal(get(0).mark, '△'); assert.equal(get(0).stale, true);
    assert.equal(await main(['sync', 'A']), 0); assert.equal(get(0).mark, '✓');
  } finally { process.chdir(old); }
});
