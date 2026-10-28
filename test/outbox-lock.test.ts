/**
 * @why 요청 #96의 약속을 지킨다: 메신저가 둘이어도 같은 줄은 한 쪽만 가져가고(둘 다 보내 담당이 복사되는 일이 없다), 가져간 메신저가 살아 있다는 표시를 계속 하는 동안은 줄이 유지되며, 표시가 끊기면 대기로 돌아간다. 담당을 띄우는 일은 동시에 불러도 한 번만 한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beatRow, enqueueOutbox, loadOutbox, ownerUp, pendingRows, releaseStale, takeRow, TAKE_BEAT_MS } from '../src/outbox.js';
import { tryLock, unlock } from '../src/lock.js';
import { addRequest, approveDesign, submitDesign } from '../src/request.js';
import { tempProject } from './helpers.js';

process.env.SPEC_NO_KICK = '1';
const own = (root: string, sid: string, request: number): void => fs.writeFileSync(path.join(root, '.spec', 'sessions.json'), JSON.stringify({ [sid]: { request, seen: '', origin: true } }));
/** 승인된 요청 1건과 대기 줄 1건(담당 확인 끝 = 보낼 수 있음) */
function ready(): { src: string; seq: number } {
  const { root, src } = tempProject({ wake: true });
  addRequest(src, { title: 'a' }); submitDesign(src, 1, { understanding: 'u', files: [{ path: 'a.ts', why: '시험' }], none: true }); approveDesign(src, 1);
  own(root, 'S1', 1);
  const row = enqueueOutbox(src, 1)!;
  const rows = loadOutbox(src); rows[0].ready = true;
  fs.writeFileSync(path.join(src, '..', '.spec', 'outbox.json'), JSON.stringify(rows));
  return { src, seq: row.seq };
}

test('같은 줄을 두 메신저가 가져가려 하면 먼저 한 쪽만 성공한다', () => {
  const { src, seq } = ready();
  assert.equal(takeRow(src, seq, 'M1').ok, true);
  const second = takeRow(src, seq, 'M2');
  assert.equal(second.ok, false);
  assert.match(second.reason ?? '', /이미/);
  assert.deepEqual(pendingRows(src), [], '가져간 줄은 대기가 아니라서 wait에 안 보인다');
});

test('두 프로세스가 동시에 가져가도 한 쪽만 성공한다', () => {
  const { src, seq } = ready();
  const code = `import('${path.resolve('src/outbox.ts').replace(/\\/g, '/')}').then((m) => { process.exit(m.takeRow(${JSON.stringify(src)}, ${seq}, process.argv[1]).ok ? 0 : 7); })`;
  const run = (by: string) => spawnSync(process.execPath, ['--import', 'tsx', '-e', code, by], { encoding: 'utf8' });
  const results = [run('A'), run('B'), run('C')].map((r) => r.status);
  assert.equal(results.filter((s) => s === 0).length, 1, `성공은 하나뿐이어야 한다: ${results.join(',')}`);
});

test('담당 확인 전(ready: false)인 줄은 가져갈 수 없다', () => {
  const { root, src } = tempProject({ wake: true });
  addRequest(src, { title: 'a' }); submitDesign(src, 1, { understanding: 'u', files: [{ path: 'a.ts', why: '시험' }], none: true }); approveDesign(src, 1);
  own(root, 'S1', 1);
  const row = enqueueOutbox(src, 1)!;
  assert.equal(row.ready, false);
  assert.match(takeRow(src, row.seq, 'M1').reason ?? '', /확인/);
});

test('살아 있다는 표시를 하는 동안은 유지되고, 표시가 끊기면 대기로 돌아가며 다른 메신저가 가져갈 수 있다', () => {
  const { src, seq } = ready();
  takeRow(src, seq, 'M1');
  assert.equal(beatRow(src, seq, 'M2'), false, '내가 가져간 줄이 아니면 표시할 수 없다');
  assert.equal(beatRow(src, seq, 'M1'), true);
  assert.equal(releaseStale(src, Date.now() + TAKE_BEAT_MS - 1000), 0, '표시가 최근이면 유지');
  assert.equal(releaseStale(src, Date.now() + TAKE_BEAT_MS + 1000), 1, '표시가 끊기면 대기로');
  assert.equal(loadOutbox(src)[0].state, 'pending');
  unlock(src, `take-${seq}`); // 죽은 메신저의 잠금은 오래되면 풀리지만, 시험에서는 바로 푼다
  assert.equal(takeRow(src, seq, 'M2').ok, true);
});

test('잠금: 먼저 잡은 쪽만 성공하고, 오래 갱신이 없으면 풀고 가져간다', () => {
  const { src } = ready();
  assert.equal(tryLock(src, 'x', 1000), true);
  assert.equal(tryLock(src, 'x', 1000), false);
  const f = path.join(src, '..', '.spec', 'locks', 'x');
  const old = new Date(Date.now() - 5000); fs.utimesSync(f, old, old);
  assert.equal(tryLock(src, 'x', 1000), true, '5초 갱신 없음 → 죽은 것으로 보고 가져간다');
});

test('담당 띄우기는 요청당 잠금 아래 한 번만 한다(잠금이 잡혀 있으면 busy)', () => {
  const { root, src } = tempProject({ wake: true });
  addRequest(src, { title: 'a' }); submitDesign(src, 1, { understanding: 'u', files: [{ path: 'a.ts', why: '시험' }], none: true }); approveDesign(src, 1);
  own(root, 'S1', 1);
  enqueueOutbox(src, 1);
  assert.equal(tryLock(src, 'owner-1', 90_000), true, '다른 쪽이 담당을 띄우는 중');
  assert.equal(ownerUp(src, 1), 'busy');
  void os;
});
