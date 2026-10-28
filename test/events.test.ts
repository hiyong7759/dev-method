/**
 * @why 요청 #107: 화면은 서버가 보내는 알림(/__spec/events)을 받을 때만 새로 받고, 모델 요청은 만들어 둔 결과를 그대로 받는다. 실제 요청 처리기로 확인한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { specHandler } from '../src/middleware.js';
import { stopSnapshot, buildCount } from '../src/snapshot.js';
import { addRequest } from '../src/request.js';
import { tempProject } from './helpers.js';

test('모델 요청은 계산을 일으키지 않고, 기록이 바뀌면 알림이 온다', async () => {
  const { src } = tempProject();
  const handler = specHandler(src);
  const server = http.createServer((req, res) => { void handler(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise<void>((ok) => server.listen(0, ok));
  const port = (server.address() as { port: number }).port;
  const msgs: { model: number; tabs: number }[] = [];
  const events = http.get({ port, path: '/__spec/events' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (c: string) => { for (const m of c.matchAll(/data: (.*)\n/g)) msgs.push(JSON.parse(m[1])); });
  });
  try {
    const get = (p: string): Promise<string> => new Promise((ok, no) => { http.get({ port, path: p }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => ok(b)); }).on('error', no); });
    for (let i = 0; i < 40 && !msgs.length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(msgs.length, 1, '연결되면 현재 번호를 한 번 보낸다');
    const before = buildCount(src);
    for (let i = 0; i < 20; i++) assert.ok(JSON.parse(await get('/__spec/model.json')).requests);
    assert.equal(buildCount(src), before, '모델을 받는 요청이 계산을 일으켰다');
    addRequest(src, { title: '알림 시험' });
    for (let i = 0; i < 60 && msgs.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(msgs.length >= 2 && msgs[msgs.length - 1].model > msgs[0].model, '기록이 바뀌었는데 알림이 오지 않았다');
    assert.match(await get('/__spec/model.json'), /알림 시험/);
  } finally { events.destroy(); stopSnapshot(src); server.closeAllConnections(); server.close(); }
});
