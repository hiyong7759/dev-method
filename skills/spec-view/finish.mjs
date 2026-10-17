#!/usr/bin/env node
// 존재 이유: 에이전트가 "테스트 요청"을 내기 전에 끝낼 때 확인(경고 0, 서버, 화면 열림, 설계서 보기 열림, 컴포넌트 위치)을 말이 아니라 실행으로 거치게 하려고.
// 사용: node finish.mjs --routes /trips,/trips/x/days/2 [--src src] [--url 설계서 보기 서버 주소] [--root 프로젝트 루트(기본 현재 폴더)] [--out 폴더]
// 설정: .spec/config.json의 src·port를 기본값으로 쓴다. --url은 serve.mjs 주소(기본 http://localhost:<port>)이지 앱 개발 서버 주소가 아니다
// 모두 통과해야 종료 코드 0. 하나라도 실패하면 상태는 "개발 중"이고 테스트 요청을 내지 않는다.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchScreen } from './viewer/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('--root', '.')); // tsconfig.json이 있는 프로젝트 루트(analyze-ts가 필요)
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'config.json'), 'utf8')); } catch { /* 설정 없음 */ }
const src = arg('--src', cfg.src || 'src');
const base = arg('--url', `http://localhost:${cfg.port || 5290}`).replace(/\/$/, '');
const routes = arg('--routes', '/').split(',');
const out = arg('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'spec-finish-')));
fs.mkdirSync(out, { recursive: true });

// 눌러 볼 수 있는 것들을 화면에 있는 그대로 설명하고(태그·글자·몇 번째), 같은 설명으로 다시 누를 수 있게 한다(설계서 보기의 '열어서 보기'도 같은 방식)
const DESCRIBE = () => {
  const norm = (e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const vis = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  return [...document.querySelectorAll('button,[role=button],[role=tab],summary')].filter(vis).map((e) => {
    const tag = e.tagName.toLowerCase(), text = norm(e);
    return { tag, text, nth: [...document.querySelectorAll(tag)].filter((x) => norm(x) === text).indexOf(e) };
  }).filter((d) => d.text);
};
const CLICK = (st) => {
  const norm = (e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const el = [...document.querySelectorAll(st.tag)].filter((x) => norm(x) === st.text)[st.nth]; if (el) el.click(); return !!el;
};
const results = [];
const reveal = {}; // 화면 이름 → { 컴포넌트 id → 누르는 순서 } (눌러야 나타나는 컴포넌트를 검사가 직접 찾아 기록)
const snaps = {}; // 화면 이름 → 저장한 화면 스냅샷 파일 (모두 통과하면 status.mjs set test-requested가 기록에 붙인다)
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? ' — ' + detail : ''}`); };
const run = (script) => { const r = spawnSync(process.execPath, [path.join(here, script), script === 'extract.mjs' ? src : root, ...(script === 'nav.mjs' ? ['--src', src] : []), '--check'], { encoding: 'utf8' }); return { ok: r.status === 0, text: (r.stdout + r.stderr).trim() }; };

// 1. 경고 0
for (const [label, script] of [['메타정보 경고 0 (extract)', 'extract.mjs'], ['정보 존재 이유 경고 0 (analyze-ts)', 'analyze-ts.mjs'], ['이동 선언(@to)이 코드와 같다 (nav)', 'nav.mjs']]) {
  const r = run(script);
  step(label, r.ok, r.ok ? '' : r.text.split('\n').filter((l) => l.startsWith('경고')).slice(0, 5).join(' / '));
}

// 2. 서버와 설계서 보기 모델
let model = null;
try { model = await (await fetch(base + '/__spec/model.json')).json(); } catch {}
step('설계서 보기 서버가 응답한다', !!model, model ? `${base} · 화면 ${model.screens.length}개` : `${base}/__spec/model.json 에 응답이 없다. 앱 개발 서버와 serve.mjs(node <스킬 폴더>/serve.mjs --project .)를 에이전트가 직접 띄운 뒤 다시 실행한다`);

// 3. 브라우저로 화면과 설계서 보기 열기
if (model) {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { step('브라우저 제어 설치', false, `${here} 에서 npm install`); }
  if (chromium) {
    let browser;
    try { browser = await chromium.launch({ channel: 'chrome' }); } catch (e) { step('Chrome 실행', false, String(e.message).split('\n')[0]); }
    if (browser) {
      // 설계서 보기 주소(base 또는 base/)가 화면 흐름으로 열린다
      {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        try {
          await page.goto(base + '/', { waitUntil: 'networkidle' });
          await page.waitForSelector('.top', { timeout: 5000 }).catch(() => {});
          const onMap = /__spec/.test(page.url()) && (await page.locator('.tabs-top button.sel', { hasText: '화면 흐름' }).count()) > 0;
          step('중계 서버 첫 화면이 설계서의 화면 흐름이다', onMap && errors.length === 0, onMap ? (errors[0] || '') : `열린 주소 ${page.url()}`);
          await page.screenshot({ path: path.join(out, 'map.png') });
        } catch (e) { step('설계서 첫 화면 열기', false, String(e.message).split('\n')[0]); }
        await page.close();
      }
      for (const route of routes) {
        const sc = matchScreen(model, route.split(/[?#]/)[0]); // 쿼리(?editTripId=…)는 @route 비교에서 뺀다
        step(`${route} 이 주소가 @screen의 @route와 맞는다`, !!sc, sc ? `화면 "${sc.name}"` : '맞는 @screen @route가 없다 — 설계서 보기가 이 화면을 찾지 못한다');
        if (!sc) continue;
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        // 아이콘(favicon) 없음은 오류로 세지 않는다
        page.on('console', (m) => { if (m.type() === 'error' && !/favicon\.ico/.test(m.location().url)) errors.push(m.text()); });
        const tag = route.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'root';
        try {
          await page.goto(`${base}/__spec/#/screen/${encodeURIComponent(sc.name)}?tab=overview&at=${encodeURIComponent(route)}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('.shead .nm', { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(900);
          const shown = await page.locator('.shead .nm').innerText().catch(() => '');
          step(`${route} 화면 설계서 "${sc.name}"가 열린다`, shown === sc.name, shown ? '' : '화면 설계서가 열리지 않았다');
          const body = (await page.frameLocator('iframe').locator('body').innerText().catch(() => '')).trim();
          step(`${route} 실제 화면이 열리고 오류가 없다`, errors.length === 0 && body.length > 0, errors.length ? errors.slice(0, 2).join(' / ') : body.length ? '' : '화면 본문이 비어 있다');
          // 변경 전·후 비교용 화면 스냅샷: 설계서 표시가 없는 실제 화면만 저장한다
          try {
            const dir = path.join(root, '.spec', 'shots'); fs.mkdirSync(dir, { recursive: true });
            const name = `ver-${tag}-${Date.now()}.png`;
            await page.locator('.stage').screenshot({ path: path.join(dir, name) });
            snaps[sc.name] = name;
          } catch { /* 스냅샷 실패는 검사 실패가 아니다 */ }
          await page.locator('.tabs button', { hasText: '컴포넌트' }).click(); await page.waitForTimeout(700);
          const mine = model.specs.filter((x) => x.screens.includes(sc.name) && x.kind === 'dom' && x.anchor);
          const frame = page.frames().find((f) => f !== page.mainFrame());
          const isThere = (f, list) => f.evaluate((sels) => sels.map((q) => { try { return !!document.querySelector(q); } catch { return false; } }), list.map((x) => x.anchor.slice(4)));
          let there = frame ? await isThere(frame, mine) : mine.map(() => false);
          let missing = mine.filter((_, i) => !there[i]);
          const initial = missing.length;
          const revealed = {};
          // 처음 화면에 없는 것은 눌러야 나타나는 것일 수 있다: 눌러 볼 수 있는 것을 하나씩(최대 두 번 연달아) 눌러 보며 찾는다
          if (missing.length && frame) {
            const url = frame.url(); const t0 = Date.now(); let probes = 0;
            const reset = async () => { await frame.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(350); };
            const apply = async (steps) => { await reset(); for (const st of steps) { await frame.evaluate(CLICK, st); await page.waitForTimeout(300); } };
            const check = async (steps) => {
              if (new URL(frame.url()).pathname !== new URL(url).pathname) return; // 다른 화면으로 가 버리면 이 화면에서 나타난 것이 아니다
              const now = await isThere(frame, missing);
              missing.forEach((m, i) => { if (now[i]) revealed[m.id] = steps; });
              missing = missing.filter((m) => !revealed[m.id]);
            };
            await reset();
            const first = await frame.evaluate(DESCRIBE);
            const key = (d) => `${d.tag}|${d.text}|${d.nth}`; const base = new Set(first.map(key));
            for (const d of first) {
              if (!missing.length || probes > 70 || Date.now() - t0 > 30000) break;
              probes++; await apply([d]); await check([d]);
              if (!missing.length) break;
              const next = (await frame.evaluate(DESCRIBE)).filter((x) => !base.has(key(x))).slice(0, 12); // 누르고 나서 새로 생긴 것(두 번째 눌러 볼 것)
              for (const d2 of next) {
                if (!missing.length || probes > 70 || Date.now() - t0 > 30000) break;
                probes++; await apply([d, d2]); await check([d, d2]);
              }
            }
            await reset();
          }
          if (Object.keys(revealed).length) reveal[sc.name] = revealed;
          const tell = Object.entries(revealed).map(([id, st]) => `${mine.find((m) => m.id === id).title}(${st.map((x) => `"${x.text}"`).join(' → ')}를 누르면)`).join(', ');
          step(`${route} 컴포넌트의 @anchor가 실제 화면에서 모두 찾힌다`, missing.length === 0,
            missing.length ? `${missing.map((m) => m.title).join(', ')} — 처음 화면과 눌러 볼 수 있는 것을 눌러 봐도 나타나지 않는다. @anchor 선택자를 고치거나, 조건·데이터에 따라서만 나타나는 요소인지 확인한다` : `화면 요소 ${mine.length}개 모두 찾음${tell ? ` (${Object.keys(revealed).length}개는 눌러야 나타나 자동으로 찾아 기록: ${tell})` : ''}`);
          await page.locator('.tabs button', { hasText: '컴포넌트' }).click();
          await page.screenshot({ path: path.join(out, `${tag}-spec.png`) });
        } catch (e) { step(`${route} 열기`, false, String(e.message).split('\n')[0]); }
        await page.close();
      }
      await browser.close();
    }
  }
}

const ok = results.every((r) => r.ok);
// 눌러야 나타나는 컴포넌트를 찾은 결과는 설계서 보기가 '열어서 보기'에 쓴다(.spec/reveal.json, 검사가 만드는 파일이라 직접 고치지 않는다)
if (Object.keys(reveal).length) { const f = path.join(root, '.spec', 'reveal.json'); let old = {}; try { old = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ ...old, ...reveal }, null, 2) + '\n'); }
if (ok && Object.keys(snaps).length) { fs.mkdirSync(path.join(root, '.spec'), { recursive: true }); fs.writeFileSync(path.join(root, '.spec', 'pending-shots.json'), JSON.stringify(snaps)); }
console.log(`\n스크린샷: ${out}`);
console.log(ok ? '결과: 통과 — 스크린샷을 눈으로 본 뒤 "테스트 요청"을 쓴다(저장한 화면 스냅샷이 테스트 요청 기록에 붙는다)' : '결과: 실패 — 상태는 "개발 중". 테스트 요청을 내지 않는다');
process.exit(ok ? 0 : 1);
