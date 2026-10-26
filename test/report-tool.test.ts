/**
 * @why 리포트에서 추천을 못 채운 건이 사용자 앞에 '추천 없음'으로 올라오지 않는지, '도구 개선으로 전달'이 개선 요청을 한 번만 실제로 만들고 번호를 남기는지 지킨다. 두 가지가 깨지면 사용자는 결정할 수 없는 건을 떠안거나, 눌렀는데 아무 일도 없는 단추를 믿게 된다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { reportRows, openCount, sendToTool, describeRow } from '../src/report.js';
import { loadRequests } from '../src/request.js';
import { tempProject } from './helpers.js';
import type { AgentReport, ReportNote } from '../src/types.js';

const agent = (over: Partial<AgentReport> = {}): AgentReport => ({ id: 'agent:1', title: '알림이 두 번 간다', detail: '', label: '', from: '주기 점검', where: [], at: 't', outOfScope: false, ...over });
const rowsOf = (items: AgentReport[], notes: Record<string, ReportNote[]> = {}, decisions = {}) => reportRows(items, [], decisions, notes, { 'agent:1': 1, 'agent:2': 2 }, new Set(), new Set());

test('추천을 못 채운 에이전트 발견은 정리 중이라 결정할 건수에서 빠진다', () => {
  const [row] = rowsOf([agent()]);
  assert.equal(row.pending, true);
  assert.equal(openCount([row]), 0);
  assert.match(describeRow(row), /정리 중/);
});

test('도구가 못 읽는 모양은 추천이 처음부터 비어 있어도 정리 중에 넣지 않는다(도구 몫)', () => {
  const review = { id: 'review:x', title: '손으로 다시 정의한 필드', help: '', info: 'LoginSetting', screens: [], where: 'a.ts', also: ['b.ts'], scenarios: [], tone: 'warn', prop: 'password' } as never;
  const [row] = reportRows([], [review], {}, {}, { 'review:x': 1 }, new Set(), new Set());
  assert.equal(row.tool, true);
  assert.equal(row.recommend.pick, null);
  assert.equal(row.pending, false);
});

test('추천을 채우면 결정 대기로 올라온다', () => {
  const [byFirst] = rowsOf([agent({ recommend: 'kept', why: '일부러 그렇다' })]);
  assert.equal(byFirst.pending, false);
  assert.equal(openCount([byFirst]), 1);
  // 처음엔 비었다가 에이전트가 조사 결과로 추천을 단 경우
  const [byNote] = rowsOf([agent()], { 'agent:1': [{ by: 'agent', text: '두 곳에서 보냄', recommend: 'registered', at: 't' }] });
  assert.equal(byNote.pending, false);
  assert.equal(byNote.stage, '결정 대기');
});

test('사용자가 의견을 달아 맡긴 건은 추천이 비어도 정리 중이 아니라 확인 중이다', () => {
  const [row] = rowsOf([agent()], { 'agent:1': [{ by: 'user', text: '더 봐 줘', at: 't' }] });
  assert.equal(row.stage, '확인 중');
  assert.equal(row.pending, false);
});

test('이미 결정한 건은 추천이 비어도 정리 중이 아니다', () => {
  const [row] = rowsOf([agent()], {}, { 'agent:1': { state: 'kept', at: 't' } });
  assert.equal(row.pending, false);
});

test('도구 개선으로 전달하면 dev-method 쪽에 시작 전 요청이 만들어지고 번호가 카드에 남는다', () => {
  const proj = tempProject();
  const tool = tempProject();
  const base = { title: 't', help: 'h', tone: 'warn' as const, also: ['b.ts:2'], info: 'A', screens: [], scenarios: [] };
  const rows = reportRows([], [{ ...base, id: 'review:A.p', where: 'a.ts:1', prop: 'p' }, { ...base, id: 'review:A.q', where: 'a.ts:9', prop: 'q' }], {}, {}, { 'review:A.p': 1, 'review:A.q': 2 }, new Set(), new Set(['A']));
  const out = sendToTool(proj.src, rows, tool.src);
  const made = loadRequests(tool.src);
  assert.equal(made.length, 1);
  assert.equal(made[0].stage, 'design');
  assert.equal(made[0].step, 'queued');
  assert.ok(made[0].origin.text.includes(`[${path.basename(proj.root)}:review:A.p]`) && made[0].origin.text.includes('a.ts:9'));
  assert.deepEqual(out, { 'review:A.p': made[0].id, 'review:A.q': made[0].id });
  // 결정에 번호가 남으면 카드가 그 번호를 보인다
  const [card] = reportRows([], [{ ...base, id: 'review:A.p', where: 'a.ts:1', prop: 'p' }], { 'review:A.p': { state: 'tool', request: made[0].id, at: 't' } }, {}, { 'review:A.p': 1 }, new Set(), new Set(['A']));
  assert.equal(card.toolRequest, made[0].id);
});

test('같은 건을 다시 전달하면 새 요청을 만들지 않고 기존 번호를 돌려준다', () => {
  const proj = tempProject();
  const tool = tempProject();
  const base = { title: 't', help: 'h', tone: 'warn' as const, also: [], info: 'A', screens: [], scenarios: [] };
  const mk = (key: string) => reportRows([], [{ ...base, id: key, where: 'a.ts:1', prop: 'p' }], {}, {}, { [key]: 1 }, new Set(), new Set(['A']))[0];
  const first = sendToTool(proj.src, [mk('review:A.p')], tool.src);
  const again = sendToTool(proj.src, [mk('review:A.p')], tool.src);
  assert.equal(loadRequests(tool.src).length, 1);
  assert.equal(again['review:A.p'], first['review:A.p']);
  // 새 건이 섞이면 새 건만 새 요청이 된다
  const mixed = sendToTool(proj.src, [mk('review:A.p'), mk('review:A.z')], tool.src);
  assert.equal(loadRequests(tool.src).length, 2);
  assert.equal(mixed['review:A.p'], first['review:A.p']);
  assert.notEqual(mixed['review:A.z'], first['review:A.p']);
});
