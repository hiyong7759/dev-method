/**
 * @spec snapshot 설계서 보기 모델의 마지막 결과
 * @why 화면이 모델을 받을 때마다 서버가 전체(요청·시안·리포트·git·소스 분석)를 다시 계산하면, 탭이 늘거나 데이터가 커질 때 응답이 갑자기 느려진다(요청 #107 — 계산 한 번 0.34초 × 탭 6개). 어떤 기능이 나중에 무거워져도 응답이 느려지지 않게, 계산은 바뀐 순간에 배경에서 하고 요청은 만들어 둔 마지막 결과를 돌려주기만 한다.
 * @basis 요청을 받는 파일(middleware.ts)은 buildModel·git·소스 분석을 직접 부르지 못하고 이 파일의 읽기 함수만 쓴다(test/request-path.test.ts가 가져오기를 검사한다). 다시 계산하는 때는 watch.ts의 바뀜 알림, 서버 시작, 사용자 조작 끝(refresh) 뿐이며 계산 중에 또 바뀌면 한 번 더 도는 것으로 합친다. 화면 쪽은 서버가 보내는 알림(events)을 받을 때만 새로 받는다.
 * @contract 읽기: latestModel(JSON 글)·latestTabs. 알림: onChange(모델 버전·탭 버전이 달라질 때). 계산 횟수는 builds로 센다(시험: 아무것도 안 바뀌면 늘지 않는다). 모델을 못 만들면 그 오류 글을 던지고 다음 바뀜에서 다시 만든다.
 */
import { buildModel } from './model.js';
import { termTabs, onTermChange } from './ttyd.js';
import { watchTriggers } from './watch.js';
import { extractSpecs } from './extract.js';
import { screenHistory } from './history.js';
import { errorText } from './cli.js';
import type { Model } from './types.js';

interface Snap {
  scanRoot: string;
  /** 마지막으로 만든 모델(JSON 글)과 오류 */
  json: string | null; error: string; model: Model | null;
  tabsJson: string;
  /** 모델·탭이 달라질 때마다 오르는 번호 */
  version: number; tabsVersion: number;
  /** 소스·git이 바뀔 때마다 오르는 번호(화면 이력 기억의 열쇠) */
  codeVersion: number;
  running: boolean; dirty: boolean;
  builds: number;
  ready: Promise<void>;
  listeners: Set<() => void>;
  history: Map<string, unknown>;
  stop: () => void;
}

const snaps = new Map<string, Snap>();

/** 이 소스 폴더의 마지막 결과를 만들고 바뀜을 지켜보기 시작한다(한 번만 만든다) */
export function startSnapshot(scanRoot: string): Snap {
  const had = snaps.get(scanRoot);
  if (had) return had;
  const s: Snap = {
    scanRoot, json: null, error: '', model: null, tabsJson: '', version: 0, tabsVersion: 0, codeVersion: 0, running: false, dirty: false, builds: 0,
    ready: Promise.resolve(), listeners: new Set(), history: new Map(), stop: () => undefined,
  };
  snaps.set(scanRoot, s);
  s.ready = new Promise<void>((ok) => { setImmediate(() => { run(s); ok(); }); });
  s.stop = watchTriggers(scanRoot, (k) => {
    if (k === 'src' || k === 'git') { s.codeVersion++; s.history.clear(); }
    run(s);
  });
  onTermChange(() => run(s));
  return s;
}

/** 지금 한 번 다시 만든다. 이미 만드는 중이면 끝난 뒤 한 번 더 만드는 것으로 합친다 */
function run(s: Snap): void {
  if (s.running) { s.dirty = true; return; }
  s.running = true;
  try {
    do {
      s.dirty = false;
      s.builds++;
      try {
        const m = buildModel(s.scanRoot);
        const json = JSON.stringify(m);
        // 모델을 만든 시각만 다르고 내용이 같으면 새 것으로 치지 않는다(알림을 보내지 않는다)
        if (strip(json) !== (s.json ? strip(s.json) : null) || s.error) { s.model = m; s.json = json; s.error = ''; s.version++; }
      } catch (e) { const t = errorText(e); if (t !== s.error) { s.error = t; s.version++; } }
      try {
        const t = JSON.stringify(termTabs(s.scanRoot));
        if (t !== s.tabsJson) { s.tabsJson = t; s.tabsVersion++; }
      } catch { /* 탭 목록을 못 만들어도 모델은 그대로 낸다 */ }
    } while (s.dirty);
  } finally { s.running = false; }
  for (const f of s.listeners) { try { f(); } catch { /* 듣는 쪽 오류가 계산을 막지 않게 */ } }
}

/** 모델을 만든 시각 값은 내용 비교에서 뺀다 */
const strip = (json: string): string => json.replace(/"generatedAt":"[^"]*"/g, '');

/** 지금 다시 만들어 달라고 알린다(사용자 조작으로 기록을 쓴 직후 등). 계산은 배경에서 한다 */
export function refresh(scanRoot: string): void {
  const s = startSnapshot(scanRoot);
  setImmediate(() => run(s));
}

/** 마지막 모델(JSON 글). 첫 결과가 나오기 전이면 그것을 기다린다 — 요청 길은 계산하지 않는다 */
export async function latestModelJson(scanRoot: string): Promise<string> {
  const s = startSnapshot(scanRoot);
  await s.ready;
  if (s.json == null) throw new Error(s.error || '모델을 아직 못 만들었다');
  return s.json;
}
/** 마지막 모델(객체). 쓰기 처리가 목록에서 항목을 찾을 때 쓴다 */
export async function latestModel(scanRoot: string): Promise<Model> {
  await latestModelJson(scanRoot);
  return startSnapshot(scanRoot).model as Model;
}
/** 마지막 터미널 탭 목록(JSON 글) */
export async function latestTabsJson(scanRoot: string): Promise<string> {
  const s = startSnapshot(scanRoot);
  await s.ready;
  return s.tabsJson || '{"live":[],"past":[],"available":false,"reason":""}';
}
/** 현재 번호들 */
export const versionsOf = (scanRoot: string): { model: number; tabs: number } => { const s = startSnapshot(scanRoot); return { model: s.version, tabs: s.tabsVersion }; };
/** 모델·탭이 달라질 때 부를 함수를 건다. 해제하는 함수를 돌려준다 */
export function onChange(scanRoot: string, fn: () => void): () => void {
  const s = startSnapshot(scanRoot);
  s.listeners.add(fn);
  return () => { s.listeners.delete(fn); };
}
/** 배경 계산 횟수(시험용) */
export const buildCount = (scanRoot: string): number => startSnapshot(scanRoot).builds;
/** 모든 지켜보기를 멈춘다(시험용) */
export function stopSnapshot(scanRoot: string): void { snaps.get(scanRoot)?.stop(); snaps.delete(scanRoot); }

/** 화면 이력: 사용자가 이력을 열 때(사용자 조작)만 하고, 소스·git이 바뀌기 전까지는 기억한 결과를 돌려준다 */
export async function historyOf(scanRoot: string, screen: string): Promise<unknown> {
  const s = startSnapshot(scanRoot);
  const model = await latestModel(scanRoot);
  const key = `${screen}|${s.codeVersion}`;
  if (s.history.has(key)) return s.history.get(key);
  await new Promise<void>((ok) => setImmediate(ok));
  const sc = extractSpecs(scanRoot).screens.find((x) => x.name === screen);
  const out = { items: sc ? screenHistory(scanRoot, sc, { specs: model.specs, screens: model.screens, infos: model.infos }) : [] };
  s.history.set(key, out);
  return out;
}
/** 주소로 화면을 찾는다(주소창으로 앱 화면을 직접 열 때): 만들어 둔 모델의 화면 목록에서 찾는다 */
export async function screenRoutes(scanRoot: string): Promise<{ name: string; routes: string[] }[]> {
  return (await latestModel(scanRoot)).screens.map((x) => ({ name: x.name, routes: x.routes ?? [] }));
}
