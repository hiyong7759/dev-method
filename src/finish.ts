/**
 * @spec finish 끝낼 때 확인
 * @why 에이전트가 "테스트 요청"을 내기 전에, 끝낼 때 확인(경고 0, 서버, 화면 열림, 설계서 보기 열림, 컴포넌트 위치)을 말이 아니라 실행으로 거치게 한다. 모두 통과해야 종료 코드 0이고, 하나라도 실패하면 상태는 "개발 중"이라 테스트 요청을 내지 않는다.
 * @basis 설정은 .spec/config.json의 src와 port를 기본값으로 쓴다. --url은 설계서 보기 서버(serve) 주소이지 앱 개발 서버 주소가 아니다. 컴퓨터의 Chrome을 쓴다(내려받지 않는다).
 * @contract 눌러야 나타나는 컴포넌트를 찾은 결과는 .spec/reveal.json에 기록하고(검사가 만드는 파일이라 직접 고치지 않는다) 설계서 보기가 "열어서 보기"에 쓴다. 화면 스냅샷은 .spec/shots에 저장하고, 모두 통과하면 pending-shots.json에 적어 status set test-requested가 기록에 붙인다. 화면 안에서 실행하는 함수는 글자로 바꿔 보내므로, 변환 도구가 끼우는 __name 도우미를 화면에 먼저 준비해 둔다.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { Browser, Frame, Page } from 'playwright-core';
import { LAUNCHER, ROOT_DIR } from './paths.js';
import { readConfig } from './config.js';
import { parseArgs, errorText } from './cli.js';
import { matchScreen } from './viewer/util.js';
import { runStep } from './viewer/steps.js';
import type { Model, RevealStep, Spec } from './types.js';

/** 확인 항목 하나의 결과 */
interface Result { name: string; ok: boolean; warned: boolean; detail: string }
/** 화면에서 눌러 볼 수 있는 것 하나: 태그, 글자, 같은 글자 중 몇 번째 */
interface Pressable { tag: string; text: string; nth: number }

/** 눌러 볼 수 있는 것들을 화면에 있는 그대로 설명한다(설계서 보기의 '열어서 보기'도 같은 설명으로 다시 누른다). 화면 안에서 실행된다 */
const DESCRIBE = (): Pressable[] => {
  const norm = (e: Element): string => ((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  return [...document.querySelectorAll('button,[role=button],[role=tab],summary')].filter(vis).map((e) => {
    const tag = e.tagName.toLowerCase(), text = norm(e);
    return { tag, text, nth: [...document.querySelectorAll(tag)].filter((x) => norm(x) === text).indexOf(e) };
  }).filter((d) => d.text);
};
/** 한 단계를 화면 안에서 실행한다. 설계서 보기와 같은 함수(viewer/steps.ts)를 글자로 받아 쓴다. 변환 도구가 끼우는 __name을 함께 넘긴다 */
const CLICK = ({ fn, st }: { fn: string; st: RevealStep }): boolean => (new Function('__name', 'return ' + fn) as (n: (f: unknown) => unknown) => (d: Document, s: RevealStep) => boolean)((f) => f)(document, st);
/** 화면(문서)이 새로 열릴 때마다 먼저 실행해 __name 도우미를 준비한다 */
const NAME_HELPER = 'globalThis.__name = (f) => f;';

/** 명령: finish --routes /a,/b [--src src] [--url 서버 주소] [--root 프로젝트 루트] [--out 폴더] */
export async function main(argv: string[]): Promise<number | undefined> {
  const { opts } = parseArgs(argv);
  const root = path.resolve(opts.root || '.'); // tsconfig.json이 있는 프로젝트 루트(analyze-ts가 필요)
  const cfg = readConfig(root);
  const src = opts.src || cfg.src || 'src';
  const base = (opts.url || `http://localhost:${cfg.port || 5290}`).replace(/\/$/, '');
  const routes = (opts.routes || '/').split(',');
  const out = opts.out || fs.mkdtempSync(path.join(os.tmpdir(), 'spec-finish-'));
  fs.mkdirSync(out, { recursive: true });

  const results: Result[] = [];
  const reveal: Record<string, Record<string, RevealStep[]>> = {}; // 화면 이름 → { 컴포넌트 id → 누르는 순서 } (눌러야 나타나는 컴포넌트를 검사가 직접 찾아 기록)
  const snaps: Record<string, string> = {}; // 화면 이름 → 저장한 화면 스냅샷 파일 (모두 통과하면 status set test-requested가 기록에 붙인다)
  // warn: 못 맞혀도 막지 않는 항목(검사의 한계 때문에 틀릴 수 있는 것). 경고로 알리고 보고에 쓰게 한다
  const step = (name: string, ok: boolean, detail = '', { warn = false } = {}): void => {
    results.push({ name, ok: ok || warn, warned: !ok && warn, detail });
    console.log(`${ok ? '통과' : warn ? '경고' : '실패'}  ${name}${detail ? ' — ' + detail : ''}`);
  };
  const run = (script: string): { ok: boolean; text: string } => {
    const r = spawnSync(process.execPath, [LAUNCHER, script, script === 'extract' ? src : root, ...(script === 'nav' ? ['--src', src] : []), '--check'], { encoding: 'utf8' });
    return { ok: r.status === 0, text: (r.stdout + r.stderr).trim() };
  };

  // 1. 경고 0
  for (const [label, script] of [['메타정보 경고 0 (extract)', 'extract'], ['정보 존재 이유 경고 0 (analyze-ts)', 'analyze-ts'], ['이동 선언(@to)이 코드와 같다 (nav)', 'nav']]) {
    const r = run(script);
    step(label, r.ok, r.ok ? '' : r.text.split('\n').filter((l) => l.startsWith('경고')).slice(0, 5).join(' / '));
  }

  // 2. 서버와 설계서 보기 모델
  let model: Model | null = null;
  try { model = await (await fetch(base + '/__spec/model.json')).json() as Model; } catch { /* 응답 없음 */ }
  step('설계서 보기 서버가 응답한다', !!model, model ? `${base} · 화면 ${model.screens.length}개` : `${base}/__spec/model.json 에 응답이 없다. 앱 개발 서버와 설계서 보기 서버(node <스킬 폴더>/spec.mjs serve --project .)를 에이전트가 직접 띄운 뒤 다시 실행한다`);

  // 3. 브라우저로 화면과 설계서 보기 열기
  if (model) {
    let playwright: typeof import('playwright-core') | null = null;
    try { playwright = await import('playwright-core'); } catch { step('브라우저 제어 설치', false, `${ROOT_DIR} 에서 npm install`); }
    let browser: Browser | null = null;
    if (playwright) { try { browser = await playwright.chromium.launch({ channel: 'chrome' }); } catch (e) { step('Chrome 실행', false, errorText(e).split('\n')[0]); } }
    if (browser) {
      const open = async (): Promise<Page> => { const p = await (browser as Browser).newPage({ viewport: { width: 1280, height: 800 } }); await p.addInitScript(NAME_HELPER); return p; };
      // 설계서 보기 주소(base 또는 base/)가 사용 흐름으로 열린다
      {
        const page = await open();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        try {
          await page.goto(base + '/', { waitUntil: 'networkidle' });
          await page.waitForSelector('.top', { timeout: 5000 }).catch(() => {});
          const onMap = /__spec/.test(page.url()) && (await page.locator('.tabs-top button.sel', { hasText: '사용 흐름' }).count()) > 0;
          step('중계 서버 첫 화면이 설계서의 사용 흐름이다', onMap && errors.length === 0, onMap ? (errors[0] || '') : `열린 주소 ${page.url()}`);
          await page.screenshot({ path: path.join(out, 'map.png') });
        } catch (e) { step('설계서 첫 화면 열기', false, errorText(e).split('\n')[0]); }
        await page.close();
      }
      for (const route of routes) {
        const sc = matchScreen(model, route.split(/[?#]/)[0]); // 쿼리(?editTripId=…)는 @route 비교에서 뺀다
        step(`${route} 이 주소가 @screen의 @route와 맞는다`, !!sc, sc ? `화면 "${sc.name}"` : '맞는 @screen @route가 없다 — 설계서 보기가 이 화면을 찾지 못한다');
        if (!sc) continue;
        const page = await open();
        const errors: string[] = [];
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
          const mine: Spec[] = model.specs.filter((x) => x.screens.includes(sc.name) && x.kind === 'dom' && x.anchor);
          let frame: Frame | undefined = page.frames().find((f) => f !== page.mainFrame());
          const cur = (): Frame => { if (!frame) throw new Error('화면 프레임이 없다'); return frame; };
          const specUrl = page.url();
          const isThere = (f: Frame, list: Spec[]): Promise<boolean[]> => f.evaluate((sels: string[]) => sels.map((q) => { try { return !!document.querySelector(q); } catch { return false; } }), list.map((x) => x.anchor.slice(4)));
          const there = frame ? await isThere(frame, mine) : mine.map(() => false);
          let missing = mine.filter((_, i) => !there[i]);
          const revealed: Record<string, RevealStep[]> = {};
          // 처음 화면에 없는 것은 눌러야 나타나는 것일 수 있다: 눌러 볼 수 있는 것을 하나씩(최대 두 번 연달아) 눌러 보며 찾는다
          if (missing.length && frame) {
            const url = frame.url();
            const t0 = Date.now();
            let probes = 0;
            // 뒤로 가기 같은 버튼은 눌러 보면 화면 밖으로 나가 프레임이 끊긴다 — 그러면 설계서 보기를 다시 열어 이어 간다
            const reset = async (): Promise<void> => {
              try { await cur().goto(url, { waitUntil: 'load' }); } catch { await page.goto(specUrl, { waitUntil: 'networkidle' }); await page.waitForTimeout(900); frame = page.frames().find((f) => f !== page.mainFrame()); }
              await page.waitForTimeout(350);
            };
            const safe = async (fn: () => Promise<unknown>): Promise<boolean> => { try { await fn(); return true; } catch { return false; } };
            const apply = async (steps: RevealStep[]): Promise<boolean> => {
              await reset();
              for (const st of steps) { if (!(await safe(() => cur().evaluate(CLICK, { fn: runStep.toString(), st })))) return false; await page.waitForTimeout(300); }
              return true;
            };
            const check = async (steps: RevealStep[]): Promise<void> => {
              if (!(await safe(async () => cur().url()))) return;
              if (new URL(cur().url()).pathname !== new URL(url).pathname) return; // 다른 화면으로 가 버리면 이 화면에서 나타난 것이 아니다
              let now: boolean[];
              try { now = await isThere(cur(), missing); } catch { return; }
              missing.forEach((m, i) => { if (now[i]) revealed[m.id] = steps; });
              missing = missing.filter((m) => !revealed[m.id]);
            };
            // 소스에 @open(여는 순서)이 적힌 것은 그 순서대로 먼저 열어 본다
            for (const m of [...missing].filter((x) => x.open.length)) { if (await apply(m.open)) await check(m.open); }
            await reset();
            const first = await cur().evaluate(DESCRIBE);
            const key = (d: Pressable): string => `${d.tag}|${d.text}|${d.nth}`;
            const seenFirst = new Set(first.map(key));
            for (const d of first) {
              if (!missing.length || probes > 70 || Date.now() - t0 > 30000) break;
              probes++;
              if (!(await apply([d]))) continue;
              await check([d]);
              if (!missing.length) break;
              const next = (await cur().evaluate(DESCRIBE).catch(() => [] as Pressable[])).filter((x) => !seenFirst.has(key(x))).slice(0, 12); // 누르고 나서 새로 생긴 것(두 번째 눌러 볼 것)
              for (const d2 of next) {
                if (!missing.length || probes > 70 || Date.now() - t0 > 30000) break;
                probes++;
                if (!(await apply([d, d2]))) continue;
                await check([d, d2]);
              }
            }
            await reset();
          }
          if (Object.keys(revealed).length) reveal[sc.name] = revealed;
          const tell = Object.entries(revealed).map(([id, st]) => `${mine.find((m) => m.id === id)?.title ?? id}(${st.map((x) => `"${x.text}"`).join(' → ')}를 누르면)`).join(', ');
          step(`${route} 컴포넌트의 @anchor가 실제 화면에서 모두 찾힌다`, missing.length === 0,
            missing.length ? `${missing.map((m) => `${m.title}${m.open.length ? '(@open 순서로 열어도 안 나타남)' : ''}`).join(', ')} — 화면에서 못 찾았다. ① @anchor 선택자가 실제 화면의 요소와 맞는지 보고 틀리면 고친다 ② 맞는데 처음에는 숨어 있는 요소면 그 @spec에 열기 순서를 쓴다(@open 누르기 글자 → 입력 칸이름=값 → 엔터). 고친 뒤 다시 실행해 통과하는지 확인한다 (테스트 요청은 막지 않는다)` : `화면 요소 ${mine.length}개 모두 찾음${tell ? ` (${Object.keys(revealed).length}개는 눌러야 나타나 자동으로 찾아 기록: ${tell})` : ''}`, { warn: true });
          await page.locator('.tabs button', { hasText: '컴포넌트' }).click();
          await page.screenshot({ path: path.join(out, `${tag}-spec.png`) });
        } catch (e) { step(`${route} 열기`, false, errorText(e).split('\n')[0]); }
        await page.close();
      }
      await browser.close();
    }
  }

  const ok = results.every((r) => r.ok);
  // 눌러야 나타나는 컴포넌트를 찾은 결과는 설계서 보기가 '열어서 보기'에 쓴다(.spec/reveal.json, 검사가 만드는 파일이라 직접 고치지 않는다)
  if (Object.keys(reveal).length) {
    const f = path.join(root, '.spec', 'reveal.json');
    let old: Record<string, unknown> = {};
    try { old = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>; } catch { /* 없음 */ }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ ...old, ...reveal }, null, 2) + '\n');
  }
  if (ok && Object.keys(snaps).length) { fs.mkdirSync(path.join(root, '.spec'), { recursive: true }); fs.writeFileSync(path.join(root, '.spec', 'pending-shots.json'), JSON.stringify(snaps)); }
  console.log(`\n스크린샷: ${out}`);
  const warns = results.filter((r) => r.warned).length;
  console.log(ok ? `결과: 통과${warns ? ` (경고 ${warns}건 — 막지 않지만 보고에 쓴다)` : ''} — 스크린샷을 눈으로 본 뒤 "테스트 요청"을 쓴다(저장한 화면 스냅샷이 테스트 요청 기록에 붙는다)` : '결과: 실패 — 상태는 "개발 중". 테스트 요청을 내지 않는다');
  return ok ? 0 : 1;
}
