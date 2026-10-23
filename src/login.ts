/**
 * @spec login-helper 로그인이 있는 앱 열기
 * @why 로그인이 있어야 화면이 열리는 앱은, 도구가 앱을 열 때마다 로그인 화면으로 가 버려 화면 위 부품(@anchor)이 실제로 찾히는지 확인할 수 없다. 테스트 계정으로 도구가 대신 로그인해 둔다.
 * @basis 계정은 커밋하지 않는 프로젝트의 .spec/local.json에 둔다. 로그인 화면의 입력칸은 앱마다 다르므로, 선택자를 안 주면 첫 글자 입력칸·비밀번호 칸·제출 단추를 찾아 쓴다. 로그인 뒤 상태(쿠키·저장소)는 같은 브라우저 안의 모든 페이지가 함께 쓴다.
 * @contract 로그인 정보가 탭별 sessionStorage에만 있어도 같은 주소의 다른 페이지가 로그인된 채로 열린다. 계정이 없으면 아무것도 하지 않는다. 로그인에 실패해도 도구가 멈추지 않고 이유를 돌려준다(확인은 건너뛰지 않고 로그인 화면 상태로 진행). 비밀번호는 로그나 보고에 쓰지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import type { LocalSettings, LoginSetting } from './types.js';

/** 프로젝트의 .spec/local.json (이 컴퓨터에만 둔다) */
export const localFile = (project: string): string => path.join(project, '.spec', 'local.json');

/** 이 컴퓨터에만 두는 설정을 읽는다. 없거나 깨졌으면 빈 설정 */
export function readLocal(project: string): LocalSettings {
  try { return JSON.parse(fs.readFileSync(localFile(project), 'utf8')) as LocalSettings; } catch { return {}; }
}

/** 설정된 테스트 계정이 있으면 앱 주소(base)에서 로그인한다. 결과 글을 돌려주고, 계정이 없으면 null */
export async function loginIfConfigured(context: BrowserContext, base: string, project: string): Promise<{ ok: boolean; text: string } | null> {
  const lg: LoginSetting | undefined = readLocal(project).login;
  if (!lg?.id || !lg.password) return null;
  const page = await context.newPage();
  try {
    // 설계서 보기 서버는 주소창으로 연 앱 화면을 뷰어로 보내 버리므로, 도구가 직접 여는 것임을 알린다
    await page.setExtraHTTPHeaders({ 'x-spec-direct': '1' });
    await page.goto(base.replace(/\/$/, '') + (lg.url || '/login'), { waitUntil: 'networkidle' });
    const idBox = lg.idSelector ? page.locator(lg.idSelector).first() : page.locator('input:not([type]), input[type=text], input[type=email]').first();
    const pwBox = page.locator(lg.passwordSelector || 'input[type=password]').first();
    await idBox.fill(lg.id, { timeout: 5000 });
    await pwBox.fill(lg.password, { timeout: 5000 });
    const before = page.url();
    const btn = lg.submitSelector ? page.locator(lg.submitSelector).first() : page.locator('button[type=submit], input[type=submit]').first();
    if (await btn.count()) await btn.click(); else { const byText = page.getByRole('button', { name: /로그인|login|sign in/i }).first(); if (await byText.count()) await byText.click(); else await pwBox.press('Enter'); }
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    const moved = page.url() !== before || (await page.locator('input[type=password]').count()) === 0;
    // 앱이 로그인 정보를 탭마다 따로인 sessionStorage에 두면 이 로그인 페이지를 닫는 순간 사라지므로, 같은 주소의 모든 페이지·프레임이 시작할 때 되살려 준다
    if (moved) {
      const kept = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage))).catch(() => ({} as Record<string, string>));
      if (Object.keys(kept).length) await context.addInitScript(({ origin, data }: { origin: string; data: Record<string, string> }) => {
        try { if (location.origin !== origin) return; for (const [k, v] of Object.entries(data)) if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v); } catch { /* 저장소를 못 쓰는 화면 */ }
      }, { origin: new URL(base).origin, data: kept });
    }
    return moved ? { ok: true, text: '로그인했다' } : { ok: false, text: '로그인 화면에서 벗어나지 못했다 — 아이디·비밀번호나 선택자(.spec/local.json)를 확인한다' };
  } catch (e) {
    return { ok: false, text: `로그인 실패: ${String(e instanceof Error ? e.message : e).split('\n')[0]}` };
  } finally { await page.close().catch(() => {}); }
}
