/**
 * @why 요청 #87의 약속을 지킨다: 서버는 어떤 경우에도 claude를 실행하지 않고(헤드리스 없음) 보낼 글만 .spec/outbox.json에 적으며, 설정 wake가 꺼져 있으면 적지 않고, 같은 요청의 대기 줄은 새 줄이 대신하며, 담당이 없으면 새 세션 번호를 정해 메신저가 `claude --bg --session-id`로 만들게 하고, 대화가 있는 담당은 `claude --bg --resume`으로 이어 띄우게 하며, 못 보내면 이유와 함께 '전달 안 됨'이 되고 다시 보내기로 대기로 돌아가는지 지킨다. 진짜 claude 대신 부른 인자를 기록하는 가짜 claude를 PATH 앞에 둬서, 서버가 부르면 시험이 실패하게 한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRequest } from '../src/wake.js';
import { doneRow, enqueueOutbox, failRow, loadOutbox, pendingRows, requeueOutbox, showRow } from '../src/outbox.js';
import { activityOf, transcriptOf } from '../src/session.js';
import { deliveryOf } from '../src/delivery.js';
import { addRequest, approveDesign, approveTest, loadRequests, requestTest, setAgent, submitDesign } from '../src/request.js';
import { tempProject } from './helpers.js';

/** 서버가 claude를 부르면 기록이 남는 가짜 claude와 가짜 홈을 환경에 건다. 돌려주는 restore가 원래대로 되돌린다 */
function fakeEnv(): { calls: string; home: string; restore: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-outbox-'));
  const bin = path.join(base, 'bin'); fs.mkdirSync(bin);
  const calls = path.join(base, 'calls.txt');
  // `claude agents --json`은 읽기만 하는 조회라 기록하지 않고 열린 세션 S1(이름 열린창)을 돌려준다
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nif [ "$1" = "agents" ]; then echo '[{"sessionId":"S1","name":"열린창"}]'; exit 0; fi\necho "$*" >> "${calls}"\n`, { mode: 0o755 });
  const old = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = `${bin}:${old.PATH}`; process.env.HOME = base;
  return { calls, home: base, restore: () => { process.env.PATH = old.PATH; process.env.HOME = old.HOME; } };
}
const own = (root: string, sid: string, request: number): void => fs.writeFileSync(path.join(root, '.spec', 'sessions.json'), JSON.stringify({ [sid]: { request, seen: '' } }));
const files = [{ path: 'a.ts', why: '시험' }];
/** 설계를 올리고 승인한 요청 한 건 */
function approved(src: string): void { addRequest(src, { title: 'a' }); submitDesign(src, 1, { understanding: 'u', files, none: true }); approveDesign(src, 1); }

test('설정에서 wake를 켜지 않으면 상자에 적지 않는다(전달 기록만 연다)', () => {
  const { src } = tempProject(); approved(src);
  assert.equal(enqueueOutbox(src, 1), null);
  assert.deepEqual(loadOutbox(src), []);
  assert.equal(deliveryOf(src, loadRequests(src)[0])?.state, 'hook-wait');
});

test('담당이 없으면 새 세션 번호를 담당으로 적고 시작 글을 상자에 적되, claude는 실행하지 않는다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '새 세션 요청' });
    const { row } = startRequest(src, 1);
    assert.ok(row, '줄이 적힌다');
    assert.equal(row.kind, 'start');
    const sessions = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'sessions.json'), 'utf8')) as Record<string, { request: number }>;
    assert.equal(sessions[row.session].request, 1, '정한 번호를 담당으로 바로 적는다');
    const text = fs.readFileSync(showRow(src, row.seq).textFile, 'utf8');
    assert.match(text, /request agent --id 1/);
    assert.match(text, /request ack --id 1/, '받으면 ack로 응답하라고 적는다');
    const req = loadRequests(src)[0];
    assert.ok(req.events.some((e) => e.kind === 'session-started'), '진행 기록에 담당 세션 번호를 정했다고 남긴다');
    assert.equal(fs.existsSync(env.calls), false, '서버가 claude를 실행하지 않는다');
  } finally { env.restore(); }
});

test('담당이 이미 있으면 그 세션 앞으로 결정 글을 적고, 같은 요청의 대기 줄은 새 줄이 대신한다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); approved(src); own(root, 'S1', 1); setAgent(src, 1, '담당이름');
    const a = enqueueOutbox(src, 1)!;
    assert.equal(a.session, 'S1');
    assert.equal(showRow(src, a.seq).sendTo, '열린창', '열린 창에는 세션 번호로 찾은 지금 이름으로 보낸다(담당 이름이 아니다)');
    assert.match(fs.readFileSync(showRow(src, a.seq).textFile, 'utf8'), /사용자가 결정했습니다/);
    const b = enqueueOutbox(src, 1)!;
    assert.deepEqual(pendingRows(src).map((r) => r.seq), [b.seq], '대기 줄은 하나만 남는다');
    assert.equal(fs.existsSync(env.calls), false);
  } finally { env.restore(); }
});

test('이미 담당을 등록해 일하는 중이면 시작 글은 적지 않고, 끝난 요청의 결정도 적지 않는다', () => {
  const { root, src } = tempProject({ wake: true });
  addRequest(src, { title: 'a' }); own(root, 'S1', 1); setAgent(src, 1, '담당');
  assert.equal(enqueueOutbox(src, 1, 'start'), null);
  submitDesign(src, 1, { understanding: 'u', files, none: true }); approveDesign(src, 1);
  requestTest(src, 1); approveTest(src, 1, true);
  assert.equal(enqueueOutbox(src, 1), null);
});

test('보낼 길을 알려 준다: 대화가 없으면 claude --bg --session-id, 있으면 --resume. 허용·금지 도구와 비밀 읽기 차단 훅을 건다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); approved(src); own(root, 'S1', 1); setAgent(src, 1, '담당이름');
    const row = enqueueOutbox(src, 1)!;
    const fresh = showRow(src, row.seq);
    assert.equal(fresh.conversationExists, false);
    own(root, 'S9', 1); // 열려 있지 않은 세션은 보낼 이름이 없다(곧바로 claude --bg)
    assert.equal(showRow(src, enqueueOutbox(src, 1)!.seq).sendTo, null);
    own(root, 'S1', 1);
    const row2 = enqueueOutbox(src, 1)!;
    assert.match(fresh.bgCommand, /^claude --bg --session-id S1 --name /);
    assert.equal(fresh.bgVia, 'bg-new');
    fs.mkdirSync(path.dirname(transcriptOf(root, 'S1')), { recursive: true });
    fs.writeFileSync(transcriptOf(root, 'S1'), '');
    const resumed = showRow(src, row2.seq);
    assert.match(resumed.bgCommand, /^claude --bg --resume S1 /);
    assert.equal(resumed.bgVia, 'bg-resume');
    for (const want of ['--allowedTools', '--disallowedTools', '--settings', 'claude-block-secret-read.sh', '--model']) assert.ok(resumed.bgCommand.includes(want), want);
    assert.equal(fs.existsSync(env.calls), false);
  } finally { env.restore(); }
});

test('메신저가 보냈다고 알리면 보냄이 적히고, 못 보냈다고 이유를 남기면 전달 안 됨이며, 다시 보내기로 대기로 돌아간다', () => {
  const { root, src } = tempProject({ wake: true }); approved(src); own(root, 'S1', 1);
  const row = enqueueOutbox(src, 1)!;
  failRow(src, row.seq, 'claude --bg --resume이 거부됨');
  let v = deliveryOf(src, loadRequests(src)[0])!;
  assert.equal(v.state, 'failed');
  assert.equal(v.reason, 'claude --bg --resume이 거부됨');
  const again = requeueOutbox(src, 1)!;
  assert.equal(again.seq, row.seq, '같은 줄이 대기로 돌아간다');
  assert.equal(again.state, 'pending');
  assert.equal(deliveryOf(src, loadRequests(src)[0])!.state, 'hook-wait');
  doneRow(src, row.seq, 'send');
  v = deliveryOf(src, loadRequests(src)[0])!;
  assert.equal(v.state, 'sending', '보냈지만 받은 세션이 ack하기 전에는 읽음이 아니다');
  assert.equal(v.via, 'send');
  assert.equal(v.read, null);
  assert.throws(() => doneRow(src, 999, 'send'), /줄 999/);
  void root;
});

test('서버 소스 어디에도 claude를 실행해 글을 보내는 길(헤드리스 출력 형식·-p·spawn claude)이 없다', () => {
  const dir = path.resolve('src');
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  for (const f of all) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/claude -p /.test(text), `${f}에 claude -p 실행이 있다`);
    // 열린 세션 이름을 찾는 읽기 전용 조회(claude agents)만 예외다
    assert.ok(!/spawn(Sync)?\(\s*'claude',\s*\[\s*'(?!agents')/.test(text), `${f}가 claude를 실행한다`);
    assert.ok(!/execFile(Sync)?\(\s*'claude'/.test(text), `${f}가 claude를 실행한다`);
  }
});

test('요청 상세용 활동: 세션 기록이 최근에 바뀌었으면 일하는 중이고, 아니면 쉬는 중이다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); own(root, 'S1', 1);
    assert.equal(activityOf(root, 1), null, '대화가 없으면 활동을 모른다');
    fs.mkdirSync(path.dirname(transcriptOf(root, 'S1')), { recursive: true });
    fs.writeFileSync(transcriptOf(root, 'S1'), '');
    assert.equal(activityOf(root, 1)?.working, true);
    assert.equal(activityOf(root, 1, Date.now() + 10 * 60_000)?.working, false);
    void src;
  } finally { env.restore(); }
});
