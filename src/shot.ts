/**
 * @spec live-shot 운영 화면 현행 촬영
 * @why 설계 시안은 바꾸기 전 모습(현행)과 비교해야 하는데, 사람이 행을 숨기거나 지난 시안을 현행으로 올리면 비교가 틀어진다. 도구가 지금 운영 중인 화면을 손대지 않고 그대로 찍어 현행 그림으로 저장하고, 찍은 시각과 주소를 남긴다.
 * @contract 설계서 보기 서버(설정의 포트)나 앱이 떠 있어야 하고, 컴퓨터의 Chrome으로 연다. 화면 이름마다 .spec/live-shots/<요청>/<화면>.png와 같은 이름의 .json(찍은 시각·주소)을 쓰고, 설계를 올릴 때(request design) 그림 파일이 없는 이미 있는 화면은 이 그림을 현행으로 붙인다. 선택자를 주면 그 부분만, 없으면 보이는 화면 전체를 찍는다.
 */
import fs from 'node:fs';
import path from 'node:path';
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

/** 운영 화면을 열어 있는 그대로 찍어 저장한다 */
export async function captureLive(scanRoot: string, id: number, screen: string, o: { url?: string; selector?: string }): Promise<LiveShot> {
  if (!screen) throw new Error('--screen에 화면 이름을 적어야 한다');
  if (!o.url) throw new Error('--url에 찍을 운영 화면 주소를 적어야 한다(예: http://localhost:5291/__spec/#/manage)');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(o.url, { waitUntil: 'networkidle' });
    await new Promise((ok) => setTimeout(ok, 1200));
    const file = liveShotFile(scanRoot, id, screen);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (o.selector) await page.locator(o.selector).first().screenshot({ path: file });
    else await page.screenshot({ path: file });
    const capturedAt = new Date().toISOString();
    fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify({ capturedAt, url: o.url, selector: o.selector ?? '' }, null, 2) + '\n');
    return { file, capturedAt, url: o.url };
  } finally { await browser.close(); }
}
