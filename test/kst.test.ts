import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kst } from '../src/kst.js';

test('UTC 시각을 한국시간으로 바꾼다', () => {
  assert.equal(kst('2026-10-26T12:23:11.046Z'), '10-26 21:23 KST');
  assert.equal(kst('2026-10-26T12:23:11.046Z', true), '2026-10-26 21:23 KST');
});

test('날짜가 넘어가는 경우와 읽을 수 없는 값', () => {
  assert.equal(kst('2026-12-31T15:30:00Z'), '01-01 00:30 KST');
  assert.equal(kst('없음'), '없음');
});
