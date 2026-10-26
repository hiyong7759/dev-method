/**
 * @spec stale-server 서버가 옛 코드로 떠 있는지 알아보기
 * @why 화면 코드(src/viewer)는 파일에서 바로 읽혀 늘 새것인데 서버 코드는 뜰 때의 옛 코드라, 둘이 어긋나면 화면이 새 모델 항목을 못 읽어 "모델을 읽지 못했다"로 안 열린다(#81 구현 중 발생). 어긋난 사실을 화면 맨 위에서 알려 사용자가 다시 띄우게 한다.
 * @contract 도구 소스(SRC_DIR) 파일의 가장 늦은 수정 시각을 서버가 뜰 때 한 번 기억하고, 모델을 만들 때마다 지금 값과 비교한다(5초 안에는 다시 훑지 않는다). 더 새로우면 다시 띄우는 명령을 돌려준다. 서버를 스스로 다시 띄우지는 않는다(진행 중인 세션 깨움이 끊길 수 있다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { LAUNCHER, SRC_DIR } from './paths.js';

/** 도구 소스에서 가장 나중에 고친 시각(ms). 소스를 못 읽으면 0 */
export function srcMtime(): number {
  let m = 0;
  const walk = (d: string): void => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else m = Math.max(m, fs.statSync(f).mtimeMs); } };
  try { walk(SRC_DIR); } catch { /* 소스를 못 읽으면 표 없음 */ }
  return m;
}

/** 이 서버가 뜰 때의 소스 수정 시각 */
const startedWith = srcMtime();
let checked = { at: 0, newer: false };

/** 서버가 옛 코드로 떠 있으면 다시 띄우는 명령을, 아니면 null */
export function staleServer(project: string, now = Date.now()): { command: string } | null {
  if (now - checked.at > 5000) checked = { at: now, newer: srcMtime() > startedWith };
  return checked.newer ? { command: `node ${LAUNCHER} open ${project} --no-open` } : null;
}
