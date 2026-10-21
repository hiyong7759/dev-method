/**
 * @why 요청의 진행(설계 → 구현 → 테스트 → 완료)과 "승인은 사용자만"이라는 약속이 고치다가 깨지지 않게 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addRequest, submitDesign, approveDesign, rejectDesign, noteImpl, requestTest, approveTest, testProblem, setOrder, loadRequests, describeRequests } from '../src/request.js';
import { tempProject } from './helpers.js';

const design = { understanding: '이해', approach: '방법' };

test('요청은 설계 → 구현 → 테스트 → 완료로 흐른다', () => {
  const { src } = tempProject();
  const r = addRequest(src, { title: '첫 요청' });
  assert.equal(r.id, 1);
  assert.deepEqual([r.stage, r.step], ['design', 'drafting']);
  submitDesign(src, 1, design);
  assert.equal(loadRequests(src)[0].step, 'submitted');
  approveDesign(src, 1);
  assert.deepEqual([loadRequests(src)[0].stage, loadRequests(src)[0].step], ['impl', 'working']);
  noteImpl(src, 1, 'abc1234');
  assert.deepEqual(loadRequests(src)[0].commits, ['abc1234']);
  requestTest(src, 1);
  assert.equal(loadRequests(src)[0].step, 'requested');
  approveTest(src, 1, true);
  assert.deepEqual([loadRequests(src)[0].stage, loadRequests(src)[0].step], ['done', 'done']);
});

test('승인 대기가 아닐 때의 승인·반려는 거절한다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.throws(() => approveDesign(src, 1), /승인 대기/);
  assert.throws(() => approveTest(src, 1, false), /승인 대기/);
  assert.throws(() => noteImpl(src, 1, ''), /설계 승인이 먼저/);
  assert.throws(() => requestTest(src, 1), /테스트를 올릴 수 있는 단계가 아니다/);
});

test('반려는 이유가 있어야 하고, 설계가 다시 작성 중이 된다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  submitDesign(src, 1, design);
  assert.throws(() => rejectDesign(src, 1, '  '), /이유/);
  rejectDesign(src, 1, '화면이 다르다');
  const r = loadRequests(src)[0];
  assert.deepEqual([r.stage, r.step, r.design?.rejected], ['design', 'revise', 1]);
  submitDesign(src, 1, design);
  assert.equal(loadRequests(src)[0].design?.rejected, 1, '다시 올려도 반려 횟수는 유지된다');
});

test('설계에는 이해한 내용이 있어야 하지만 설계 없음은 비어도 된다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.throws(() => submitDesign(src, 1, { approach: 'x' }), /understanding/);
  submitDesign(src, 1, { none: true });
  assert.equal(loadRequests(src)[0].design?.none, true);
});

test('테스트에서 문제가 있으면 같은 요청에서 고치는 중이 되고 다시 올릴 수 있다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  submitDesign(src, 1, { none: true }); approveDesign(src, 1); requestTest(src, 1);
  assert.throws(() => testProblem(src, 1, ''), /한 줄/);
  testProblem(src, 1, '버튼이 안 눌린다');
  assert.deepEqual([loadRequests(src)[0].stage, loadRequests(src)[0].step], ['test', 'fix']);
  requestTest(src, 1);
  assert.equal(loadRequests(src)[0].step, 'requested');
});

test('겹치는 요청은 순서를 정하면 뒤 요청이 앞 요청이 끝나기를 기다린다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a', screens: ['S'] });
  addRequest(src, { title: 'b', screens: ['S'] });
  const before = describeRequests(loadRequests(src));
  assert.equal(before[0].overlaps.length, 1);
  setOrder(src, 1, 2);
  submitDesign(src, 2, { none: true }); approveDesign(src, 2);
  const after = describeRequests(loadRequests(src));
  assert.deepEqual(after[1].waitingFor, [1]);
  assert.equal(after[1].stepLabel, '대기');
});

test('요청 번호는 이어서 붙고, 제목이 비면 거절한다', () => {
  const { src } = tempProject();
  assert.throws(() => addRequest(src, { title: ' ' }), /제목/);
  assert.equal(addRequest(src, { title: 'a' }).id, 1);
  assert.equal(addRequest(src, { title: 'b' }).id, 2);
});
