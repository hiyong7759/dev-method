/**
 * @why 서버가 쉬는 담당 세션만 깨우는지(열린 세션·설정 꺼짐은 건드리지 않는지), 깨울 때 "압축 → 이어서 하라는 지시" 순서로 부르는지, 담당이 한 번도 없으면 새 세션을 만들어 맡기는지, 부를 때마다 든 비용을 요청별로 적는지 지킨다. 진짜 claude 대신 부른 인자를 기록하고 비용 JSON을 돌려주는 가짜 claude를 PATH 앞에 둬서 비용 없이 시험한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resendUnread, startRequest, wakeOwner } from '../src/wake.js';
import { startOwner, parseUsage } from '../src/session.js';
import { conversationsOf } from '../src/conversation.js';
import { deliveryOf, openDelivery } from '../src/delivery.js';
import { addRequest, loadRequests, setAgent } from '../src/request.js';
import { tempProject } from './helpers.js';

/** 가짜 claude와 가짜 홈을 만들어 환경에 건다. 돌려주는 함수가 원래대로 되돌린다 */
function fakeEnv(): { calls: string; agents: string; transcript: (root: string, sid: string) => string; restore: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-wake-'));
  const bin = path.join(base, 'bin'); fs.mkdirSync(bin);
  const calls = path.join(base, 'calls.txt');
  // `claude agents --json`은 지금 살아 있는 세션 목록이다. 시험은 이 파일의 내용을 그대로 돌려준다(처음엔 아무것도 살아 있지 않다)
  const agents = path.join(base, 'agents.json'); fs.writeFileSync(agents, '[]');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nif [ "$1" = "agents" ]; then cat "${agents}"; exit 0; fi\necho "$*" | tr '\\n' ' ' >> "${calls}"; echo >> "${calls}"\necho '{"total_cost_usd":0.5,"usage":{"input_tokens":10,"cache_creation_input_tokens":5,"cache_read_input_tokens":100,"output_tokens":7}}'\n`, { mode: 0o755 });
  const old = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = `${bin}:${old.PATH}`; process.env.HOME = base;
  const transcript = (root: string, sid: string): string => path.join(base, '.claude', 'projects', fs.realpathSync(root).replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`);
  return { calls, agents, transcript, restore: () => { process.env.PATH = old.PATH; process.env.HOME = old.HOME; } };
}
const own = (root: string, sid: string, request: number): void => fs.writeFileSync(path.join(root, '.spec', 'sessions.json'), JSON.stringify({ [sid]: { request, seen: '' } }));
const wait = async (f: () => boolean): Promise<void> => { for (let i = 0; i < 200 && !f(); i++) await new Promise((ok) => setTimeout(ok, 50)); };

test('설정에서 wake를 켜지 않으면 아무것도 하지 않는다', () => {
  const { root, src } = tempProject(); addRequest(src, { title: 'a' }); own(root, 'S1', 1);
  assert.deepEqual(wakeOwner(src, 1), []);
  assert.equal(fs.existsSync(path.join(root, '.spec', 'wake.log')), false);
});

test('담당 세션이 한 번도 없으면 결정 때 새 세션을 만들어 그 일을 맡긴다', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '새 세션 요청' });
    const made = wakeOwner(src, 1);
    assert.equal(made.length, 1, '세션 하나를 새로 만든다');
    const sessions = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'sessions.json'), 'utf8')) as Record<string, { request: number }>;
    assert.equal(sessions[made[0]].request, 1, '만든 세션을 담당으로 바로 적는다');
    await wait(() => fs.existsSync(env.calls));
    const line = fs.readFileSync(env.calls, 'utf8').trim().split('\n')[0];
    assert.match(line, new RegExp(`--session-id ${made[0]}`));
    assert.match(line, /request agent --id 1/);
    assert.match(line, /--model sonnet/, '새 세션도 소넷으로');
    assert.match(line, /사용자가 결정했습니다/);
    const req = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'requests', '1.json'), 'utf8')) as { events: { kind: string }[] };
    assert.ok(req.events.some((e) => e.kind === 'session-started'), '진행 기록에 세션을 만들었다고 남긴다');
    const costs = path.join(root, '.spec', 'session-costs.json');
    await wait(() => fs.existsSync(costs));
    assert.equal((JSON.parse(fs.readFileSync(costs, 'utf8')) as { kind: string }[])[0].kind, 'start');
  } finally { env.restore(); }
});

test('요청을 시작할 때 담당이 없으면 설계를 쓰고 승인 대기에서 멈추는 세션을 만든다', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '시작할 요청' });
    const sid = startOwner(src, 1, 'start');
    assert.ok(sid);
    await wait(() => fs.existsSync(env.calls));
    const line = fs.readFileSync(env.calls, 'utf8').trim().split('\n')[0];
    assert.match(line, /request design --id 1/);
    assert.match(line, /승인 대기에서 멈추세요/);
    setAgent(src, 1, '요청 #1 담당'); // 새 세션이 request agent로 담당을 정한 뒤
    assert.equal(startOwner(src, 1, 'start'), null, '담당이 이미 있으면 새로 만들지 않는다');
    assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /이미 있어 새로 만들지 않음/);
  } finally { env.restore(); }
});

test('요청을 접수만 한 세션이 담당으로 남아 있어도, 담당을 정한 적 없으면 시작할 때 새 세션을 만든다', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '접수한 세션이 남긴 기록' }); own(root, 'OLD', 1);
    const sid = startOwner(src, 1, 'start');
    assert.ok(sid && sid !== 'OLD', '새 세션을 만든다');
    const sessions = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'sessions.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(sessions), [sid], '접수한 세션의 옛 담당 기록은 걷어 낸다');
    await wait(() => fs.existsSync(env.calls));
  } finally { env.restore(); }
});

test('설정에서 wake를 꺼 두면 세션을 만들지 않는다', () => {
  const { root, src } = tempProject(); addRequest(src, { title: 'a' });
  assert.equal(startOwner(src, 1, 'start'), null);
  assert.equal(fs.existsSync(path.join(root, '.spec', 'sessions.json')), false);
});

test('claude 결과에서 토큰과 비용을 읽고, 읽을 수 없으면 null', () => {
  assert.deepEqual(parseUsage('{"total_cost_usd":0.25,"usage":{"input_tokens":2,"cache_creation_input_tokens":3,"cache_read_input_tokens":5,"output_tokens":7}}'), { inputTokens: 10, outputTokens: 7, usd: 0.25 });
  assert.equal(parseUsage('이건 JSON이 아니다'), null);
  assert.equal(parseUsage('{"usage":{}}'), null);
});

test('일하는 중(busy)인 세션은 서버가 끼어들지 않고 훅에 맡긴다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); own(root, 'S1', 1);
    fs.writeFileSync(env.agents, JSON.stringify([{ pid: 1, kind: 'interactive', sessionId: 'S1', status: 'busy' }]));
    assert.deepEqual(wakeOwner(src, 1), []);
    assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /일하는 중이라 훅에 맡김/);
    assert.equal(fs.existsSync(env.calls), false);
  } finally { env.restore(); }
});

test('방금 일을 마친 세션도 살아 있지 않으면 글을 보내 이어서 하게 한다(기록이 최근에 바뀌었어도)', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '방금 끝난 세션' }); own(root, 'S1', 1);
    const t = env.transcript(root, 'S1'); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, '{}\n'); // 방금 쓴 기록
    assert.deepEqual(wakeOwner(src, 1), ['S1']);
    await wait(() => fs.existsSync(env.calls));
    assert.match(fs.readFileSync(env.calls, 'utf8'), /--resume S1/);
  } finally { env.restore(); }
});

test('열어 두고 기다리는(idle) 세션에는 글을 보낸다(기다리는 세션은 훅이 움직일 수 없다)', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '열어 둔 세션' }); own(root, 'S1', 1);
    fs.writeFileSync(env.agents, JSON.stringify([{ pid: 1, kind: 'interactive', sessionId: 'S1', status: 'idle' }]));
    assert.deepEqual(wakeOwner(src, 1), ['S1']);
    await wait(() => fs.existsSync(env.calls));
    assert.match(fs.readFileSync(env.calls, 'utf8'), /--resume S1/);
  } finally { env.restore(); }
});

test('결정이 전달되지 않았을 때 다시 보내는 force는 일하는 중인 세션에도 글을 보낸다', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); own(root, 'S1', 1);
    fs.writeFileSync(env.agents, JSON.stringify([{ pid: 1, kind: 'interactive', sessionId: 'S1', status: 'busy' }]));
    assert.deepEqual(wakeOwner(src, 1, true), ['S1']);
    await wait(() => fs.existsSync(env.calls));
  } finally { env.restore(); }
});

test('닫힌 세션은 압축한 뒤 이어서 하라고 지시한다', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '깨울 요청' }); own(root, 'S1', 1);
    const t = env.transcript(root, 'S1'); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, '{}\n');
    const old = new Date(Date.now() - 60 * 60 * 1000); fs.utimesSync(t, old, old);
    assert.deepEqual(wakeOwner(src, 1), ['S1']);
    await wait(() => fs.existsSync(env.calls) && fs.readFileSync(env.calls, 'utf8').trim().split('\n').length >= 2);
    const lines = fs.readFileSync(env.calls, 'utf8').trim().split('\n');
    assert.match(lines[0], /^-p \/compact --resume S1/);
    assert.match(lines[1], /^-p \[spec-view\] \S+ 요청 #1 "깨울 요청".*--resume S1 --model sonnet --allowedTools Read Edit Write Bash\(node \S+spec\.mjs:\*\) Bash\(npm:\*\).*Bash\(git add:\*\) Bash\(git commit:\*\)/);
    assert.match(lines[0], /--model sonnet/, '압축 호출도 소넷으로');
    assert.match(lines[1], /--model sonnet/, '지시 호출도 소넷으로');
    assert.doesNotMatch(lines[1], /git push|git reset|git checkout/, '그 일의 커밋만 허락하고 위험한 git은 허락하지 않는다');
    const costs = path.join(root, '.spec', 'session-costs.json');
    await wait(() => fs.existsSync(costs) && (JSON.parse(fs.readFileSync(costs, 'utf8')) as unknown[]).length >= 2);
    const rows = JSON.parse(fs.readFileSync(costs, 'utf8')) as { request: number; kind: string; inputTokens: number; outputTokens: number; usd: number }[];
    assert.equal(rows.length, 2, '압축과 지시 두 번 모두 비용을 적는다');
    assert.deepEqual({ request: rows[0].request, kind: rows[0].kind, inputTokens: rows[0].inputTokens, outputTokens: rows[0].outputTokens, usd: rows[0].usd }, { request: 1, kind: 'wake', inputTokens: 115, outputTokens: 7, usd: 0.5 });
    assert.match(lines[1], /\[요청 내용/, '요청 내용을 글에 직접 넣어 읽는 턴을 줄인다');
    assert.match(lines[1], /requests\/1\.json/);
    assert.match(lines[1], /todo --src src/);
    assert.match(lines[1], /그 일만 하고\(.*request test.*테스트 요청을 올리는 데까지.*\), 끝나면 멈추세요/, '그 일에 테스트 요청까지 들어 있다');
    assert.match(lines[1], /npm run typecheck/, '타입 검사는 npm run typecheck로 쓰라고 적는다');
    assert.match(lines[1], /request blocked --id 1/, '막히면 막힘을 남기라고 적는다');
    assert.match(lines[1], /request ask --id 1/, '사용자에게 물을 때 질문을 남기라고 적는다');
    assert.match(lines[1], /--disallowedTools Read\(\.spec\/local\.json\)/, '읽기 금지 경로를 준다');
    assert.match(lines[1], /--disallowedTools .*Read\(\.env\*\)/);
    assert.match(lines[1], /--settings .*claude-block-secret-read\.sh/, '명령으로 읽는 길을 막는 훅을 건다');
    assert.doesNotMatch(lines[1], /Bash\(node:\*\)/, 'node는 입구 파일만 허용한다');
    await wait(() => /끝남 종료코드=0/.test(fs.existsSync(path.join(root, '.spec', 'wake.log')) ? fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8') : ''));
    assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /끝남 종료코드=0/);
  } finally { env.restore(); }
});

/** 닫힌 세션 하나와 가짜 기록을 만든다: 쉰 시간(분)과 크기(바이트) */
function closedSession(env: ReturnType<typeof fakeEnv>, idleMin: number, bytes: number): { root: string; src: string } {
  const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '압축 시험' }); own(root, 'S1', 1);
  const t = env.transcript(root, 'S1'); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, 'x'.repeat(bytes));
  const old = new Date(Date.now() - idleMin * 60 * 1000); fs.utimesSync(t, old, old);
  return { root, src };
}

test('1시간 안에 쉰 작은 세션은 압축 없이 바로 지시만 한다(캐시가 아직 따뜻하다)', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = closedSession(env, 20, 1000);
    assert.deepEqual(wakeOwner(src, 1), ['S1']);
    await wait(() => fs.existsSync(env.calls));
    await wait(() => /끝남 종료코드=0/.test(fs.existsSync(path.join(root, '.spec', 'wake.log')) ? fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8') : ''));
    const lines = fs.readFileSync(env.calls, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, '호출은 지시 한 번뿐이다');
    assert.doesNotMatch(lines[0], /\/compact/);
    assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /압축 없이 바로 지시함/);
  } finally { env.restore(); }
});

test('1시간 넘게 쉬었거나 대화 기록이 크면 먼저 압축한다', async () => {
  const env = fakeEnv();
  try {
    const big = closedSession(env, 20, 600 * 1024);
    assert.deepEqual(wakeOwner(big.src, 1), ['S1']);
    await wait(() => fs.existsSync(env.calls) && fs.readFileSync(env.calls, 'utf8').trim().split('\n').length >= 2);
    assert.match(fs.readFileSync(env.calls, 'utf8').trim().split('\n')[0], /\/compact/);
    assert.match(fs.readFileSync(path.join(big.root, '.spec', 'wake.log'), 'utf8'), /대화 기록이 커서/);
  } finally { env.restore(); }
});

test('새 세션 시작은 줄을 서지 않고 바로 한다(줄에 밀려 시작이 늦어져 빠진 것처럼 보이지 않게)', async () => {
  const env = fakeEnv();
  try {
    // 호출마다 시작·끝 시각을 남기고 잠깐 걸리는 가짜 claude
    const bin = path.dirname(path.join(path.dirname(env.calls), 'bin', 'claude'));
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "시작" >> "${env.calls}"; sleep 1; echo "끝" >> "${env.calls}"\necho '{"total_cost_usd":0.1,"usage":{}}'\n`, { mode: 0o755 });
    const { src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); addRequest(src, { title: 'b' });
    assert.ok(startOwner(src, 1, 'start')); assert.ok(startOwner(src, 2, 'start'));
    await wait(() => fs.existsSync(env.calls) && fs.readFileSync(env.calls, 'utf8').trim().split('\n').length >= 4);
    assert.deepEqual(fs.readFileSync(env.calls, 'utf8').trim().split('\n'), ['시작', '시작', '끝', '끝'], '시작은 서로 기다리지 않는다');
  } finally { env.restore(); }
});

test('같은 세션을 부르는 깨움은 한 번에 하나씩 차례로 한다(같은 대화에 둘이 끼어들지 않게)', async () => {
  const env = fakeEnv();
  try {
    const bin = path.dirname(path.join(path.dirname(env.calls), 'bin', 'claude'));
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nif [ "$1" = "agents" ]; then cat "${env.agents}"; exit 0; fi\necho "시작" >> "${env.calls}"; sleep 1; echo "끝" >> "${env.calls}"\necho '{"total_cost_usd":0.1,"usage":{}}'\n`, { mode: 0o755 });
    const { src } = closedSession(env, 20, 1000);
    wakeOwner(src, 1, true); wakeOwner(src, 1, true);
    await wait(() => fs.existsSync(env.calls) && fs.readFileSync(env.calls, 'utf8').trim().split('\n').length >= 4);
    assert.deepEqual(fs.readFileSync(env.calls, 'utf8').trim().split('\n'), ['시작', '끝', '시작', '끝']);
  } finally { env.restore(); }
});

test('시작 중인 담당 세션은 옛 기록으로 보지 않아, 다시 시작해도 담당이 둘이 되지 않는다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '연달아 시작' });
    const first = startOwner(src, 1, 'start');
    assert.ok(first);
    assert.equal(startOwner(src, 1, 'start'), null, '담당 등록 전이라도 시작한 지 얼마 안 됐으면 새로 만들지 않는다');
    const sessions = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'sessions.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(sessions), [first]);
    assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /시작 중이라 새로 만들지 않음/);
  } finally { env.restore(); }
});

test('요청을 시작하면 전달 기록이 열리고, 안 읽히면 같은 세션에 시작 글을 다시 보내며, 끝내 안 읽히면 실패로 남긴다', async () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: '빠진 시작' });
    const started = startRequest(src, 1);
    const sid = started.session as string;
    assert.ok(sid);
    const v0 = deliveryOf(src, loadRequests(src)[0])!;
    assert.equal(v0.kind, 'started');
    assert.equal(v0.state, 'sending', '담당 세션을 만들어 글을 보낸 순간부터 전달 중이다');
    await wait(() => fs.existsSync(env.calls));
    fs.writeFileSync(env.calls, '');
    const file = path.join(root, '.spec', 'deliveries.json');
    const age = (min: number): void => { const s = JSON.parse(fs.readFileSync(file, 'utf8')); s[1].lastSentAt = new Date(Date.now() - min * 60000).toISOString(); fs.writeFileSync(file, JSON.stringify(s)); };
    assert.deepEqual(resendUnread(src), [], '방금 보냈으면 기다린다');
    age(6);
    assert.deepEqual(resendUnread(src), [1]);
    await wait(() => fs.readFileSync(env.calls, 'utf8').includes(`--session-id ${sid}`));
    assert.match(fs.readFileSync(env.calls, 'utf8'), /request agent --id 1/, '같은 시작 글을 보낸다');
    const sessions = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'sessions.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(sessions), [sid], '새 세션을 만들지 않아 담당이 둘이 되지 않는다');
    assert.deepEqual(resendUnread(src), [], '다시 보낸 직후에는 또 보내지 않는다');
    age(6);
    assert.deepEqual(resendUnread(src), [1]);
    age(6);
    assert.deepEqual(resendUnread(src), [], '2번 보낸 뒤에는 더 보내지 않는다');
    assert.equal(deliveryOf(src, loadRequests(src)[0])!.state, 'failed');
    const req = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'requests', '1.json'), 'utf8')) as { events: { kind: string }[] };
    assert.equal(req.events.filter((e) => e.kind === 'session-failed').length, 1, '끝내 안 읽히면 진행 기록에 실패로 한 번 남긴다');
    resendUnread(src);
    assert.equal((JSON.parse(fs.readFileSync(path.join(root, '.spec', 'requests', '1.json'), 'utf8')) as { events: { kind: string }[] }).events.filter((e) => e.kind === 'session-failed').length, 1, '또 남기지 않는다');
  } finally { env.restore(); }
});

test('깨우는 장치(wake)가 꺼져 있으면 시작해도 담당 세션을 만들지 않고 훅 대기로 알린다', () => {
  const { src } = tempProject(); addRequest(src, { title: '수동' });
  const started = startRequest(src, 1);
  assert.equal(started.session, null);
  assert.equal(deliveryOf(src, loadRequests(src)[0])!.state, 'hook-wait');
});

test('이미 완료된 요청은 결정이 와도 담당 세션을 깨우지 않는다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = closedSession(env, 20, 1000);
    const f = path.join(root, '.spec', 'requests', '1.json');
    const r = JSON.parse(fs.readFileSync(f, 'utf8')); r.stage = 'done'; r.step = 'done'; fs.writeFileSync(f, JSON.stringify(r));
    assert.deepEqual(wakeOwner(src, 1, true), []);
    assert.equal(fs.existsSync(env.calls), false);
  } finally { env.restore(); }
});

test('테스트 승인처럼 완료로 닫는 결정은 전달 기록을 만들지 않는다', () => {
  const { src } = tempProject({ wake: true }); const r = addRequest(src, { title: '닫는 승인' });
  const d = openDelivery(src, { ...r, events: [...r.events, { at: new Date().toISOString(), by: 'user', kind: 'test-approved', note: '테스트 승인' }] });
  assert.equal(d, null);
});

test('담당 세션의 지난 대화를 기록 파일에서 읽기만 해서 돌려준다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = closedSession(env, 20, 0);
    const line = (o: unknown): string => JSON.stringify(o);
    fs.writeFileSync(env.transcript(root, 'S1'), [
      line({ type: 'user', timestamp: '2026-10-26T01:00:00Z', message: { content: '설계를 올려 주세요' } }),
      line({ type: 'assistant', timestamp: '2026-10-26T01:00:05Z', message: { content: [{ type: 'text', text: '올렸습니다' }, { type: 'tool_use', name: 'Bash', input: { command: 'node spec.mjs todo' } }] } }),
      line({ type: 'user', timestamp: '2026-10-26T01:00:06Z', message: { content: [{ type: 'tool_result', content: '긴 결과' }] } }),
      '깨진 줄',
    ].join('\n'));
    const before = fs.readFileSync(env.transcript(root, 'S1'), 'utf8');
    const [c] = conversationsOf(src, 1);
    assert.equal(c.sid, 'S1');
    assert.deepEqual(c.turns.map((t) => [t.role, t.text]), [['user', '설계를 올려 주세요'], ['agent', '올렸습니다'], ['tool', 'Bash node spec.mjs todo']]);
    assert.equal(fs.readFileSync(env.transcript(root, 'S1'), 'utf8'), before, '기록 파일은 고치지 않는다');
  } finally { env.restore(); }
});

test('기록이 없는 세션(이미 지워졌거나 다른 곳)도 닫힌 것으로 본다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); own(root, 'GONE', 1);
    assert.deepEqual(wakeOwner(src, 1), ['GONE']);
  } finally { env.restore(); }
});
