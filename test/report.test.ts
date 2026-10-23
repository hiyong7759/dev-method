/**
 * @why 리포트 번호가 한 번 정해지면 바뀌거나 다시 쓰이지 않는지, 번호 하나로 풀어 쓴 내용이 나오는지 확인한다. 에이전트가 "리포트 #31"만 듣고 바로 답하려면 번호가 안정적이어야 한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignNumbers, addReport, loadReports, describeRow } from '../src/report.js';
import { tempProject } from './helpers.js';
import type { ReportRow } from '../src/types.js';

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
  const row: ReportRow = { id: 'review:예약.임시메모', no: 31, origin: 'review', title: '필드 “임시메모”를 어디에서도 쓰지 않습니다', detail: '코드에서도 글자로도 쓰는 곳이 없습니다', label: '', from: '현행 구조 검사', where: [], at: '', decision: null,
    review: { id: 'review:예약.임시메모', title: 't', help: 'h', tone: 'ok', where: 'models/booking.ts:42', also: [], info: '예약', prop: '임시메모', screens: ['하루 일정'], scenarios: [] } };
  const text = describeRow(row);
  assert.match(text, /리포트 #31 · 확인 필요 · 처리 전/);
  assert.match(text, /정의된 곳: models\/booking\.ts:42/);
  assert.match(text, /이 정보를 쓰는 화면: 하루 일정/);
  assert.match(text, /지워도 안전해 보임/);
});
