/**
 * @why 요청 #96의 약속을 지킨다: 담당 세션이 원본인지는 도구(owner-check) 하나가 가린다. 원본이 아닌 담당(복사본)은 워크트리·브랜치·커밋·요청 상태 변경이 막히고, 번호를 맞추는 중이면 원본을 복사본으로 잘못 판정하지 않으며, 담당이 아닌 세션(환경에 요청 번호 없음)은 막지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertOriginal, hookDecision, needsOriginal, verdictOf } from '../src/owner-check.js';
import { adoptOwner, loadOwners, markRebinding, rebindOwner } from '../src/session.js';
import { tempProject } from './helpers.js';

const put = (root: string, all: object): void => fs.writeFileSync(path.join(root, '.spec', 'sessions.json'), JSON.stringify(all));

test('원본 표시가 있으면 그 세션만 원본이고, 다른 세션은 복사본이다', () => {
  const { root } = tempProject({ wake: true });
  put(root, { ORIG: { request: 3, seen: '', origin: true }, X: { request: 3, seen: '' }, OTHER: { request: 4, seen: '', origin: true } });
  assert.equal(verdictOf(root, 3, 'ORIG'), 'original');
  assert.equal(verdictOf(root, 3, 'X'), 'copy', '같은 요청에 따로 등록된 세션도 원본이 아니다');
  assert.equal(verdictOf(root, 3, 'NOPE'), 'copy');
  assert.equal(verdictOf(root, 3, undefined), 'unknown');
  assert.equal(verdictOf(root, 9, 'ORIG'), 'unbound', '묶인 담당이 없는 요청은 통과');
});

test('원본 표시가 없는 옛 요청은 기록에 있는 세션을 원본으로 본다', () => {
  const { root } = tempProject({ wake: true });
  put(root, { OLD: { request: 3, seen: '' } });
  assert.equal(verdictOf(root, 3, 'OLD'), 'original');
  assert.equal(verdictOf(root, 3, 'NEW'), 'copy');
});

test('서버가 실제 번호를 맞추는 중이면 복사본이 아니라 "맞추는 중"이고, 맞춘 뒤에는 새 번호가 원본이다', () => {
  const { root } = tempProject({ wake: true });
  put(root, { PRE: { request: 3, seen: '', origin: true } });
  markRebinding(root, 'PRE', true);
  assert.equal(verdictOf(root, 3, 'REAL'), 'syncing');
  assert.equal(verdictOf(root, 3, 'REAL', Date.now() + 4 * 60_000), 'copy', '3분이 지나도 안 맞춰지면 어긋난 것이다');
  rebindOwner(root, 'PRE', 'REAL');
  assert.equal(verdictOf(root, 3, 'REAL'), 'original');
  assert.equal(loadOwners(root).REAL.rebinding, undefined);
});

test('수동 지정(adopt)은 지정한 세션만 원본으로 남기고 같은 요청의 다른 기록을 지운다', () => {
  const { root } = tempProject({ wake: true });
  put(root, { A: { request: 3, seen: '', origin: true }, B: { request: 3, seen: '' }, C: { request: 4, seen: '', origin: true } });
  assert.deepEqual(adoptOwner(root, 3, 'B').sort(), ['A']);
  assert.equal(verdictOf(root, 3, 'B'), 'original');
  assert.equal(verdictOf(root, 3, 'A'), 'copy');
  assert.ok(loadOwners(root).C, '다른 요청의 기록은 그대로');
});

test('거절 대상: 워크트리·브랜치 만들기·커밋·요청 상태 변경. 읽기·일반 명령은 아니다', () => {
  for (const c of ['git worktree add ../x', 'git checkout -b a', 'git switch -c a', 'git branch feature', 'git commit -m x', 'git -C /x commit -m y', 'node /a/spec.mjs request design --id 1', 'node /a/spec.mjs request impl --id 1', 'node /a/spec.mjs finish --id 1']) assert.ok(needsOriginal('Bash', c), c);
  for (const c of ['git status', 'git log', 'git diff', 'git branch', 'git branch -d x', 'git checkout main', 'npm run typecheck', 'node /a/spec.mjs request whoami --id 1', 'node /a/spec.mjs request shot --id 1']) assert.ok(!needsOriginal('Bash', c), c);
  assert.ok(needsOriginal('EnterWorktree', ''));
  assert.ok(!needsOriginal('Read', 'git commit'));
});

test('훅: 담당 환경이 없으면 통과, 원본이 아닌 담당은 사유와 함께 거절, 원본은 통과', () => {
  const { root, src } = tempProject({ wake: true });
  put(root, { ORIG: { request: 3, seen: '', origin: true } });
  const env = { SPEC_OWNER_REQUEST: '3', SPEC_OWNER_SCAN: src } as NodeJS.ProcessEnv;
  assert.equal(hookDecision({ session_id: 'COPY', tool_name: 'EnterWorktree' }, {}), null, '담당이 아닌 세션(메인 에이전트 등)은 막지 않는다');
  assert.match(hookDecision({ session_id: 'COPY', tool_name: 'EnterWorktree' }, env) ?? '', /복사본/);
  assert.match(hookDecision({ session_id: 'COPY', tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, env) ?? '', /복사본/);
  assert.equal(hookDecision({ session_id: 'COPY', tool_name: 'Bash', tool_input: { command: 'git status' } }, env), null);
  assert.equal(hookDecision({ session_id: 'ORIG', tool_name: 'EnterWorktree' }, env), null);
});

test('요청 명령 앞 검사: 원본이 아니면 던지고, 담당 환경이 없으면 통과', () => {
  const { root, src } = tempProject({ wake: true });
  put(root, { ORIG: { request: 3, seen: '', origin: true } });
  const env = (sid: string): NodeJS.ProcessEnv => ({ SPEC_OWNER_REQUEST: '3', SPEC_OWNER_SCAN: src, CLAUDE_CODE_SESSION_ID: sid });
  assert.throws(() => assertOriginal(src, env('COPY')), /복사본/);
  assert.doesNotThrow(() => assertOriginal(src, env('ORIG')));
  assert.doesNotThrow(() => assertOriginal(src, {}));
});
