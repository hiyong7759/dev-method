/**
 * @spec stale-server 서버가 옛 코드로 떠 있는지 알아보고 새 코드로 갈아 띄우기
 * @why 화면 코드(src/viewer)는 파일에서 바로 읽혀 늘 새것인데 서버 코드는 뜰 때의 옛 코드라, 둘이 어긋나면 화면이 새 모델 항목을 못 읽어 "모델을 읽지 못했다"로 안 열린다(#81 구현 중 발생, 테스트 서버 5391에서도). 사용자가 터미널 명령을 치게 하지 않으려고 도구가 스스로 서버를 새 코드로 갈아 띄운다.
 * @contract 도구 소스(SRC_DIR) 파일의 가장 늦은 수정 시각(표)을 서버가 뜰 때 한 번 기억하고 모델에 싣는다(serverStamp). 모델을 만들 때마다 지금 값과 비교한다(5초 안에는 다시 훑지 않는다). 서버가 옛 코드이면 1분 점검(serve.ts)이 handOver로 같은 설정의 새 서버를 띄우고 자기는 물러난다. 응답한 서버가 새 코드인지는 모델의 serverStamp가 지금 소스 표와 같은지로 판단한다(serverStamp가 없는 옛 서버는 옛 코드다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LAUNCHER, SRC_DIR } from './paths.js';

/** 도구 소스에서 가장 나중에 고친 시각(ms). 소스를 못 읽으면 0 */
export function srcMtime(dir: string = SRC_DIR): number {
  let m = 0;
  const walk = (d: string): void => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else m = Math.max(m, fs.statSync(f).mtimeMs); } };
  try { walk(dir); } catch { /* 소스를 못 읽으면 표 없음 */ }
  return m;
}

/** 지금 소스의 표(글) */
export const srcStamp = (dir?: string): string => String(Math.floor(srcMtime(dir)));

/** 이 서버가 뜰 때의 소스 표. 모델에 실려 응답한 서버가 어느 코드로 떠 있는지 알려 준다 */
export const serverStamp: string = srcStamp();
let checked = { at: 0, newer: false };

/** 이 서버가 뜬 뒤 소스가 바뀌었나(옛 코드로 떠 있나) */
export function staleServer(now = Date.now()): boolean {
  if (now - checked.at > 5000) checked = { at: now, newer: srcStamp() !== serverStamp };
  return checked.newer;
}

/** 서버 주소가 새 코드로 응답하는지 본다. 새 코드면 빈 글, 아니면 이유 글 */
export async function newCodeProblem(base: string, srcDir?: string): Promise<string> {
  try {
    const j = await (await fetch(`${base.replace(/\/$/, '')}/__spec/model.json`, { signal: AbortSignal.timeout(20000) })).json() as { serverStamp?: string };
    if (j.serverStamp === undefined) return '옛 코드로 떠 있다(코드 표가 없는 서버)';
    return j.serverStamp === srcStamp(srcDir) ? '' : '옛 코드로 떠 있다(소스가 서버가 뜬 뒤 바뀌었다)';
  } catch (e) { return `응답하지 않는다(${e instanceof Error ? e.message : String(e)})`; }
}

/** 같은 설정의 새 서버를 따로 떨어뜨려 띄운다. 이 서버는 부른 쪽이 곧 끝낸다. 운영 서버는 open --restart(옛 서버를 끄고 새로 띄우며 번호·표 기록도 고친다), 테스트 서버(SPEC_TEST_DIR)는 같은 인자·환경으로 자기를 다시 띄운다(포트가 비도록 잠깐 기다린 뒤) */
export function handOver(project: string): void {
  const dir = process.env.SPEC_TEST_DIR;
  if (!dir) { spawn(process.execPath, [LAUNCHER, 'open', project, '--no-open', '--restart'], { cwd: project, detached: true, stdio: 'ignore' }).unref(); return; }
  const log = fs.openSync(path.join(dir, 'serve.log'), 'a');
  spawn('sh', ['-c', 'sleep 2; exec "$@"', 'sh', process.execPath, ...process.argv.slice(1)], { cwd: process.cwd(), detached: true, stdio: ['ignore', log, log], env: process.env }).unref();
}
