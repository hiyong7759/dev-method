/**
 * @why 요청 #87의 약속을 지킨다: 서버는 어떤 경우에도 claude를 실행하지 않고(헤드리스 없음) 보낼 글만 .spec/outbox.json에 적으며, 설정 wake가 꺼져 있으면 적지 않고, 같은 요청의 대기 줄은 새 줄이 대신하며, 담당이 없으면 새 세션 번호를 정해 메신저가 `claude --bg --session-id`로 만들게 하고, 대화가 있는 담당은 `claude --bg --resume`으로 이어 띄우게 하며, 못 보내면 이유와 함께 '전달 안 됨'이 되고 다시 보내기로 대기로 돌아가는지 지킨다. 진짜 claude 대신 부른 인자를 기록하는 가짜 claude를 PATH 앞에 둬서, 서버가 부르면 시험이 실패하게 한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRequest } from '../src/wake.js';
import { doneRow, enqueueOutbox, ensureMessenger, failRow, launchRow, loadOutbox, messengerName, pendingRows, requeueOutbox, showRow } from '../src/outbox.js';
import { activityOf, ownerName, ownersOf, transcriptOf } from '../src/session.js';
import { deliveryOf } from '../src/delivery.js';
import { addRequest, approveDesign, approveTest, loadRequests, requestTest, setAgent, submitDesign } from '../src/request.js';
import { tempProject } from './helpers.js';

/** 서버가 claude를 부르면 기록이 남는 가짜 claude와 가짜 홈을 환경에 건다. 돌려주는 restore가 원래대로 되돌린다 */
function fakeEnv(): { calls: string; home: string; agents: string; restore: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-outbox-'));
  const bin = path.join(base, 'bin'); fs.mkdirSync(bin);
  const calls = path.join(base, 'calls.txt');
  // `claude agents --json`은 읽기만 하는 조회라 기록하지 않고 agents.json의 내용(처음엔 열린 세션 S1, 이름 열린창)을 돌려준다.
  // `claude --bg …`는 기록하고 진짜처럼 'backgrounded · 짧은번호 · 이름'을 찍는다(진짜 claude는 미리 정한 세션 번호를 쓰지 않고 자기 번호를 붙인다)
  const agents = path.join(base, 'agents.json');
  fs.writeFileSync(agents, '[{"sessionId":"S1","name":"열린창"}]');
  // late 파일에 숫자가 있으면 그 횟수만큼 agents가 빈 목록을 돌려준다(방금 만든 세션이 목록에 늦게 나타나는 경우)
  const late = path.join(base, 'late.txt');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nif [ "$1" = "agents" ]; then if [ -s "${late}" ] && [ "$(cat "${late}")" -gt 0 ]; then echo $(( $(cat "${late}") - 1 )) > "${late}"; echo '[]'; else cat "${agents}"; fi; exit 0; fi\necho "$*" >> "${calls}"\nif [ "$1" = "--bg" ]; then echo "backgrounded · abcd1234 · 이름"; fi\n`, { mode: 0o755 });
  const old = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = `${bin}:${old.PATH}`; process.env.HOME = base;
  return { calls, home: base, agents, restore: () => { process.env.PATH = old.PATH; process.env.HOME = old.HOME; } };
}
const waitFor = async (f: () => boolean): Promise<void> => { for (let i = 0; i < 100 && !f(); i++) await new Promise((ok) => setTimeout(ok, 50)); };
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

test('claude --bg가 붙인 실제 세션 번호로 담당 기록과 줄을 바꾼다(같은 요청에 담당이 둘로 남지 않는다)', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); approved(src); own(root, 'PRE', 1); setAgent(src, 1, '담당이름');
    fs.writeFileSync(env.agents, '[{"id":"abcd1234","sessionId":"abcd1234-real","name":"담당","kind":"background"}]');
    const row = enqueueOutbox(src, 1)!;
    assert.equal(row.session, 'PRE');
    fs.writeFileSync(path.join(env.home, 'late.txt'), '3'); // 만든 세션이 목록에 몇 번 늦게 나타나도 실제 번호를 찾는다
    const done = launchRow(src, row.seq);
    assert.equal(done.state, 'sent');
    assert.equal(done.via, 'bg-new', '대화가 없어 새로 만들었다');
    assert.match(fs.readFileSync(env.calls, 'utf8'), /--bg --session-id PRE /);
    assert.deepEqual(ownersOf(root, 1), ['abcd1234-real'], '미리 정한 번호는 지워지고 실제 번호만 담당이다');
    assert.equal(loadOutbox(src).find((r) => r.seq === row.seq)!.session, 'abcd1234-real');
    // 실제 번호의 대화가 있으면 다음에는 새로 만들지 않고 그 번호로 이어 띄운다
    fs.mkdirSync(path.dirname(transcriptOf(root, 'abcd1234-real')), { recursive: true });
    fs.writeFileSync(transcriptOf(root, 'abcd1234-real'), '');
    const again = enqueueOutbox(src, 1)!;
    assert.equal(again.session, 'abcd1234-real');
    assert.equal(launchRow(src, again.seq).via, 'bg-resume');
    assert.match(fs.readFileSync(env.calls, 'utf8'), /--bg --resume abcd1234-real /);
    assert.deepEqual(ownersOf(root, 1), ['abcd1234-real'], '이어 띄워도 담당이 늘지 않는다');
    assert.match(fs.readFileSync(env.calls, 'utf8').split(/^(?=--bg )/m).at(-1)!, /--allowedTools/, '저장된 옵션이 없는 세션에는 옵션을 건다');
    // 백그라운드로 만든 세션(jobs 기록 있음)에 옵션을 붙여 --resume하면 복사본이 생기므로 옵션 없이 부른다
    fs.mkdirSync(path.join(env.home, '.claude', 'jobs', 'abcd1234'), { recursive: true });
    const third = enqueueOutbox(src, 1)!;
    launchRow(src, third.seq);
    const last = fs.readFileSync(env.calls, 'utf8').split(/^(?=--bg )/m).at(-1)!;
    assert.match(last, /^--bg --resume abcd1234-real /);
    assert.ok(!last.includes('--allowedTools'), '옵션 없이 이어 띄운다');
  } finally { env.restore(); }
});

test('claude --bg가 번호를 출력하지 않아도(메신저 안에서 돌릴 때) 담당 이름과 시작 시각으로 실제 세션 번호를 찾는다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); approved(src); own(root, 'PRE', 1); setAgent(src, 1, '담당이름');
    fs.writeFileSync(path.join(env.home, 'bin', 'claude'), `#!/bin/sh\nif [ "$1" = "agents" ]; then cat "${env.agents}"; exit 0; fi\necho "$*" >> "${env.calls}"\n`, { mode: 0o755 }); // 출력이 없다
    const row = enqueueOutbox(src, 1)!;
    fs.writeFileSync(env.agents, JSON.stringify([
      { id: 'old', sessionId: 'OLD', name: ownerName(root, 1), kind: 'background', startedAt: Date.now() - 60 * 60_000 },
      { id: 'new1', sessionId: 'NEW-REAL', name: ownerName(root, 1), kind: 'background', startedAt: Date.now() + 5000 },
    ]));
    assert.equal(launchRow(src, row.seq).state, 'sent');
    assert.deepEqual(ownersOf(root, 1), ['NEW-REAL'], '옛 세션이 아니라 방금 만든 세션으로 바뀐다');
  } finally { env.restore(); }
});

test('메신저 기동: 없으면 claude --bg로 띄우고, 쉬는데 대기 줄이 있으면 --resume으로 깨우며, 일하는 중이면 건드리지 않고, 설정이 꺼져 있으면 안 한다', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); approved(src); own(root, 'S1', 1); setAgent(src, 1, '담당이름');
    const name = messengerName(root);
    let t = Date.now();
    assert.equal(ensureMessenger(src, t), 'started', '메신저가 없다');
    await waitFor(() => fs.existsSync(env.calls));
    const first = fs.readFileSync(env.calls, 'utf8');
    assert.match(first, new RegExp(`--bg --name ${name} --model haiku`));
    assert.match(first, /--allowedTools Read Bash\(node .*spec\.mjs:\*\) Monitor SendMessage ToolSearch/);
    assert.match(first, /messenger\.md/);
    assert.equal(ensureMessenger(src, t + 1000), 'skipped', '30초 안에는 다시 확인하지 않는다');
    enqueueOutbox(src, 1);
    t += 31_000;
    fs.writeFileSync(env.agents, JSON.stringify([{ id: 'm1', sessionId: 'M1', name, kind: 'background', status: 'busy' }]));
    assert.equal(ensureMessenger(src, t), 'ok', '일하는 중이면 건드리지 않는다');
    t += 31_000;
    fs.writeFileSync(env.agents, JSON.stringify([{ id: 'm1', sessionId: 'M1', name, kind: 'background', status: 'waiting' }]));
    assert.equal(ensureMessenger(src, t), 'ok', '권한 확인 중이어도 건드리지 않는다');
    t += 31_000;
    fs.writeFileSync(env.agents, JSON.stringify([{ id: 'm1', sessionId: 'M1', name, kind: 'background', status: 'idle' }]));
    assert.equal(ensureMessenger(src, t), 'resumed', '쉬는 중인데 대기 줄이 있다');
    await waitFor(() => /--bg --resume M1/.test(fs.readFileSync(env.calls, 'utf8')));
    assert.match(fs.readFileSync(env.calls, 'utf8'), /--bg --resume M1 /);
    // 쉬는 중이고 대기 줄이 없는데 대화 기록이 크면 멈추고 새로 띄운다
    t += 31_000;
    for (const r of loadOutbox(src)) doneRow(src, r.seq, 'send');
    fs.mkdirSync(path.dirname(transcriptOf(root, 'M1')), { recursive: true });
    fs.writeFileSync(transcriptOf(root, 'M1'), Buffer.alloc(401 * 1024));
    assert.equal(ensureMessenger(src, t), 'recycled');
    await waitFor(() => /^stop m1$/m.test(fs.readFileSync(env.calls, 'utf8')));
    assert.match(fs.readFileSync(env.calls, 'utf8'), /^stop m1$/m);
    const off = tempProject();
    assert.equal(ensureMessenger(off.src, t + 99_000), 'skipped', '설정 wake가 꺼져 있다');
  } finally { env.restore(); }
});

test('서버 소스 어디에도 claude를 실행해 글을 보내는 길(헤드리스 출력 형식·-p·spawn claude)이 없다', () => {
  const dir = path.resolve('src');
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  for (const f of all) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/claude -p /.test(text), `${f}에 claude -p 실행이 있다`);
    // 예외: 읽기 전용 조회(claude agents)와, 메신저가 부르는 outbox.ts의 launchRow(claude --bg). 서버 파일은 outbox.ts를 부르더라도 launchRow를 부르지 않는다(아래)
    if (f !== 'outbox.ts') assert.ok(!/spawn(Sync)?\(\s*'claude'/.test(text), `${f}가 claude를 실행한다`);
    else assert.ok(!/spawn(Sync)?\(\s*'claude',\s*\[\s*'(?!agents')(?!\.\.\.head)/.test(text), `${f}가 허용되지 않은 claude 실행을 한다`);
    // 서버(middleware·serve·wake)가 담당에게 글을 보내는 launchRow를 부르지 않는다. 서버가 부르는 claude는 메신저 기동(ensureMessenger)뿐이다
    if (['middleware.ts', 'serve.ts', 'wake.ts', 'inbox.ts'].includes(f)) assert.ok(!text.includes('launchRow'), `${f}가 launchRow를 부른다`);
    if (f !== 'outbox.ts' && f !== 'request.ts') assert.ok(!text.includes('launchRow'), `${f}가 launchRow를 부른다(서버는 부르지 않는다)`);
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
