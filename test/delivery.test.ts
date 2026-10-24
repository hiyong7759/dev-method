/**
 * @why 사용자 결정의 전달 상태가 화면 세 곳(목록 이름표·상세 상태 글·패널 카드)에서 어긋나지 않는지 지킨다: 읽기 전에는 일하는 중처럼 보이지 않고, 뒤 칸이 찼으면 앞 칸도 차며, 5분 뒤 재전송 대상이 되고, 재전송이 끝나도 안 읽히면 전달 안 됨이 된다. 기록이 없는 옛 결정에는 상태를 만들지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addRequest, approveDesign, describeRequests, loadRequests, rejectDesign, submitDesign } from '../src/request.js';
import { deliveryOf, dueForResend, markRead, markSent, openDelivery } from '../src/delivery.js';
import { tempProject } from './helpers.js';

const min = 60_000;
/** 설계를 올리고 반려한 요청 한 건(반려 직후 상태) */
function rejected(): { src: string } {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  submitDesign(src, 1, { understanding: 'u', screens: [] });
  rejectDesign(src, 1, '고쳐 주세요');
  return { src };
}
const req = (src: string) => loadRequests(src)[0];

test('전달 기록이 없는 옛 결정에는 전달 상태를 만들지 않는다', () => {
  const { src } = rejected();
  assert.equal(deliveryOf(src, req(src)), null);
});

test('읽기 전에는 "결정 전달 중"이고, 읽으면 원래 상태 글로 돌아간다', () => {
  const { src } = rejected();
  openDelivery(src, req(src)); markSent(src, 1, 'wake');
  const view = (): string => describeRequests(loadRequests(src), () => [], (r) => deliveryOf(src, r))[0].stepLabel;
  assert.equal(view(), '결정 전달 중');
  markRead(src, 1);
  assert.equal(view(), '설계 다시 작성 중');
});

test('보내는 장치가 꺼져 있으면(보냄 없음) 훅 대기로 보인다', () => {
  const { src } = rejected();
  openDelivery(src, req(src));
  assert.equal(deliveryOf(src, req(src))?.state, 'hook-wait');
});

test('보낸 지 5분이 지나도 읽음이 없으면 재전송 대상이고, 2번 보낸 뒤에도 안 읽히면 전달 안 됨이다', () => {
  const { src } = rejected();
  openDelivery(src, req(src)); markSent(src, 1, 'wake');
  const now = Date.now();
  assert.deepEqual(dueForResend(src, loadRequests(src), now + 4 * min), [], '4분은 아직');
  assert.deepEqual(dueForResend(src, loadRequests(src), now + 6 * min), [1], '5분이 지나면 보낸다');
  markSent(src, 1, 'wake', true); markSent(src, 1, 'wake', true);
  const v = deliveryOf(src, req(src), now + 20 * min);
  assert.equal(v?.state, 'failed');
  assert.equal(v?.resent, 2);
  assert.deepEqual(dueForResend(src, loadRequests(src), now + 20 * min), [], '두 번 뒤에는 더 보내지 않는다');
  assert.equal(describeRequests(loadRequests(src), () => [], (r) => deliveryOf(src, r, now + 20 * min))[0].stepLabel, '전달 안 됨');
});

test('에이전트가 이미 반영했으면 읽음·보냄이 비어 있어도 채워진 것으로 본다', () => {
  const { src } = rejected();
  openDelivery(src, req(src));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // 같은 밀리초에 찍히면 결정 '뒤'로 세지 못한다
  submitDesign(src, 1, { understanding: 'u2', screens: [] }); // 반려 뒤 에이전트가 설계를 다시 올림 = 반영
  const v = deliveryOf(src, req(src));
  assert.equal(v?.state, 'applied');
  assert.ok(v?.read && v?.sent, '읽음·보냄이 반영 시각으로 채워진다');
});

test('새 결정이 생기면 이전 결정의 기록을 이어 쓰지 않는다', () => {
  const { src } = rejected();
  openDelivery(src, req(src)); markSent(src, 1, 'wake'); markRead(src, 1);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // 결정 시각이 서로 달라지게
  submitDesign(src, 1, { understanding: 'u2', screens: [] });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  approveDesign(src, 1);
  assert.equal(deliveryOf(src, req(src)), null, '새 결정은 기록을 새로 열기 전에는 상태가 없다');
  openDelivery(src, req(src));
  assert.equal(deliveryOf(src, req(src))?.read, null);
});
