/**
 * @why 담당 사건 알림(같은 사건을 두 번 알리지 않는다)과 터미널 명령·겹침 경고·합치기 거부가 고치다가 깨지지 않게 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addRequest, startDesign, submitDesign, approveDesign, noteAsking, loadRequests } from '../src/request.js';
import { takeNotices } from '../src/notify.js';
import { attachCommand, openScript } from '../src/terminal.js';
import { overlapsOf, landRequest } from '../src/land.js';
import { tempProject } from './helpers.js';

const design = (f: string) => ({ understanding: '이해', approach: '방법', files: [{ path: f, why: '시험' }] });

test('attach 명령은 이름이 아니라 짧은 세션 번호를 쓰고, 창 열기 글은 있으면 앞으로 보이고 없으면 만든다', () => {
  assert.equal(attachCommand('201b45a4'), 'claude attach 201b45a4');
  assert.match(openScript('claude attach x'), /create window with default profile command "claude attach x"/);
  assert.match(openScript('claude attach x', 7), /windows whose id is 7/);
});

test('새 사건은 받는 쪽마다 한 번만 알리고, 처음 보는 요청의 옛 기록은 알리지 않는다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '알림' });
  startDesign(src, 1);
  assert.deepEqual(takeNotices(src, 'watch'), []);
  submitDesign(src, 1, design('a.ts'));
  noteAsking(src, 1, '이대로 할까요?');
  const w = takeNotices(src, 'watch');
  assert.deepEqual(w.map((n) => n.kind), ['design-submitted', 'asking']);
  assert.deepEqual(takeNotices(src, 'watch'), []);
  assert.equal(takeNotices(src, 'terminal').length, 0);
});

test('같은 파일을 건드리는 진행 중 요청만 겹침으로 잡는다', () => {
  const { src } = tempProject();
  for (const f of ['a.ts', 'a.ts', 'b.ts']) { const r = addRequest(src, { title: f }); startDesign(src, r.id); submitDesign(src, r.id, design(f)); }
  const all = loadRequests(src);
  assert.deepEqual(overlapsOf(all, all[0]), [{ id: 2, files: ['a.ts'] }]);
  assert.deepEqual(overlapsOf(all, all[2]), []);
});

test('테스트 승인 전 요청은 main에 합칠 수 없다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '합치기' }); startDesign(src, 1); submitDesign(src, 1, design('a.ts')); approveDesign(src, 1);
  assert.throws(() => landRequest(src, 1), /테스트를 승인한 요청이 아니라/);
});
