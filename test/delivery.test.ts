/**
 * @why (설계 시작도 같은 기록을 받는다: 보냄·읽음(ack)·설계 제출·멈춤.) 사용자 결정의 전달 상태가 화면 세 곳(목록 이름표·상세 상태 글·패널 카드)에서 어긋나지 않는지 지킨다: 읽기 전에는 일하는 중처럼 보이지 않고, 뒤 칸이 찼으면 앞 칸도 차며, 메신저가 못 보냈다고 이유를 남기면 전달 안 됨이 되고 다시 보내기로 대기로 돌아간다. 읽음은 request ack(markRead)뿐이다. 기록이 없는 옛 결정에는 상태를 만들지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addRequest, approveDesign, describeRequests, loadRequests, rejectDesign, startDesign, submitDesign } from '../src/request.js';
import { deliveryOf, markDelivered, markRead, markRequeued, markUndelivered, openDelivery, STALL_AFTER_MIN } from '../src/delivery.js';
import { tempProject } from './helpers.js';

const min = 60_000;
/** 설계를 올리고 반려한 요청 한 건(반려 직후 상태) */
function rejected(): { src: string } {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], understanding: 'u', screens: [] });
  rejectDesign(src, 1, '고쳐 주세요');
  return { src };
}
const req = (src: string) => loadRequests(src)[0];

test('전달 기록이 없는 옛 결정에는 전달 상태를 만들지 않는다', () => {
  const { src } = rejected();
  assert.equal(deliveryOf(src, req(src)), null);
});

test('읽기 전에는 "결정 전달 중"이고, ack로 읽으면 원래 상태 글로 돌아간다', () => {
  const { src } = rejected();
  openDelivery(src, req(src)); markDelivered(src, 1, 'send');
  const view = (): string => describeRequests(loadRequests(src), () => [], (r) => deliveryOf(src, r))[0].stepLabel;
  assert.equal(view(), '결정 전달 중');
  markRead(src, 1);
  assert.equal(view(), '설계 다시 작성 중');
});

test('메신저가 아직 안 가져갔으면(보냄 없음) 대기로 보인다', () => {
  const { src } = rejected();
  openDelivery(src, req(src));
  assert.equal(deliveryOf(src, req(src))?.state, 'hook-wait');
});

test('메신저가 못 보냈다고 이유를 남기면 전달 안 됨이고, 다시 보내기를 누르면 대기로 돌아간다', () => {
  const { src } = rejected();
  openDelivery(src, req(src));
  markUndelivered(src, 1, '담당 세션이 닫혀 있고 claude --bg --resume이 실패함');
  const v = deliveryOf(src, req(src));
  assert.equal(v?.state, 'failed');
  assert.equal(v?.reason, '담당 세션이 닫혀 있고 claude --bg --resume이 실패함');
  assert.equal(describeRequests(loadRequests(src), () => [], (r) => deliveryOf(src, r))[0].stepLabel, '전달 안 됨');
  markRequeued(src, 1);
  const again = deliveryOf(src, req(src));
  assert.equal(again?.state, 'hook-wait');
  assert.equal(again?.resent, 1);
  assert.equal(again?.reason, undefined);
  markDelivered(src, 1, 'bg-resume');
  assert.equal(deliveryOf(src, req(src))?.via, 'bg-resume');
});

test('에이전트가 이미 반영했으면 읽음·보냄이 비어 있어도 채워진 것으로 본다', () => {
  const { src } = rejected();
  openDelivery(src, req(src));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // 같은 밀리초에 찍히면 결정 '뒤'로 세지 못한다
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], understanding: 'u2', screens: [] }); // 반려 뒤 에이전트가 설계를 다시 올림 = 반영
  const v = deliveryOf(src, req(src));
  assert.equal(v?.state, 'applied');
  assert.ok(v?.read && v?.sent, '읽음·보냄이 반영 시각으로 채워진다');
});

test('새 결정이 생기면 이전 결정의 기록을 이어 쓰지 않는다', () => {
  const { src } = rejected();
  openDelivery(src, req(src)); markDelivered(src, 1, 'send'); markRead(src, 1);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // 결정 시각이 서로 달라지게
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], understanding: 'u2', screens: [] });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  approveDesign(src, 1);
  assert.equal(deliveryOf(src, req(src)), null, '새 결정은 기록을 새로 열기 전에는 상태가 없다');
  openDelivery(src, req(src));
  assert.equal(deliveryOf(src, req(src))?.read, null);
});

/** 접수에서 시작해 담당 세션에 첫 글을 보낸 요청 한 건 */
function started(): { src: string } {
  const { src } = tempProject();
  addRequest(src, { title: 's' });
  startDesign(src, 1);
  openDelivery(src, req(src)); markDelivered(src, 1, 'bg-new');
  return { src };
}

test('시작도 전달 기록을 받는다: 보낸 뒤 읽기 전에는 "시작 전달 중", ack가 읽음, 설계 제출이 반영이다', () => {
  const { src } = started();
  const view = (): string => describeRequests(loadRequests(src), () => [], (r) => deliveryOf(src, r))[0].stepLabel;
  assert.equal(deliveryOf(src, req(src))!.kind, 'started');
  assert.equal(view(), '시작 전달 중');
  markRead(src, 1);
  assert.equal(deliveryOf(src, req(src))!.state, 'read');
  assert.notEqual(view(), '시작 전달 중');
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], understanding: 'u', screens: [] });
  const v = deliveryOf(src, req(src))!;
  assert.equal(v.state, 'applied');
  assert.ok(v.applied, '설계 제출이 반영이다');
});

test('담당 등록(request agent)만으로는 읽음이 찍히지 않는다', () => {
  const { src } = started();
  assert.equal(deliveryOf(src, req(src))!.state, 'sending');
});

test('시작을 읽고도 20분 넘게 설계가 없으면 멈춘 듯함이다', () => {
  const { src } = started();
  markRead(src, 1);
  assert.notEqual(deliveryOf(src, req(src), Date.now() + (STALL_AFTER_MIN - 1) * min)!.state, 'stalled', '20분이 안 됐으면 기다린다');
  assert.equal(deliveryOf(src, req(src), Date.now() + (STALL_AFTER_MIN + 1) * min)!.state, 'stalled');
});
