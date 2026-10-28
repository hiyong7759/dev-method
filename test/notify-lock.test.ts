/**
 * @why 요청 #105의 약속: 서버와 request watch가 알림 읽은 자리 파일을 동시에 고쳐도 서로 덮어쓰지 않고, 처음 보는 요청의 시작·첫 설계 제출 알림을 건너뛰지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addRequest, startDesign, submitDesign } from '../src/request.js';
import { takeNotices } from '../src/notify.js';
import { tempProject } from './helpers.js';

const design = { understanding: '이해', approach: '방법', brief: ['요약'], files: [{ path: 'a.ts', why: '시험' }] };

test('이미 쓰던 받는 쪽이 처음 보는 요청의 시작·설계 제출 알림을 건너뛰지 않는다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '먼저 있던 요청', agent: '담당' });
  assert.deepEqual(takeNotices(src, 'terminal'), [], '처음 받는 쪽은 옛일을 쏟지 않는다');
  addRequest(src, { title: '새 요청', agent: '담당 2' });
  startDesign(src, 2);
  submitDesign(src, 2, design);
  const kinds = takeNotices(src, 'terminal').map((n) => `${n.id}:${n.kind}`);
  assert.ok(kinds.includes('2:design-submitted'), `새 요청의 설계 제출 알림이 빠졌다: ${kinds.join(',')}`);
  assert.deepEqual(takeNotices(src, 'terminal'), [], '한 번 낸 알림은 다시 나오지 않는다');
});

test('받는 쪽이 둘이어도 각자 읽은 자리를 지킨다(서로 덮어쓰지 않는다)', () => {
  const { src } = tempProject();
  addRequest(src, { title: '요청', agent: '담당' });
  takeNotices(src, 'terminal'); takeNotices(src, 'watch');
  startDesign(src, 1);
  for (let i = 0; i < 20; i++) takeNotices(src, i % 2 ? 'terminal' : 'watch');
  submitDesign(src, 1, design);
  assert.ok(takeNotices(src, 'terminal').some((n) => n.kind === 'design-submitted'), 'terminal이 알림을 잃었다');
  assert.ok(takeNotices(src, 'watch').some((n) => n.kind === 'design-submitted'), 'watch가 알림을 잃었다');
});
