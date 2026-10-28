/**
 * @why 화면 아래 터미널 영역은 잘못 열리면 이 컴퓨터의 어떤 웹 페이지든 담당 세션을 조작할 수 있게 되므로, 접속 허용 규칙(이 컴퓨터 안·알려진 주소·같은 출처)과 탭이 끝난 요청에서 사라지는 것을 시험으로 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type net from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import { tempProject } from './helpers.js';
import { addRequest } from '../src/request.js';
import { dockWorks, isTermUrl, itermShouldOpen, stopAllTtyd, termAllowed, termHttp, termTabs } from '../src/ttyd.js';

const req = (o: { addr?: string; host?: string; origin?: string; site?: string }): IncomingMessage => ({
  socket: { remoteAddress: o.addr ?? '127.0.0.1' },
  headers: { host: o.host ?? 'localhost:5290', ...(o.origin ? { origin: o.origin } : {}), ...(o.site ? { 'sec-fetch-site': o.site } : {}) },
}) as unknown as IncomingMessage;

test('이 컴퓨터 안에서 알려진 주소로 온 읽기 요청만 허용한다', () => {
  assert.equal(termAllowed(req({}), false), true);
  assert.equal(termAllowed(req({ host: 'test.localhost:5391' }), false), true);
  assert.equal(termAllowed(req({ addr: '192.168.0.7' }), false), false, '다른 컴퓨터');
  assert.equal(termAllowed(req({ host: 'evil.example.com' }), false), false, 'DNS 재바인딩');
  assert.equal(termAllowed(req({ site: 'cross-site' }), false), false);
});

test('웹소켓·쓰기는 같은 주소에서 보낸 출처가 있어야 한다', () => {
  assert.equal(termAllowed(req({ origin: 'http://localhost:5290' }), true), true);
  assert.equal(termAllowed(req({}), true), false, '출처 없음');
  assert.equal(termAllowed(req({ origin: 'http://evil.example.com' }), true), false, '다른 출처');
  assert.equal(termAllowed(req({ origin: 'not a url' }), true), false);
});

test('터미널 주소만 알아본다', () => {
  assert.equal(isTermUrl('/__spec/term/93/ws'), true);
  assert.equal(isTermUrl('/__spec/term/93'), true);
  assert.equal(isTermUrl('/__spec/term/tabs.json'), false);
  assert.equal(isTermUrl('/__spec/model.json'), false);
});

test('담당이 있는 요청은 탭이 되고, 끝나면 지난 담당으로 옮겨 간다', () => {
  const { root, src } = tempProject();
  const r = addRequest(src, { title: '시험 요청', origin: '시험', channel: '대화', screens: [], infos: [] });
  fs.writeFileSync(path.join(root, '.spec', 'sessions.json'), JSON.stringify({ 'abcdef12-0000-0000-0000-000000000000': { request: r.id } }));
  const file = path.join(root, '.spec', 'requests', `${r.id}.json`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.agent = { name: '시험 담당' };
  fs.writeFileSync(file, JSON.stringify(j));
  const live = termTabs(src);
  assert.deepEqual(live.live.map((t) => [t.id, t.sid, t.command]), [[r.id, 'abcdef12', 'claude attach abcdef12']]);
  j.stage = 'done';
  fs.writeFileSync(file, JSON.stringify(j));
  const done = termTabs(src);
  assert.equal(done.live.length, 0);
  assert.deepEqual(done.past.map((t) => t.id), [r.id]);
});

/** 가짜 claude(입력을 되돌려 줄 뿐)를 둔 임시 폴더 */
function fakeClaudeBin(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-fakebin-'));
  fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/bash\nexec cat\n', { mode: 0o755 });
  return dir;
}
const hasTtyd = spawnSync('which', ['ttyd']).status === 0;
const ENV_KEYS = ['PATH', 'SPEC_TEST_DIR', 'SPEC_NO_TERMINAL'] as const;
const saveEnv = (): Record<string, string | undefined> => Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restoreEnv = (e: Record<string, string | undefined>): void => { for (const k of ENV_KEYS) { if (e[k] === undefined) delete process.env[k]; else process.env[k] = e[k]; } };

test('ttyd 실행 인자(ps)에 비밀 값이 없고, 접속 통로는 소유자만 들어가는 폴더의 소켓이다', { skip: !hasTtyd && 'ttyd가 없다' }, async () => {
  const { root, src } = tempProject();
  const r = addRequest(src, { title: '시험 요청', origin: '시험', channel: '대화', screens: [], infos: [] });
  fs.writeFileSync(path.join(root, '.spec', 'sessions.json'), JSON.stringify({ 'abcdef12-0000-0000-0000-000000000000': { request: r.id } }));
  const file = path.join(root, '.spec', 'requests', `${r.id}.json`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.agent = { name: '시험 담당' };
  fs.writeFileSync(file, JSON.stringify(j));
  const saved = saveEnv();
  delete process.env.SPEC_TEST_DIR; delete process.env.SPEC_NO_TERMINAL;
  process.env.PATH = `${fakeClaudeBin()}:${saved.PATH}`;
  const server = http.createServer((q, s) => { void termHttp(src, q, s); });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const port = (server.address() as net.AddressInfo).port;
    const code = await new Promise<number>((ok) => http.get({ port, host: '127.0.0.1', path: `/__spec/term/${r.id}/`, agent: false, headers: { host: `localhost:${port}`, connection: 'close' } }, (res) => { res.resume(); ok(res.statusCode ?? 0); }));
    assert.equal(code, 200, '터미널 첫 화면이 중계된다');
    const ps = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n').filter((l) => /ttyd/.test(l) && /spec-ttyd-/.test(l));
    assert.equal(ps.length, 1, '이 시험이 띄운 ttyd가 하나 있다');
    assert.doesNotMatch(ps[0], /(^|\s)(-c|--credential)(\s|=)/, '인증 값을 실행 인자로 넘기지 않는다');
    assert.doesNotMatch(ps[0], /-p\s*\d|--port/, '네트워크 포트를 열지 않는다');
    const sock = /(\/\S*spec-ttyd-\S*\.sock)/.exec(ps[0])?.[1] ?? '';
    assert.ok(sock, '유닉스 소켓으로 연다');
    assert.equal(fs.statSync(path.dirname(sock)).mode & 0o777, 0o700, '소켓이 든 폴더는 소유자만 들어간다');
  } finally {
    stopAllTtyd();
    server.closeAllConnections();
    server.close();
    restoreEnv(saved);
  }
});

test('터미널 영역을 못 열면(설정으로 끔·ttyd 없음·테스트 환경) iTerm2 창을 자동으로 연다', () => {
  const saved = saveEnv();
  delete process.env.SPEC_TEST_DIR; delete process.env.SPEC_NO_TERMINAL;
  try {
    // ttyd가 있는 환경(가짜 ttyd를 PATH에 둔다): 영역이 열리므로 창은 열지 않는다
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-fakettyd-'));
    fs.writeFileSync(path.join(bin, 'ttyd'), '#!/bin/bash\n', { mode: 0o755 });
    process.env.PATH = `${bin}:${saved.PATH}`;
    const ok = tempProject();
    assert.equal(dockWorks(ok.src), true);
    assert.equal(itermShouldOpen(ok.src), false, '영역이 열릴 수 있으면 창을 열지 않는다');
    assert.equal(itermShouldOpen(tempProject({ terminalDock: false }).src), true, '설정으로 껐으면 창을 연다');
    // 직접 적은 itermAutoOpen이 우선한다
    assert.equal(itermShouldOpen(tempProject({ itermAutoOpen: false, terminalDock: false }).src), false);
    assert.equal(itermShouldOpen(tempProject({ itermAutoOpen: true }).src), true);
    // 터미널을 띄울 수 없는 환경
    process.env.SPEC_NO_TERMINAL = '1';
    assert.equal(itermShouldOpen(ok.src), true, '터미널을 띄울 수 없는 환경이면 창을 연다');
    delete process.env.SPEC_NO_TERMINAL;
    // ttyd가 없다: PATH에서 ttyd를 뺀다(which만 남긴다)
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-nottyd-'));
    fs.symlinkSync(execFileSync('which', ['which'], { encoding: 'utf8' }).trim(), path.join(empty, 'which'));
    process.env.PATH = empty;
    assert.equal(dockWorks(ok.src), false);
    assert.equal(itermShouldOpen(ok.src), true, 'ttyd가 없으면 창을 연다');
    assert.match(termTabs(ok.src).reason, /ttyd가 없다/);
  } finally {
    restoreEnv(saved);
  }
});
