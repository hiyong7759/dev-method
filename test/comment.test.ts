/**
 * @why 코멘트가 대상·캡처와 함께 저장되고, 사용자가 쓰면 "답 기다림", 에이전트가 답하면 "답함"이 되며, 요청으로 만들면 닫히는지 확인한다. 에이전트가 읽는 글에 대상 정보가 빠지지 않는지도 본다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addComment, replyComment, closeComment, commentToRequest, loadComments, describeComment, shotDir } from '../src/comment.js';
import { loadRequests } from '../src/request.js';
import { tempProject } from './helpers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('코멘트: 남김 → 답 기다림, 에이전트 답 → 답함, 사용자가 이어 묻기 → 다시 답 기다림', () => {
  const { src } = tempProject();
  const c = addComment(src, { target: { kind: 'part', label: '하루 일정 › ② 예약 카드', screen: '하루 일정', part: '예약 카드', src: 'DayPlan.tsx:88' }, text: '확정 글자 색이 같아 구분이 안 돼요', shot: PNG });
  assert.equal(c.id, 1); assert.equal(c.status, 'waiting');
  assert.ok(fs.existsSync(path.join(shotDir(src), 'c1.png')));
  assert.equal(replyComment(src, 1, 'agent', '상태 글자색이 하나로 고정돼 있습니다', ['DayPlan.tsx:88']).status, 'answered');
  assert.equal(replyComment(src, 1, 'user', '그럼 나눠 주세요').status, 'waiting');
  assert.equal(loadComments(src)[0].thread.length, 3);
});

test('에이전트가 읽는 글에 화면·부품·소스 위치·캡처·대화가 들어간다', () => {
  const { src } = tempProject();
  addComment(src, { target: { kind: 'item', label: '리포트 #31 · 임시메모', no: 31, view: '#/manage/reports?no=31' }, text: '왜 지워도 되나요?' });
  const text = describeComment(loadComments(src)[0]);
  assert.match(text, /코멘트 #1 · 답 기다림/);
  assert.match(text, /리포트: #31 {2}\(자세히: report show 31\)/);
  assert.match(text, /사용자 .*: 왜 지워도 되나요\?/);
});

test('요청으로 만들면 요청이 생기고 코멘트는 닫히며, 두 번은 못 만든다', () => {
  const { src } = tempProject();
  addComment(src, { target: { kind: 'part', label: '하루 일정 › 예약 카드', screen: '하루 일정' }, text: '상태마다 색을 나눠 주세요' });
  const r = commentToRequest(src, 1, '예약 카드 상태 색 나누기');
  assert.equal(loadRequests(src).find((x) => x.id === r.request)?.origin.channel, '코멘트');
  assert.equal(loadComments(src)[0].status, 'closed');
  assert.throws(() => commentToRequest(src, 1, 'x'), /이미 요청/);
  assert.equal(closeComment(src, 1).status, 'closed');
});

test('빈 글이나 대상 없는 코멘트는 받지 않는다', () => {
  const { src } = tempProject();
  assert.throws(() => addComment(src, { target: { kind: 'screen', label: '사용 흐름' }, text: '  ' }), /비었다/);
  assert.throws(() => addComment(src, { target: { kind: 'screen', label: '' }, text: '글' }), /대상/);
});
