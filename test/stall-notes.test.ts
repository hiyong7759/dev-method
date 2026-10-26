/**
 * @why 요청 #82의 약속을 지킨다: 결정을 반영하고 멈춘 담당 세션을 알아채 한 번만 다시 보내고 그래도 안 되면 '멈춘 듯함'을 보이는지, 막힘·질문을 요청 상태에 남기고 풀리는지, 설계에 건드릴 파일이 있어야 하고 승인된 파일 밖 커밋을 막는지, 비밀 파일을 명령으로 읽는 길을 훅이 막는지, 서버가 옛 코드일 때 알리는지.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { main as commitMsg } from '../src/commit-msg.js';
import { addAlsoFixed, addRequest, approveDesign, describeRequests, loadRequests, noteAsking, noteBlocked, noteImpl, requestTest, submitDesign, testProblem } from '../src/request.js';
import { deliveryOf, dueForStall, markRead, markSent, markStallSent, openDelivery, STALL_AFTER_MIN } from '../src/delivery.js';
import { staleServer } from '../src/stale.js';
import { tempProject } from './helpers.js';

const min = 60_000;
const files = [{ path: 'src/a.ts', why: '시험' }];

/** 설계 승인 → 담당이 읽고 구현 커밋을 기록한 뒤 멈춘 요청 한 건 */
function applied(): { root: string; src: string } {
  const p = tempProject();
  addRequest(p.src, { title: 'a' });
  submitDesign(p.src, 1, { understanding: 'u', files, none: true });
  approveDesign(p.src, 1);
  const req = loadRequests(p.src)[0];
  openDelivery(p.src, req); markSent(p.src, 1, 'wake'); markRead(p.src, 1);
  noteImpl(p.src, 1, '');
  return p;
}
const req = (src: string) => loadRequests(src)[0];
const lastAt = (src: string): number => Date.parse(req(src).events[req(src).events.length - 1].at);

test('결정을 반영하고 20분 넘게 다음 단계가 없으면 한 번 더 보낼 대상이고, 보낸 뒤 20분 더 지나도 그대로면 멈춘 듯함이다', () => {
  const { src } = applied();
  const t0 = lastAt(src);
  assert.deepEqual(dueForStall(src, loadRequests(src), t0 + (STALL_AFTER_MIN - 1) * min), [], '20분 전에는 아니다');
  assert.deepEqual(dueForStall(src, loadRequests(src), t0 + (STALL_AFTER_MIN + 1) * min), [1]);
  assert.equal(deliveryOf(src, req(src), t0 + (STALL_AFTER_MIN + 1) * min)!.state, 'applied', '한 번 더 보내기 전에는 멈춘 듯함으로 바꾸지 않는다');
  markStallSent(src, 1);
  assert.deepEqual(dueForStall(src, loadRequests(src), t0 + 60 * min), [], '결정마다 한 번만 보낸다');
  const sentAt = Date.now();
  assert.equal(deliveryOf(src, req(src), sentAt + 5 * min)!.state, 'applied', '보낸 직후에는 기다린다');
  const late = deliveryOf(src, req(src), sentAt + (STALL_AFTER_MIN + 1) * min)!;
  assert.equal(late.state, 'stalled');
  const view = describeRequests(loadRequests(src), () => [], (r) => deliveryOf(src, r, sentAt + (STALL_AFTER_MIN + 1) * min))[0];
  assert.match(view.stepLabel, /멈춘 듯함/);
});

test('테스트를 올렸거나 막힘·질문을 남겼으면 멈춘 것으로 보지 않는다', () => {
  const a = applied();
  noteBlocked(a.src, 1, 'npx tsc 막힘');
  assert.deepEqual(dueForStall(a.src, loadRequests(a.src), lastAt(a.src) + 30 * min), [], '막힘을 남겼으면 사용자가 아는 상태다');
  const b = applied();
  noteAsking(b.src, 1, '허용해도 되나요?');
  assert.deepEqual(dueForStall(b.src, loadRequests(b.src), lastAt(b.src) + 30 * min), [], '질문 중이면 사용자 차례다');
  const c = applied();
  requestTest(c.src, 1);
  assert.deepEqual(dueForStall(c.src, loadRequests(c.src), lastAt(c.src) + 30 * min), [], '테스트 요청은 사용자 차례다');
});

test('막힘은 다음 에이전트 기록이 생기면 풀리고, 질문은 사용자의 다음 기록이 생기면 사라진다', () => {
  const { src } = applied();
  noteBlocked(src, 1, 'npx tsc가 허용 목록 밖');
  noteAsking(src, 1, '순서를 정해 주세요');
  let v = describeRequests(loadRequests(src))[0];
  assert.equal(v.asking?.text, '순서를 정해 주세요');
  assert.equal(v.blocked, undefined, '질문이 막힘 뒤의 에이전트 기록이라 막힘은 풀렸다');
  noteBlocked(src, 1, 'bash install.sh 막힘');
  v = describeRequests(loadRequests(src))[0];
  assert.match(v.blocked!.note, /install\.sh/);
  assert.equal(v.asking?.text, '순서를 정해 주세요', '질문은 사용자 기록이 없어 그대로');
  requestTest(src, 1);
  testProblem(src, 1, '고쳐 주세요');
  v = describeRequests(loadRequests(src))[0];
  assert.equal(v.asking, undefined, '사용자 기록이 생겨 질문이 사라진다');
  assert.throws(() => noteBlocked(src, 1, ' '), /막힌 명령과 이유/);
  assert.throws(() => noteAsking(src, 1, ''), /묻는 말/);
});

test('설계는 건드릴 파일이 있어야 올라가고, 승인되면 요청에 남는다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.throws(() => submitDesign(src, 1, { understanding: 'u' }), /건드릴 파일/);
  assert.throws(() => submitDesign(src, 1, { none: true }), /건드릴 파일/, '설계 없음에도 필요하다');
  assert.throws(() => submitDesign(src, 1, { understanding: 'u', files: [{ path: ' ' }] }), /건드릴 파일/);
  submitDesign(src, 1, { understanding: 'u', files });
  assert.equal(req(src).files, undefined, '승인 전에는 승인된 파일이 아니다');
  approveDesign(src, 1);
  assert.deepEqual(req(src).files, files);
});

/** 요청 #1의 커밋 메시지로 지금 스테이징된 파일들을 검사한다 */
async function check(root: string): Promise<number | undefined> {
  const f = path.join(root, 'MSG');
  fs.writeFileSync(f, 'feat: x\n\n요청 #1');
  const err = console.error; console.error = () => {};
  try { return await commitMsg([f, root]); } finally { console.error = err; }
}
const stage = (root: string, name: string): void => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), name); execFileSync('git', ['add', name], { cwd: root }); };

test('구현 커밋은 승인된 파일 안에서만 하고, .spec·문서·also로 남긴 파일은 예외이며, 파일 목록이 없는 옛 요청은 검사하지 않는다', async () => {
  const { root, src } = applied();
  stage(root, 'src/a.ts');
  assert.equal(await check(root), 0, '적은 파일은 통과');
  stage(root, 'src/b.ts');
  assert.equal(await check(root), 1, '적지 않은 파일이 끼면 막는다');
  addAlsoFixed(src, 1, { text: '막혀서 같이 고침', where: 'src/b.ts' });
  assert.equal(await check(root), 0, 'also로 남기면 통과');
  stage(root, 'docs/x.md'); stage(root, '.spec/y.json');
  assert.equal(await check(root), 0, '문서와 .spec은 예외');
  execFileSync('git', ['reset', '-q'], { cwd: root });
  const p = tempProject();
  addRequest(p.src, { title: 'a' });
  submitDesign(p.src, 1, { understanding: 'u', files });
  const file = path.join(p.root, '.spec', 'requests', '1.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { design: { files?: unknown } };
  delete j.design.files; fs.writeFileSync(file, JSON.stringify(j));
  approveDesign(p.src, 1);
  stage(p.root, 'src/anything.ts');
  assert.equal(await check(p.root), 0, '옛 요청은 범위 검사를 하지 않는다');
});

test('비밀 파일 이름이 든 명령은 훅이 막고, 코드 글의 process.env나 보통 명령은 통과시킨다', () => {
  const hook = path.resolve('hooks', 'claude-block-secret-read.sh');
  const run = (command: string): number | null => spawnSync('bash', [hook], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: '/nonexistent' }) }).status;
  for (const c of ['cat .spec/local.json', 'node -e "fs.readFileSync(\'.spec/local.json\')"', 'cat .env', 'grep KEY ./.env.local', 'cat "$HOME/p/.env"']) assert.equal(run(c), 2, c);
  for (const c of ['npm run typecheck', 'git status', 'node /x/spec.mjs request ask --id 1 --text "process.env를 읽어도 되나요"', 'echo $ENV_NAME']) assert.equal(run(c), 0, c);
});

test('서버가 뜬 뒤 도구 소스가 바뀌면 다시 띄우는 명령과 함께 옛 코드라고 알린다', () => {
  assert.equal(staleServer('/p', Date.now() + 60_000), null, '아직 바뀌지 않았으면 알리지 않는다');
  const file = path.resolve('src', 'stale.ts');
  const old = fs.statSync(file);
  try {
    fs.utimesSync(file, new Date(Date.now() + 3600_000), new Date(Date.now() + 3600_000));
    const hit = staleServer('/p', Date.now() + 120_000);
    assert.match(hit!.command, /spec\.mjs open \/p --no-open/);
  } finally { fs.utimesSync(file, old.atime, old.mtime); }
});
