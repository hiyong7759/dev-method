/**
 * @why 테스트를 올리면 사용자에게 바로 가지 않고 점검을 거치고, 사용자가 짚은 것만 승인·반려를 정한다는 약속이 고치다가 깨지지 않게 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addRequest, submitDesign, approveDesign, requestTest, loadRequests, reviewReport, reviewSkip, reviewRetry, markStalledReviews, saveNote, attachNoteShot, editNote, deleteNote, sendNoteNow, answerNote, approveTest, testProblem, describeRequests, REVIEW_STALL_MS } from '../src/request.js';
import { tempProject } from './helpers.js';

const design = { understanding: '이해', approach: '방법', files: [{ path: 'a.ts', why: '시험' }], none: true };
const note = { kind: 'part' as const, label: '요청 상세 › 제목 줄', url: '/x', text: '제목이 잘린다', src: 'src/a.ts:3' };

/** 점검을 켠 프로젝트에서 테스트를 올려 둔 요청 하나 */
function reviewed(): string {
  const { src } = tempProject({ review: true });
  addRequest(src, { title: '점검 요청', noTest: '시험' });
  submitDesign(src, 1, design); approveDesign(src, 1);
  requestTest(src, 1);
  return src;
}
/** 점검 통과까지 */
function passed(): string {
  const src = reviewed();
  reviewReport(src, 1, { seen: [{ what: '타입 검사', ok: true }] });
  return src;
}
const get = (src: string) => loadRequests(src)[0];

test('점검을 켜면 테스트를 올려도 사용자 차례가 아니라 점검 중이다', () => {
  const src = reviewed();
  assert.deepEqual([get(src).stage, get(src).step], ['test', 'review']);
  const v = describeRequests(loadRequests(src))[0];
  assert.equal(v.stepLabel, '점검 중');
  assert.equal(v.turn, 'agent');
  assert.equal(get(src).test?.review?.round, 1);
});

test('점검을 안 켠 프로젝트는 지금처럼 바로 승인 대기다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '옛 방식', noTest: '시험' });
  submitDesign(src, 1, design); approveDesign(src, 1);
  requestTest(src, 1);
  assert.equal(get(src).step, 'requested');
  assert.equal(get(src).test?.review, undefined);
});

test('점검이 통과하면 사용자 차례가 되고 확인한 것이 남는다', () => {
  const src = passed();
  assert.equal(get(src).step, 'requested');
  assert.equal(get(src).test?.review?.state, 'passed');
  assert.equal(get(src).test?.review?.seen.length, 1);
  assert.equal(get(src).events.at(-1)?.kind, 'test-requested');
});

test('점검이 실패를 찾으면 담당에게 되돌리고 자동으로 2번까지 고친다. 2번 뒤에도 남으면 사용자에게 올린다', () => {
  const src = reviewed();
  reviewReport(src, 1, { failures: [{ what: '설계 범위 밖 변경', detail: 'b.ts' }] });
  assert.equal(get(src).step, 'review-fix');
  assert.equal(get(src).test?.review?.autoFixes, 1);
  requestTest(src, 1);
  assert.equal(get(src).step, 'review');
  assert.equal(get(src).test?.review?.round, 2);
  assert.equal(get(src).test?.review?.autoFixes, 1, '다시 올려도 자동 고침 횟수는 이어진다');
  reviewReport(src, 1, { failures: [{ what: '시험 실패' }] });
  assert.equal(get(src).test?.review?.autoFixes, 2);
  requestTest(src, 1);
  reviewReport(src, 1, { failures: [{ what: '아직 남음' }] });
  assert.equal(get(src).step, 'requested', '2번 고쳐도 남으면 사용자 차례');
  assert.deepEqual(get(src).test?.review?.failures.map((f) => f.what), ['아직 남음']);
});

test('점검 중이 아니면 점검 보고를 받지 않는다', () => {
  const src = passed();
  assert.throws(() => reviewReport(src, 1, {}), /점검 중이 아니다/);
});

test('점검이 30분 넘게 소식이 없으면 점검 안 됨으로 바뀌고 사용자가 다시 점검하거나 건너뛴다', () => {
  const src = reviewed();
  assert.deepEqual(markStalledReviews(src, Date.now() + 60_000), []);
  assert.deepEqual(markStalledReviews(src, Date.now() + REVIEW_STALL_MS + 60_000), [1]);
  assert.equal(get(src).step, 'review-stalled');
  assert.equal(describeRequests(loadRequests(src))[0].turn, 'user');
  reviewRetry(src, 1);
  assert.equal(get(src).step, 'review');
  markStalledReviews(src, Date.now() + REVIEW_STALL_MS + 60_000);
  reviewSkip(src, 1);
  assert.equal(get(src).step, 'requested');
  assert.equal(get(src).test?.review?.state, 'skipped');
});

test('짚은 것은 점검을 거쳐 사용자 차례일 때만 저장되고, 글이 없으면 저장되지 않는다', () => {
  const src = reviewed();
  assert.throws(() => saveNote(src, 1, note), /사용자 확인을 기다리는 테스트가 아니다/);
  reviewReport(src, 1, {});
  assert.throws(() => saveNote(src, 1, { ...note, text: '  ' }), /한 줄을 써야/);
  const n = saveNote(src, 1, note);
  assert.equal(n.id, '1');
  assert.equal(n.status, 'open');
  assert.equal(n.round, 1);
  assert.equal(saveNote(src, 1, { ...note, kind: 'screen', label: '화면 전체' }).id, '2');
});

test('짚은 것에 캡처를 뒤에서 붙이고 글을 고치고 지울 수 있다', () => {
  const src = passed();
  const n = saveNote(src, 1, note);
  const png = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
  attachNoteShot(src, 1, n.id, png);
  const file = path.join(src, '..', '.spec', 'shots', 'r1-n1.png');
  assert.ok(fs.existsSync(file));
  assert.throws(() => attachNoteShot(src, 1, n.id, 'data:text/plain;base64,eA=='), /png/);
  assert.equal(editNote(src, 1, n.id, '고친 글').text, '고친 글');
  deleteNote(src, 1, n.id);
  assert.equal(get(src).test?.notes?.length, 0);
});

test('짚은 것이 남아 있으면 승인할 수 없고, 없으면 승인된다', () => {
  const src = passed();
  const n = saveNote(src, 1, note);
  assert.throws(() => approveTest(src, 1, false), /짚은 것 1건이 남아 있어/);
  deleteNote(src, 1, n.id);
  approveTest(src, 1, false);
  assert.equal(get(src).stage, 'done');
  assert.equal(get(src).test?.touches, 3, '짚기·지우기·승인을 센다');
});

test('반려는 짚은 것을 모두 한 묶음으로 보내고 항목의 글·위치·캡처가 사유에 들어간다', () => {
  const src = passed();
  assert.throws(() => testProblem(src, 1, ''), /짚은 것이 없다/);
  const n1 = saveNote(src, 1, note);
  attachNoteShot(src, 1, n1.id, 'data:image/png;base64,eA==');
  saveNote(src, 1, { ...note, kind: 'region', label: '요청 상세 › 영역', text: '단추가 작다', src: undefined });
  sendNoteNow(src, 1, '2');
  testProblem(src, 1, '');
  const r = get(src);
  assert.equal(r.step, 'fix');
  const why = r.events.at(-1)!.note;
  assert.match(why, /1\. \[부품\] 요청 상세 › 제목 줄: 제목이 잘린다 \(소스 src\/a\.ts:3\) \(캡처 \.spec\/shots\/r1-n1\.png\)/);
  assert.match(why, /2\. \[영역\].*단추가 작다.*이미 먼저 알렸음/);
  assert.deepEqual(r.test?.notes?.map((x) => x.status), ['returned', 'returned']);
});

test('먼저 보내기는 반려가 아니라 알림만이고 한 번만 된다', () => {
  const src = passed();
  const n = saveNote(src, 1, note);
  sendNoteNow(src, 1, n.id);
  assert.equal(get(src).step, 'requested', '단계는 그대로');
  assert.equal(get(src).events.at(-1)?.kind, 'test-note-now');
  assert.throws(() => sendNoteNow(src, 1, n.id), /이미 먼저 보낸/);
});

test('고쳐져 돌아오면 지난번에 짚은 것에 고쳐졌다·아직이다로 답하고, 모두 고쳐졌을 때만 승인된다', () => {
  const src = passed();
  saveNote(src, 1, note);
  saveNote(src, 1, { ...note, text: '둘째' });
  testProblem(src, 1, '');
  requestTest(src, 1);
  assert.equal(get(src).test?.review?.round, 2);
  reviewReport(src, 1, { rechecks: [{ note: '1', shot: path.join(src, '..', '.spec', 'shots', 'r1-n1.png') }].filter(() => false) });
  assert.throws(() => approveTest(src, 1, false), /짚은 것 2건이 남아 있어/);
  assert.equal(answerNote(src, 1, '1', 'fixed').status, 'fixed');
  assert.equal(answerNote(src, 1, '2', 'still').status, 'still');
  assert.throws(() => approveTest(src, 1, false), /짚은 것 1건이 남아 있어/);
  testProblem(src, 1, '');
  assert.deepEqual(get(src).test?.notes?.map((x) => x.status), ['fixed', 'returned'], '아직인 것만 다시 보내고 고쳐진 것은 닫힌다');
  requestTest(src, 1); reviewReport(src, 1, {});
  answerNote(src, 1, '2', 'fixed');
  approveTest(src, 1, false);
  assert.equal(get(src).stage, 'done');
});

test('점검 기록이 없는 옛 테스트의 승인·반려는 지금 그대로다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '옛 방식', noTest: '시험' });
  submitDesign(src, 1, design); approveDesign(src, 1); requestTest(src, 1);
  assert.throws(() => testProblem(src, 1, ''), /한 줄 적어야/);
  testProblem(src, 1, '문제');
  assert.equal(get(src).step, 'fix');
  requestTest(src, 1);
  approveTest(src, 1, false);
  assert.equal(get(src).stage, 'done');
});
