#!/usr/bin/env node
// 존재 이유: 에이전트가 "테스트 요청"을 내기 전에 끝낼 때 확인(경고 0, 서버, 화면 열림, 설계서 보기 열림)을 말이 아니라 실행으로 거치게 하려고.
// 사용: node finish.mjs --src src --url http://localhost:5173 --routes /,/trips/1 [--root 프로젝트 루트(기본 현재 폴더)] [--out 폴더]
// 모두 통과해야 종료 코드 0. 하나라도 실패하면 상태는 "개발 중"이고 테스트 요청을 내지 않는다.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const src = arg('--src', 'src');
const root = path.resolve(arg('--root', '.')); // tsconfig.json이 있는 프로젝트 루트(analyze-ts가 필요)
const base = arg('--url', 'http://localhost:5173').replace(/\/$/, '');
const routes = arg('--routes', '/').split(',');
const out = arg('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'spec-finish-')));
fs.mkdirSync(out, { recursive: true });

const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? ' — ' + detail : ''}`); };
const run = (script) => { const r = spawnSync(process.execPath, [path.join(here, script), script === 'analyze-ts.mjs' ? root : src, '--check'], { encoding: 'utf8' }); return { ok: r.status === 0, text: (r.stdout + r.stderr).trim() }; };

// 1. 경고 0
for (const [label, script] of [['메타정보 경고 0 (extract)', 'extract.mjs'], ['정보 존재 이유 경고 0 (analyze-ts)', 'analyze-ts.mjs']]) {
  const r = run(script);
  step(label, r.ok, r.ok ? '' : r.text.split('\n').filter((l) => l.startsWith('경고')).slice(0, 5).join(' / '));
}

// 2. 서버
let serverUp = false;
try { serverUp = (await fetch(base + '/')).ok; } catch {}
step('개발 서버가 떠 있다', serverUp, serverUp ? base : `${base} 에 응답이 없다. 에이전트가 개발 서버를 직접 띄운 뒤 다시 실행한다`);

// 3. 브라우저로 화면과 설계서 보기 열기
if (serverUp) {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { step('브라우저 제어 설치', false, `${here} 에서 npm install`); }
  if (chromium) {
    let browser;
    try { browser = await chromium.launch({ channel: 'chrome' }); } catch (e) { step('Chrome 실행', false, String(e.message).split('\n')[0]); }
    if (browser) {
      for (const route of routes) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        // 아이콘(favicon) 없음은 오류로 세지 않는다
        page.on('console', (m) => { if (m.type() === 'error' && !/favicon\.ico/.test(m.location().url)) errors.push(m.text()); });
        const tag = route.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'root';
        try {
          await page.goto(base + route, { waitUntil: 'networkidle' });
          const body = (await page.locator('body').innerText()).trim();
          step(`${route} 화면이 열리고 오류가 없다`, errors.length === 0 && body.length > 0, errors.length ? errors.slice(0, 2).join(' / ') : body.length ? '' : '본문이 비어 있다');
          await page.screenshot({ path: path.join(out, `${tag}-screen.png`) });
          const fab = page.locator('.fab');
          const hasFab = (await fab.count()) > 0;
          step(`${route} 설계서 보기 토글이 보인다`, hasFab);
          if (hasFab) {
            await fab.first().click();
            await page.waitForTimeout(400);
            const cards = await page.locator('.card').count();
            step(`${route} 설계서 보기를 켜면 카드가 나온다`, cards > 0, `카드 ${cards}개`);
            await page.screenshot({ path: path.join(out, `${tag}-spec.png`) });
          }
        } catch (e) { step(`${route} 열기`, false, String(e.message).split('\n')[0]); }
        await page.close();
      }
      await browser.close();
    }
  }
}

const ok = results.every((r) => r.ok);
console.log(`\n스크린샷: ${out}`);
console.log(ok ? '결과: 통과 — 스크린샷을 눈으로 본 뒤 "테스트 요청"을 쓴다' : '결과: 실패 — 상태는 "개발 중". 테스트 요청을 내지 않는다');
process.exit(ok ? 0 : 1);
