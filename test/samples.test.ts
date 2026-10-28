/**
 * @why 결정 전달 상태('전달 안 됨' 등)와 '함께 고친 것'은 실제로 생겨야만 화면을 볼 수 있어 모양이 깨져도 모르고 넘어간다. 견본 기록이 정상·경계·오류 모양을 항상 만들어 내는지, 구현 커밋이 HEAD 같은 이름으로 기록되지 않는지, 훅이 안 돌아도 반영 기록이 있으면 읽은 것으로 보는지, also 명령이 한 건씩만 남기는지 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeSamples } from '../src/samples.js';
import { deliveryOf, markUndelivered, openDelivery } from '../src/delivery.js';
import { addAlsoFixed, addRequest, approveDesign, describeRequests, loadRequests, noteImpl, submitDesign } from '../src/request.js';
import { tempProject } from './helpers.js';

/** 견본을 쓴 임시 .spec의 요청과 전달 상태를 읽는다 */
function samples(): { src: string; view: (id: number) => ReturnType<typeof describeRequests>[number] } {
  const { src, root } = tempProject();
  writeSamples(path.join(root, '.spec'));
  const list = loadRequests(src);
  return { src, view: (id) => describeRequests(list, () => [], (r) => deliveryOf(src, r)).find((x) => x.id === id)! };
}

test('견본 전달 기록: 정상은 전달 중, 경계는 전달 안 됨, 오류는 훅 대기로 나온다', () => {
  const { view } = samples();
  assert.equal(view(9001).delivery?.state, 'sending');
  assert.equal(view(9001).stepLabel, '결정 전달 중');
  assert.equal(view(9002).delivery?.state, 'failed');
  assert.equal(view(9002).stepLabel, '전달 안 됨');
  assert.equal(view(9003).delivery?.state, 'hook-wait');
});

test('견본은 실제 deliveries.json이 아니라 쓴 자리의 .spec에만 들어간다', () => {
  const { src, root } = tempProject();
  const other = tempProject();
  writeSamples(path.join(root, '.spec'));
  assert.equal(loadRequests(src).length, 9);
  assert.equal(loadRequests(other.src).length, 0);
  assert.equal(fs.existsSync(path.join(other.root, '.spec', 'deliveries.json')), false);
});

test('견본 함께 고친 것: 0건·1건·여러 건, 여러 건은 테스트 요청 단계에서 같은 목록이 보인다', () => {
  const { view } = samples();
  assert.equal(view(9011).alsoFixed?.length ?? 0, 0);
  assert.equal(view(9012).alsoFixed?.length, 1);
  assert.equal(view(9013).alsoFixed?.length, 3);
  assert.deepEqual([view(9013).stage, view(9013).step], ['test', 'requested']);
});

test('구현 커밋에 HEAD를 주면 실제 짧은 해시로 적고, 없는 이름은 거절한다', () => {
  const { src, root } = tempProject();
  addRequest(src, { title: 'a' });
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], understanding: 'u', screens: [] });
  approveDesign(src, 1);
  // 커밋 시각은 초 단위라, 승인보다 앞서 보이지 않게 1초 넘게 기다린 뒤 커밋한다
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  execFileSync('git', ['add', 'a.txt'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x'], { cwd: root });
  const real = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
  noteImpl(src, 1, 'HEAD');
  const r = loadRequests(src)[0];
  assert.deepEqual(r.commits, [real]);
  assert.equal(r.events.at(-1)?.note, `구현 커밋 ${real}`);
  assert.throws(() => noteImpl(src, 1, 'no-such-branch'), /찾지 못했다/);
});

test('훅 입력이 없어 읽음이 안 적혀도, 결정 뒤 에이전트가 요청 파일에 기록을 남기면 읽은 것으로 보고 전달 안 됨이 되지 않는다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], understanding: 'u', screens: [] });
  approveDesign(src, 1);
  openDelivery(src, loadRequests(src)[0]); markUndelivered(src, 1, '시험: 보내지 못함');
  const later = Date.now() + 5 * 60_000;
  assert.equal(deliveryOf(src, loadRequests(src)[0], later)?.state, 'failed', '메신저가 못 보냈다고 하면 전달 안 됨');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // 결정 '뒤'로 세지게
  noteImpl(src, 1, '');
  const v = deliveryOf(src, loadRequests(src)[0], later);
  assert.equal(v?.state, 'applied');
  assert.ok(v?.read, '읽음 칸이 반영 시각으로 채워진다');
});

test('also 명령: 한 번에 한 건씩 남기고, 빈 글·없는 요청·구현 전 단계는 거절한다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.throws(() => addAlsoFixed(src, 1, { text: '막혀서 고침' }), /단계가 아니다/, '구현 전에는 거절');
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], understanding: 'u', screens: [] });
  approveDesign(src, 1);
  assert.throws(() => addAlsoFixed(src, 1, { text: '   ' }), /비었다/);
  assert.throws(() => addAlsoFixed(src, 99, { text: 'x' }), /찾지 못했다/);
  addAlsoFixed(src, 1, { text: '첫 번째 ', where: '리포트 화면', commit: 'abc1234' });
  addAlsoFixed(src, 1, { text: '두 번째' });
  const a = loadRequests(src)[0].alsoFixed!;
  assert.equal(a.length, 2);
  assert.deepEqual([a[0].text, a[0].where, a[0].commit], ['첫 번째', '리포트 화면', 'abc1234']);
  assert.equal(a[1].where, '');
  assert.equal(loadRequests(src)[0].events.filter((e) => e.kind === 'also-fixed').length, 2);
});
