/**
 * @why "할 일 뭐있지"에 쓰는 todo가 요청을 누구 차례인지로 제대로 나누고, 시작 전 요청과 제안 순서를 보여 주는지 확인한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addRequest, startDesign, submitDesign, approveDesign, noteImpl, requestTest } from '../src/request.js';
import { addComment } from '../src/comment.js';
import { describeTodo } from '../src/todo.js';
import { buildModel } from '../src/model.js';
import { tempProject } from './helpers.js';

test('할 일: 내 차례, 에이전트가 진행 중, 시작 전, 코멘트를 나눠 보이고 제안 순서를 낸다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '시작 전 요청' });                       // 1: 시작 전
  addRequest(src, { title: '테스트 올린 요청' });                    // 2: 테스트 승인 대기
  submitDesign(src, 2, { files: [{ path: 'a.ts', why: '시험' }], none: true }); approveDesign(src, 2); noteImpl(src, 2, 'abc'); requestTest(src, 2);
  addRequest(src, { title: '설계 쓰는 중' }); startDesign(src, 3);   // 3: 설계 작성 중
  addComment(src, { target: { kind: 'screen', label: '사용 흐름' }, text: '궁금합니다' });
  const text = describeTodo(buildModel(src));
  assert.match(text, /내 차례 — 승인해 주세요 \(1건\)[\s\S]*#2 테스트 올린 요청/);
  assert.match(text, /시작 전 — 우선순위를 정해 주세요 \(1건\)[\s\S]*#1 시작 전 요청/);
  assert.match(text, /에이전트가 진행 중 \(1건\)[\s\S]*#3 설계 쓰는 중/);
  assert.match(text, /답을 기다리는 코멘트 \(1건\)/);
  assert.match(text, /1\. 코멘트 1건에 답한다[\s\S]*#3 이어서 진행[\s\S]*#1 설계를 시작할지 정한다[\s\S]*사용자 승인을 기다린다/);
});
