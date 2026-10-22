/**
 * @why 로그인이 있는 앱에서 도구가 테스트 계정으로 로그인해 두는지, 그리고 계정 파일이 커밋에 올라가지 않는지 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { loginIfConfigured } from '../src/login.js';
import { LAUNCHER } from '../src/paths.js';
import { tempProject } from './helpers.js';

/** 쿠키가 있어야 / 가 열리고, 없으면 /login 으로 보내는 작은 앱 */
function app(): Promise<{ url: string; close: () => void }> {
  const srv = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const authed = /ok=1/.test(req.headers.cookie ?? '');
    if (req.url === '/login' && req.method === 'POST') { res.writeHead(302, { 'Set-Cookie': 'ok=1; Path=/', Location: '/' }); res.end(); return; }
    if (req.url === '/login') { res.end('<form method=post action=/login><input name=u><input type=password name=p><button type=submit>로그인</button></form>'); return; }
    if (!authed) { res.writeHead(302, { Location: '/login' }); res.end(); return; }
    res.end('<h1>홈</h1>');
  });
  return new Promise((ok) => srv.listen(0, () => ok({ url: `http://localhost:${(srv.address() as { port: number }).port}`, close: () => srv.close() })));
}

test('테스트 계정이 있으면 로그인해 두고, 없으면 아무것도 하지 않는다', async (t) => {
  const pw = await import('playwright-core');
  let browser;
  try { browser = await pw.chromium.launch({ channel: 'chrome' }); } catch { t.skip('Chrome을 못 열어 건너뜀'); return; }
  const a = await app();
  const { root } = tempProject();
  try {
    const ctx = await browser.newContext();
    assert.equal(await loginIfConfigured(ctx, a.url, root), null);
    fs.writeFileSync(path.join(root, '.spec', 'local.json'), JSON.stringify({ login: { id: 'tester', password: 'pw' } }));
    const r = await loginIfConfigured(ctx, a.url, root);
    assert.equal(r?.ok, true, r?.text);
    const page = await ctx.newPage();
    await page.goto(a.url + '/');
    assert.equal(await page.locator('h1').innerText(), '홈');
  } finally { await browser.close(); a.close(); }
});

test('테스트 계정 파일(.spec/local.json)을 커밋하려 하면 막는다', () => {
  const { root } = tempProject();
  fs.writeFileSync(path.join(root, '.spec', 'local.json'), '{}');
  execFileSync('git', ['add', '-f', '.spec/local.json'], { cwd: root });
  const r = spawnSync(process.execPath, [LAUNCHER, 'precommit', root], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /local\.json/);
});
