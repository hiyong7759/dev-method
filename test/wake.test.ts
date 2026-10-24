/**
 * @why 서버가 쉬는 담당 세션만 깨우는지(열린 세션·설정 꺼짐은 건드리지 않는지)와, 깨울 때 "압축 → 이어서 하라는 지시" 순서로 부르는지 지킨다. 진짜 claude 대신 부른 인자를 기록하는 가짜 claude를 PATH 앞에 둬서 비용 없이 시험한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wakeOwner } from '../src/wake.js';
import { addRequest } from '../src/request.js';
import { tempProject } from './helpers.js';

/** 가짜 claude와 가짜 홈을 만들어 환경에 건다. 돌려주는 함수가 원래대로 되돌린다 */
function fakeEnv(): { calls: string; transcript: (root: string, sid: string) => string; restore: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-wake-'));
  const bin = path.join(base, 'bin'); fs.mkdirSync(bin);
  const calls = path.join(base, 'calls.txt');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${calls}"\n`, { mode: 0o755 });
  const old = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = `${bin}:${old.PATH}`; process.env.HOME = base;
  const transcript = (root: string, sid: string): string => path.join(base, '.claude', 'projects', fs.realpathSync(root).replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`);
  return { calls, transcript, restore: () => { process.env.PATH = old.PATH; process.env.HOME = old.HOME; } };
}
const own = (root: string, sid: string, request: number): void => fs.writeFileSync(path.join(root, '.spec', 'sessions.json'), JSON.stringify({ [sid]: { request, seen: '' } }));
const wait = async (f: () => boolean): Promise<void> => { for (let i = 0; i < 60 && !f(); i++) await new Promise((ok) => setTimeout(ok, 50)); };

test('설정에서 wake를 켜지 않으면 아무것도 하지 않는다', () => {
  const { root, src } = tempProject(); addRequest(src, { title: 'a' }); own(root, 'S1', 1);
  assert.deepEqual(wakeOwner(src, 1), []);
  assert.equal(fs.existsSync(path.join(root, '.spec', 'wake.log')), false);
});

test('담당 세션이 없으면 깨울 곳이 없고 로그에 이유를 남긴다', () => {
  const { root, src } = tempProject({ wake: true }); addRequest(src, { title: 'a' });
  assert.deepEqual(wakeOwner(src, 1), []);
  assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /담당 세션이 없어/);
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
    assert.match(lines[1], /^-p \[spec-view\] 요청 #1 "깨울 요청".*--resume S1 --allowedTools Read Edit Write Bash\(node:\*\) Bash\(npm:\*\)/);
    assert.doesNotMatch(lines[1], /git/, '커밋은 미리 허락하지 않는다');
    assert.match(lines[1], /requests\/1\.json/);
    assert.match(lines[1], /todo --src src/);
    assert.match(lines[1], /그 일만 하고, 끝나면 멈추세요/);
    await wait(() => /끝남 종료코드=0/.test(fs.existsSync(path.join(root, '.spec', 'wake.log')) ? fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8') : ''));
    assert.match(fs.readFileSync(path.join(root, '.spec', 'wake.log'), 'utf8'), /끝남 종료코드=0/);
  } finally { env.restore(); }
});

test('기록이 없는 세션(이미 지워졌거나 다른 곳)도 닫힌 것으로 본다', () => {
  const env = fakeEnv();
  try {
    const { root, src } = tempProject({ wake: true }); addRequest(src, { title: 'a' }); own(root, 'GONE', 1);
    assert.deepEqual(wakeOwner(src, 1), ['GONE']);
  } finally { env.restore(); }
});
