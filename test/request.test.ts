/**
 * @why 요청의 진행(설계 → 구현 → 테스트 → 완료)과 "승인은 사용자만"이라는 약속이 고치다가 깨지지 않게 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addRequest, startDesign, submitDesign, approveDesign, rejectDesign, noteImpl, requestTest, approveTest, testProblem, setOrder, loadRequests, describeRequests } from '../src/request.js';
import { tempProject } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';
import { liveShotFile } from '../src/request.js';

const design = { understanding: '이해', approach: '방법' };

test('요청은 설계 → 구현 → 테스트 → 완료로 흐른다', () => {
  const { src } = tempProject();
  const r = addRequest(src, { title: '첫 요청' });
  assert.equal(r.id, 1);
  assert.deepEqual([r.stage, r.step], ['design', 'queued']);
  assert.equal(describeRequests([r])[0].stepLabel, '접수');
  assert.equal(startDesign(src, 1).step, 'drafting');
  assert.throws(() => startDesign(src, 1), /시작 전이 아니다/);
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

/** 그림 대신 쓰는 아주 작은 파일 */
const png = (dir: string, name: string): string => { const f = path.join(dir, name); fs.writeFileSync(f, 'x'); return f; };

test('설계 화면의 현행 그림: 신규 화면은 없어도 되고, 손으로 올리면 경고 출처, 도구가 찍은 것은 도구 출처', () => {
  const { root, src } = tempProject();
  addRequest(src, { title: 'a' });
  const after = png(root, 'after.png');
  // 이미 있는 화면인데 현행 그림이 없으면 올릴 수 없다
  assert.throws(() => submitDesign(src, 1, { ...design, screens: [{ screen: '목록', after }] }), /현행 그림이 없다.*request shot/);
  // 신규 화면은 현행 없이 올린다
  let r = submitDesign(src, 1, { ...design, screens: [{ screen: '새 화면', after, isNew: true }] });
  assert.deepEqual([r.design!.screens[0].before, r.design!.screens[0].isNew, r.design!.screens[0].beforeSource], ['', true, undefined]);
  // 손으로 올린 현행 그림은 manual로 남는다
  r = submitDesign(src, 1, { ...design, screens: [{ screen: '목록', after, before: png(root, 'before.png') }] });
  assert.equal(r.design!.screens[0].beforeSource, 'manual');
  // 도구가 찍어 둔 현행 그림이 있으면 tool 출처와 시각이 붙는다
  const live = liveShotFile(src, 1, '목록');
  fs.mkdirSync(path.dirname(live), { recursive: true }); fs.writeFileSync(live, 'x'); fs.writeFileSync(live.replace(/\.png$/, '.json'), JSON.stringify({ capturedAt: '2026-10-24T09:00:00.000Z' }));
  r = submitDesign(src, 1, { ...design, screens: [{ screen: '목록', after, highlights: [{ l: 1, t: 2, w: 3, h: 4, label: '바뀐 곳' }] }] });
  assert.deepEqual([r.design!.screens[0].beforeSource, r.design!.screens[0].capturedAt, r.design!.screens[0].highlights?.[0].label], ['tool', '2026-10-24T09:00:00.000Z', '바뀐 곳']);
});

test('설계 글은 영역별 항목(points)으로 올릴 수 있다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  const r = submitDesign(src, 1, { understanding: '요약', points: [{ area: '서버', title: '세션', text: '만든다' }] });
  assert.deepEqual(r.design!.points, [{ area: '서버', title: '세션', text: '만든다' }]);
});
