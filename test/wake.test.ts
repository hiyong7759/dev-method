/**
 * @why 서버가 쉬는 담당 세션만 깨우는지(열린 세션·설정 꺼짐은 건드리지 않는지), 깨울 때 "압축 → 이어서 하라는 지시" 순서로 부르는지, 담당이 한 번도 없으면 새 세션을 만들어 맡기는지, 부를 때마다 든 비용을 요청별로 적는지 지킨다. 진짜 claude 대신 부른 인자를 기록하고 비용 JSON을 돌려주는 가짜 claude를 PATH 앞에 둬서 비용 없이 시험한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wakeOwner } from '../src/wake.js';
import { startOwner, parseUsage } from '../src/session.js';
import { addRequest } from '../src/request.js';
import { tempProject } from './helpers.js';

/** 가짜 claude와 가짜 홈을 만들어 환경에 건다. 돌려주는 함수가 원래대로 되돌린다 */
function fakeEnv(): { calls: string; transcript: (root: string, sid: string) => string; restore: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-wake-'));
  const bin = path.join(base, 'bin'); fs.mkdirSync(bin);
  const calls = path.join(base, 'calls.txt');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "$*" | tr '\\n' ' ' >> "${calls}"; echo >> "${calls}"\necho '{"total_cost_usd":0.5,"usage":{"input_tokens":10,"cache_creation_input_tokens":5,"cache_read_input_tokens":100,"output_tokens":7}}'\n`, { mode: 0o755 });
  const old = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = `${bin}:${old.PATH}`; process.env.HOME = base;
  const transcript = (root: string, sid: string): string => path.join(base, '.claude', 'projects', fs.realpathSync(root).replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`);
  return { calls, transcript, restore: () => { process.env.PATH = old.PATH; process.env.HOME = old.HOME; } };
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
    assert.equal(startOwner(src, 1, 'start'), null, '담당이 이미 있으면 새로 만들지 않는다');
    assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /이미 있어 새로 만들지 않음/);
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

test('최근에 움직인(열린) 세션은 훅에 맡기고 깨우지 않는다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); own(root, 'S1', 1);
    const t = env.transcript(root, 'S1'); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, '{}\n');
    assert.deepEqual(wakeOwner(src, 1), []);
    assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /열려 있어 훅에 맡김/);
    assert.equal(fs.existsSync(env.calls), false);
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
    assert.match(lines[1], /^-p \[spec-view\] 요청 #1 "깨울 요청".*--resume S1 --model sonnet --allowedTools Read Edit Write Bash\(node:\*\) Bash\(npm:\*\).*Bash\(git add:\*\) Bash\(git commit:\*\)/);
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
    assert.match(lines[1], /그 일만 하고, 끝나면 멈추세요/);
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

test('세션을 부르는 일은 한 번에 하나씩 차례로 한다(앞 호출이 데운 캐시를 쓰게)', async () => {
  const env = fakeEnv();
  try {
    // 호출마다 시작·끝 시각을 남기고 잠깐 걸리는 가짜 claude
    const bin = path.dirname(path.join(path.dirname(env.calls), 'bin', 'claude'));
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "시작" >> "${env.calls}"; sleep 1; echo "끝" >> "${env.calls}"\necho '{"total_cost_usd":0.1,"usage":{}}'\n`, { mode: 0o755 });
    const { src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); addRequest(src, { title: 'b' });
    assert.ok(startOwner(src, 1, 'start')); assert.ok(startOwner(src, 2, 'start'));
    await wait(() => fs.existsSync(env.calls) && fs.readFileSync(env.calls, 'utf8').trim().split('\n').length >= 4);
    assert.deepEqual(fs.readFileSync(env.calls, 'utf8').trim().split('\n'), ['시작', '끝', '시작', '끝'], '겹치지 않고 하나가 끝난 뒤 다음이 시작한다');
  } finally { env.restore(); }
});

test('기록이 없는 세션(이미 지워졌거나 다른 곳)도 닫힌 것으로 본다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); own(root, 'GONE', 1);
    assert.deepEqual(wakeOwner(src, 1), ['GONE']);
  } finally { env.restore(); }
});
