/**
 * @why 요청 #106의 약속을 지킨다: 서버가 켜졌을 때만 느린 조회를 잠시 기억하고(화면이 2.5초마다 요청해도 git을 매번 부르지 않는다), 꺼져 있으면(명령줄·시험) 늘 새로 조회해 결과가 최신이다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearMemo, enableMemo, memo } from '../src/memo.js';

test('서버 기억이 꺼져 있으면 매번 새로 조회한다', () => {
  clearMemo();
  let n = 0;
  memo('a', 10_000, () => ++n); memo('a', 10_000, () => ++n);
  assert.equal(n, 2);
});

test('켜면 시간 안에는 한 번만 조회하고, 시간이 지나면 다시 조회하며, 던지면 기억하지 않는다', async () => {
  enableMemo(); clearMemo();
  let n = 0;
  assert.equal(memo('b', 50, () => ++n), 1);
  assert.equal(memo('b', 50, () => ++n), 1, '시간 안에는 기억한 값');
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(memo('b', 50, () => ++n), 2, '시간이 지나면 다시 조회');
  assert.throws(() => memo('c', 1000, () => { throw new Error('x'); }));
  assert.equal(memo('c', 1000, () => 7), 7, '던진 조회는 기억하지 않는다');
});
