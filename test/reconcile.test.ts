/**
 * @why 요청 #96의 약속을 지킨다: 마지막 안전장치(reconcile)는 담당이 둘 이상 떠 있거나 메신저가 둘 이상일 때만 정리하고, 워크트리·브랜치가 있는 세션을 남기며, 멈추는 쪽에 남은 워크트리 정보를 잃지 않고, 다른 세션(메인 에이전트 등)과 정상 상태는 건드리지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planReconcile } from '../src/reconcile.js';
import type { ReconcileInput } from '../src/reconcile.js';

const base = (over: Partial<ReconcileInput>): ReconcileInput => ({ agents: [], owners: {}, worktreeOf: () => null, nameOf: (id) => `p #${id} 담당`, messenger: 'p 메신저', ...over });
const ag = (sessionId: string, name: string, startedAt: number): ReconcileInput['agents'][number] => ({ id: sessionId.slice(0, 4), sessionId, name, kind: 'background', startedAt });

test('정상(담당 1개·메신저 1개)이면 아무것도 하지 않는다', () => {
  const plan = planReconcile(base({ agents: [ag('A1', 'p #1 담당', 1), ag('M1', 'p 메신저', 1), { id: 'main', sessionId: 'MAIN', name: '메인 에이전트', kind: 'interactive' }], owners: { A1: { request: 1, seen: '', origin: true } } }));
  assert.deepEqual(plan.owners, []);
  assert.deepEqual(plan.messengerStop, []);
});

test('담당이 둘이면 워크트리가 있는 쪽을 남기고, 멈추는 쪽의 워크트리·브랜치는 남은 정보로 돌려준다', () => {
  const wt: Record<string, { path: string; branch: string }> = { B: { path: '/w/b', branch: 'wb' }, C: { path: '/w/c', branch: 'wc' } };
  const plan = planReconcile(base({
    agents: [ag('A', 'p #1 담당', 5), ag('B', 'p #1 담당', 1), ag('C', 'p #1 담당', 2)],
    owners: { A: { request: 1, seen: '', origin: true }, B: { request: 1, seen: '' } },
    worktreeOf: (sid) => wt[sid] ?? null,
  }));
  assert.equal(plan.owners.length, 1);
  assert.equal(plan.owners[0].keep, 'C', '워크트리가 있는 것 중 가장 최근에 시작한 쪽');
  assert.deepEqual(plan.owners[0].stop.map((s) => s.sessionId).sort(), ['A', 'B']);
  assert.deepEqual(plan.owners[0].leftover, [{ sessionId: 'B', path: '/w/b', branch: 'wb' }], '멈추는 B의 워크트리를 요청 기록에 남긴다');
});

test('워크트리가 없으면 원본 표시가 있는 쪽, 그것도 없으면 가장 최근에 시작한 쪽을 남긴다', () => {
  const a = planReconcile(base({ agents: [ag('A', 'p #1 담당', 9), ag('B', 'p #1 담당', 1)], owners: { B: { request: 1, seen: '', origin: true } } }));
  assert.equal(a.owners[0].keep, 'B');
  const b = planReconcile(base({ agents: [ag('A', 'p #1 담당', 9), ag('B', 'p #1 담당', 1)] , owners: { A: { request: 1, seen: '' } } }));
  assert.equal(b.owners[0].keep, 'A');
});

test('떠 있는 세션은 하나뿐이고 옛 기록만 여럿이면 건드리지 않는다', () => {
  const plan = planReconcile(base({ agents: [ag('A', 'p #1 담당', 1)], owners: { A: { request: 1, seen: '', origin: true }, GONE: { request: 1, seen: '' } } }));
  assert.deepEqual(plan.owners, []);
});

test('메신저가 둘이면 가장 먼저 시작한 하나만 남기고, 요청이 다른 담당끼리는 섞지 않는다', () => {
  const plan = planReconcile(base({
    agents: [ag('M2', 'p 메신저', 20), ag('M1', 'p 메신저', 10), ag('A', 'p #1 담당', 1), ag('B', 'p #2 담당', 1)],
    owners: { A: { request: 1, seen: '', origin: true }, B: { request: 2, seen: '', origin: true } },
  }));
  assert.deepEqual(plan.messengerStop.map((m) => m.sessionId), ['M2']);
  assert.deepEqual(plan.owners, []);
});
