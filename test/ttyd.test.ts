/**
 * @why 화면 아래 터미널 영역은 잘못 열리면 이 컴퓨터의 어떤 웹 페이지든 담당 세션을 조작할 수 있게 되므로, 접속 허용 규칙(이 컴퓨터 안·알려진 주소·같은 출처)과 탭이 끝난 요청에서 사라지는 것을 시험으로 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { tempProject } from './helpers.js';
import { addRequest } from '../src/request.js';
import { isTermUrl, termAllowed, termTabs } from '../src/ttyd.js';

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
