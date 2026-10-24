/**
 * @why 리포트 번호가 한 번 정해지면 바뀌거나 다시 쓰이지 않는지, 번호 하나로 풀어 쓴 내용이 나오는지 확인한다. 에이전트가 "리포트 #31"만 듣고 바로 답하려면 번호가 안정적이어야 한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assignNumbers, addReport, addNote, loadReports, describeRow, reportRows, isToolLimit, openCount } from '../src/report.js';
import { specDir } from '../src/project.js';
import { tempProject } from './helpers.js';
import type { ReportNote, ReportRow } from '../src/types.js';

test('번호는 처음 본 순서로 정해지고 다시 불러도 같으며 사라진 항목의 번호는 다시 쓰지 않는다', () => {
  const { src } = tempProject();
  assert.deepEqual(assignNumbers(src, ['review:A', 'review:B']), { 'review:A': 1, 'review:B': 2 });
  // 같은 열쇠는 그대로, 새 열쇠만 다음 번호
  assert.deepEqual(assignNumbers(src, ['review:B', 'review:C']), { 'review:A': 1, 'review:B': 2, 'review:C': 3 });
  // A가 해소돼 열쇠 목록에서 빠져도 번호 1은 비워 둔 채, 다음 새 열쇠는 4
  assert.equal(assignNumbers(src, ['review:C', 'review:D'])['review:D'], 4);
});

test('에이전트 발견도 같은 번호 줄에 들어간다', () => {
  const { src } = tempProject();
  assignNumbers(src, ['review:A']);
  const r = addReport(src, { title: '로그인 검증이 빠져 있음' });
  assert.equal(loadReports(src).numbers[r.id], 2);
});

test('번호 하나로 풀어 쓴 글에 근거와 소스 위치가 들어간다', () => {
  const row: ReportRow = { id: 'review:예약.임시메모', no: 31, origin: 'review', title: '필드 “임시메모”를 어디에서도 쓰지 않습니다', detail: '코드에서도 글자로도 쓰는 곳이 없습니다', label: '', from: '현행 구조 검사', where: [], at: '', decision: null, tool: false, notes: [], stage: '처리 전', recommend: { pick: 'registered', why: '쓰는 곳이 없음' },
    review: { id: 'review:예약.임시메모', title: 't', help: 'h', tone: 'ok', where: 'models/booking.ts:42', also: [], info: '예약', prop: '임시메모', screens: ['하루 일정'], scenarios: [] } };
  const text = describeRow(row);
  assert.match(text, /리포트 #31 · 확인 필요 · 처리 전/);
  assert.match(text, /정의된 곳: models\/booking\.ts:42/);
  assert.match(text, /이 정보를 쓰는 화면: 하루 일정/);
  assert.match(text, /지워도 안전해 보임/);
});

test('예전 결정 의도한 것·무시는 그냥 둠으로 읽힌다', () => {
  const { src } = tempProject();
  const f = path.join(specDir(src), 'reports.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ items: [], decisions: { a: { state: 'intended', reason: '쓸 예정', at: 't' }, b: { state: 'ignored', at: 't' }, c: { state: 'registered', request: 3, at: 't' } } }));
  const d = loadReports(src).decisions;
  assert.deepEqual([d.a.state, d.b.state, d.c.state], ['kept', 'kept', 'registered']);
});

test('더 분석: 사용자 의견이면 확인 중, 에이전트 조사가 붙으면 결정 대기, 결정하면 처리함', () => {
  const rv = { id: 'review:A.b', title: 't', help: 'h', tone: 'ok' as const, where: 'a.ts:1', also: [], info: 'A', prop: 'b', screens: [], scenarios: [] };
  const rows = (notes: ReportNote[], decisions = {}): ReportRow => reportRows([], [rv], decisions, { 'review:A.b': notes }, { 'review:A.b': 1 }, new Set(), new Set(['A']))[0];
  assert.equal(rows([]).stage, '처리 전');
  assert.equal(rows([{ by: 'user', text: '다음 달에 쓸 예정', at: 't' }]).stage, '확인 중');
  const waiting = rows([{ by: 'user', text: '', at: 't' }, { by: 'agent', text: '쿠폰 화면이 다음 달 쓴다', recommend: 'kept', at: 't' }]);
  assert.equal(waiting.stage, '결정 대기');
  assert.deepEqual(waiting.recommend, { pick: 'kept', why: '쿠폰 화면이 다음 달 쓴다' });
  assert.equal(rows([], { 'review:A.b': { state: 'kept', at: 't' } }).stage, '처리함');
});

test('도구가 못 읽는 모양(같은 이름이 다른 곳에 나오는 필드)은 도구 몫이고 결정할 건수에서 빠진다', () => {
  const base = { id: 'x', title: 't', help: 'h', where: 'a.ts:1', also: ['b.ts:2'], info: 'A', prop: 'p', screens: [], scenarios: [] };
  assert.equal(isToolLimit({ ...base, tone: 'warn' }), true);
  assert.equal(isToolLimit({ ...base, tone: 'ok' }), false);
  assert.equal(isToolLimit({ ...base, tone: 'warn', prop: '' }), false);
  const row = reportRows([], [{ ...base, tone: 'warn' }], {}, {}, { x: 1 }, new Set(), new Set())[0];
  assert.equal(row.tool, true);
  assert.equal(openCount([row]), 0);
});

test('에이전트가 올린 추천과 사용자 의견이 저장된다', () => {
  const { src } = tempProject();
  const r = addReport(src, { title: '알림이 두 번 간다', recommend: 'analyze', why: '두 곳에서 보내는 것으로 보임' });
  assert.equal(loadReports(src).items[0].recommend, 'analyze');
  addNote(src, r.id, { by: 'user', text: '일부러 그런 걸 수도 있어' });
  assert.equal(loadReports(src).notes[r.id].length, 1);
});
