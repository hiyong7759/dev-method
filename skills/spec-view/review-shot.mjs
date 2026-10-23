// 검토용 캡처: 바꾼 부분만 잘라 찍고, 같은 이름의 지난번 캡처가 있으면 이전/지금을 나란히 붙인 그림도 만든다.
// 직접 부르지 않고 review-shot.sh로 부른다(ego-browser의 nodejs는 환경변수를 못 받아 설정을 글로 앞에 붙여 넘긴다).
import fs from 'node:fs';
import path from 'node:path';

const cfg = globalThis.SHOT || {};
const url = cfg.url;
const name = cfg.name || 'shot';
const areas = cfg.areas || [['전체', '']];
const dir = path.join(cfg.dir, name);
if (!url || !cfg.dir) throw new Error('설정이 없다 — review-shot.sh로 부른다');
fs.mkdirSync(dir, { recursive: true });

const task = await taskSpace('review shot');
const page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 2, mobile: false });
await page.goto(url);
await page.reload();
await new Promise((r) => setTimeout(r, (cfg.wait || 3000)));

// 화면보다 긴 구역도 잘리지 않게, 문서 높이만큼 창을 늘린다
const tall = await page.evaluate(() => document.documentElement.scrollHeight);
if (tall > 980) { await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: Math.min(tall, 8000), deviceScaleFactor: 2, mobile: false }); await new Promise((r) => setTimeout(r, 300)); }

const out = [];
// 1) 구역을 모두 먼저 찍는다(비교 그림을 만들려고 화면을 옮기면 뒤의 구역이 다른 상태로 찍히므로)
for (const [label, selector] of areas) {
  const file = path.join(dir, `${label}.png`);
  const prev = path.join(dir, `${label}.prev.png`);
  if (fs.existsSync(file)) fs.copyFileSync(file, prev);
  let clip;
  if (selector) {
    clip = await page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height }; }, selector);
    if (!clip) { out.push({ label, error: `선택자 ${selector}를 못 찾음` }); continue; }
  }
  await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  out.push({ label, now: file, ...(fs.existsSync(prev) ? { prev } : {}) });
}
// 2) 지난번 캡처가 있는 구역은 이전|지금을 나란히 붙인 그림을 만든다
for (const item of out) {
  if (!item.prev) continue;
  const html = path.join(dir, `${item.label}.compare.html`);
  fs.writeFileSync(html, `<!doctype html><meta charset=utf-8><body style="margin:0;background:#222;color:#eee;font:14px sans-serif;display:flex;gap:16px;padding:16px;align-items:flex-start"><div><div style="margin:0 0 6px">이전</div><img src="file://${item.prev}" style="max-width:700px;border:1px solid #555"></div><div><div style="margin:0 0 6px">지금</div><img src="file://${item.now}" style="max-width:700px;border:1px solid #555"></div>`);
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1480, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto('file://' + html);
  await new Promise((r) => setTimeout(r, 400));
  item.compare = path.join(dir, `${item.label}.compare.png`);
  await page.screenshot({ path: item.compare, fullPage: true });
}
console.log(JSON.stringify(out, null, 1));
