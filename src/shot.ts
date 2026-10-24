/**
 * @spec live-shot 운영 화면 현행 촬영
 * @why 설계 시안은 바꾸기 전 모습(현행)과 비교해야 하는데, 사람이 행을 숨기거나 지난 시안을 현행으로 올리면 비교가 틀어진다. 도구가 지금 운영 중인 화면을 손대지 않고 그대로 찍어 현행 그림으로 저장하고, 찍은 시각과 주소를 남긴다.
 * @basis 화면을 여는 브라우저는 ego-browser만 쓴다(크롬을 직접 띄우지 않는다, 사용자 결정). ego-browser의 nodejs는 환경변수를 못 받아 찍을 곳과 파일 이름을 스크립트 글에 직접 적어 넘긴다.
 * @contract 설계서 보기 서버(설정의 포트)나 앱이 떠 있고 `ego-browser` 명령이 있어야 한다. 화면 이름마다 .spec/live-shots/<요청>/<화면>.png와 같은 이름의 .json(찍은 시각·주소)을 쓰고, 설계를 올릴 때(request design) 그림 파일이 없는 이미 있는 화면은 이 그림을 현행으로 붙인다. 선택자를 주면 그 부분만, 없으면 보이는 화면 전체를 찍는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { liveShotFile } from './request.js';

/** 찍은 결과 */
export interface LiveShot {
  /** 그림 파일 */
  file: string;
  /** 찍은 때 */
  capturedAt: string;
  /** 연 주소 */
  url: string;
}

/** ego-browser에 넘기는 스크립트: 주소를 처음부터 새로 열고(해시 주소만 바뀌면 다시 안 열리므로) 잠시 기다린 뒤 찍는다 */
function script(file: string, url: string, selector: string): string {
  return `
const task = await taskSpace("현행 촬영");
const page = task.page("p1");
await page.goto("about:blank");
await page.goto(${JSON.stringify(url)});
await new Promise((r) => setTimeout(r, 2500));
const sel = ${JSON.stringify(selector)};
let clip;
if (sel) {
  clip = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height }; }, sel);
  if (!clip) throw new Error("선택자를 못 찾음: " + sel);
}
await page.screenshot({ path: ${JSON.stringify(file)}, ...(clip ? { clip } : {}) });
console.log("찍음");
`;
}

/** 운영 화면을 열어 있는 그대로 찍어 저장한다 */
export async function captureLive(scanRoot: string, id: number, screen: string, o: { url?: string; selector?: string }): Promise<LiveShot> {
  if (!screen) throw new Error('--screen에 화면 이름을 적어야 한다');
  if (!o.url) throw new Error('--url에 찍을 운영 화면 주소를 적어야 한다(예: http://localhost:5291/__spec/#/manage)');
  const file = liveShotFile(scanRoot, id, screen);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  const run = spawnSync('ego-browser', ['nodejs'], { input: script(file, o.url, o.selector ?? ''), encoding: 'utf8', timeout: 120000 });
  if (run.error) throw new Error(`ego-browser를 실행하지 못했다(${run.error.message}). ego-browser 스킬의 설치 안내를 따른다`);
  if (run.status !== 0 || !fs.existsSync(file)) throw new Error(`ego-browser로 찍지 못했다: ${(run.stderr || run.stdout).trim().split('\n').slice(-3).join(' / ')}`);
  const capturedAt = new Date().toISOString();
  fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify({ capturedAt, url: o.url, selector: o.selector ?? '' }, null, 2) + '\n');
  return { file, capturedAt, url: o.url };
}
