/**
 * @why 요청 #102의 약속: "새 내용이 있습니다" 알약이 담당이 일하는 동안 계속 뜨지 않고, 눌러도 보던 자리를 지키고, 화면을 옮기면 사라지고, 떠 있어도 맨 위 숫자는 갱신되고, 결정 뒤 두 번 그리지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { changeKey } from '../src/viewer/change-key.js';
import type { Model } from '../src/types.js';

const model = (over: Record<string, unknown> = {}): Model => ({
  generatedAt: 'a', comments: [], reports: [],
  requests: [{ id: 1, title: '요청', stage: 'impl', activity: { working: true, lastActiveAt: 'a' }, cost: { usd: 1 }, worktree: { dirty: 1 }, ...over }],
}) as unknown as Model;

test('담당이 일하는 동안 계속 변하는 값(활동·비용·작업 폴더 상태)만 달라지면 바뀜으로 보지 않는다', () => {
  const base = changeKey(model());
  assert.equal(changeKey(model({ activity: { working: false, lastActiveAt: 'b' } })), base);
  assert.equal(changeKey(model({ cost: { usd: 9 } })), base);
  assert.equal(changeKey(model({ worktree: { dirty: 7 } })), base);
  assert.equal(changeKey({ ...model(), generatedAt: 'z' } as Model), base);
});

test('요청의 내용이 달라지면 바뀜으로 본다', () => {
  assert.notEqual(changeKey(model({ stage: 'test' })), changeKey(model()));
});

test('화면 틀의 알약 동작: 눌러도 자리 지킴·옮기면 사라짐·맨 위 숫자 갱신·결정 뒤 한 번만 그림', () => {
  const app = fs.readFileSync('src/viewer/app.ts', 'utf8');
  assert.match(app, /snapshot\(root\);\s*pill\.remove\(\); render\(\); restore\(root, snap\)/, '알약을 눌러 그릴 때 보던 자리를 지켜야 한다');
  assert.match(app, /function render\(\)[\s\S]*?getElementById\('fresh-pill'\)\?\.remove\(\)/, '화면을 다시 그리거나 옮기면 알약이 사라져야 한다');
  assert.match(app, /topEl\?\.replaceWith\(topEl = topbar\(m, r\)\); showFresh\(\)/, '알약이 떠 있어도 맨 위 숫자는 갱신해야 한다');
  assert.doesNotMatch(app, /load\(true\)\.then\(\(\) => render\(\)\)/, '결정 뒤 load가 그린 다음 또 그리면 두 번 그려진다');
  assert.doesNotMatch(app, /setInterval/, '2.5초 반복 없이 서버 알림만 받는다');
});
