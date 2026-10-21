/**
 * @why 사용자 결정이 담당 세션에게 한 번만, 담당 세션에게만 전달되는지 지킨다. 훅은 실제로 별도 프로세스로 돌기 때문에 그대로 프로세스를 띄워 시험한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { addRequest, submitDesign, approveDesign, rejectDesign } from '../src/request.js';
import { tempProject } from './helpers.js';

const ENTRY = path.resolve('skills/spec-view/spec.mjs');
/** 훅 JSON을 표준입력으로 넘겨 inbox를 돌리고 { 종료 코드, 출력 }을 돌려준다 */
function hook(root: string, input: Record<string, unknown>): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [ENTRY, 'inbox'], { input: JSON.stringify({ cwd: root, ...input }), encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
}
const bind = (root: string, sid: string, id: number) => hook(root, { session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: `node spec.mjs request agent --id ${id} --name x` }, tool_response: '' });
const prompt = (root: string, sid: string) => hook(root, { session_id: sid, hook_event_name: 'UserPromptSubmit' });
/** 기록 시각이 같은 초에 겹치지 않게 잠깐 기다린다 */
const tick = (): Promise<void> => new Promise((ok) => setTimeout(ok, 15));

test('담당으로 정해진 세션만 새 결정을 한 번 받는다', async () => {
  const { root, src } = tempProject();
  addRequest(src, { title: '첫 요청' }); submitDesign(src, 1, { none: true });
  assert.equal(bind(root, 'S1', 1).out, '');
  assert.equal(prompt(root, 'S1').out, '', '아직 새 결정이 없다');
  await tick(); approveDesign(src, 1);
  const got = prompt(root, 'S1');
  assert.equal(got.code, 0);
  assert.match(got.out, /설계 없음 승인/);
  assert.match(got.out, /구현을 시작하세요/);
  assert.equal(prompt(root, 'S1').out, '', '같은 결정은 두 번 알리지 않는다');
  assert.equal(prompt(root, 'OTHER').out, '', '담당이 아닌 세션은 받지 않는다');
});

test('반려는 이유와 함께 다시 올리라고 알린다', async () => {
  const { root, src } = tempProject();
  addRequest(src, { title: 'a' }); submitDesign(src, 1, { none: true });
  bind(root, 'S1', 1);
  await tick(); rejectDesign(src, 1, '범위가 다르다');
  assert.match(prompt(root, 'S1').out, /범위가 다르다.*request design --id 1/s);
});

test('설계서 보기를 쓰지 않는 폴더와 깨진 입력에서는 조용히 0으로 끝난다', () => {
  const r = spawnSync(process.execPath, [ENTRY, 'inbox'], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
  const { root } = tempProject(); fs.rmSync(path.join(root, '.spec', 'config.json'));
  assert.deepEqual(prompt(root, 'S1'), { code: 0, out: '' });
});
