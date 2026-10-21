/**
 * @why 요청 번호 없는 커밋을 막는 훅이 막을 것은 막고 통과시킬 것은 통과시키는지 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../src/commit-msg.js';
import { addRequest } from '../src/request.js';
import { tempProject } from './helpers.js';

/** 커밋 메시지 파일을 만들어 검사 결과(종료 코드)를 돌려준다 */
async function check(root: string, message: string): Promise<number | undefined> {
  const f = path.join(root, 'MSG');
  fs.writeFileSync(f, message);
  const err = console.error; console.error = () => {};
  try { return await main([f, root]); } finally { console.error = err; }
}

test('요청이 하나도 없는 프로젝트는 통과한다', async () => {
  const { root } = tempProject();
  assert.equal(await check(root, 'feat: 아무 번호 없음'), 0);
});

test('요청이 있으면 번호가 없는 커밋을 막는다', async () => {
  const { root, src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.equal(await check(root, 'feat: 번호 없음\n\n본문'), 1);
});

test('등록된 번호는 통과하고 없는 번호는 막는다', async () => {
  const { root, src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.equal(await check(root, 'feat: 있음\n\n요청 #1'), 0);
  assert.equal(await check(root, 'feat: 없음\n\n요청 #9'), 1);
});

test('병합과 되돌리기 커밋은 번호가 없어도 통과한다', async () => {
  const { root, src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.equal(await check(root, 'Merge branch x'), 0);
  assert.equal(await check(root, 'Revert "feat: x"'), 0);
});

test('주석 줄(#으로 시작)의 번호는 세지 않는다', async () => {
  const { root, src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.equal(await check(root, 'feat: x\n# 요청 #1'), 1);
});

test('설정 파일이 없는 프로젝트는 통과한다', async () => {
  const { root } = tempProject();
  fs.rmSync(path.join(root, '.spec', 'config.json'));
  assert.equal(await check(root, 'feat: 설정 없음'), 0);
});
