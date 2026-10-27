/**
 * @spec open 설계서 보기 한 번에 띄우기
 * @why 프로젝트 이름만 대면 서버 둘을 따로 띄우지 않아도 설계서 보기가 열리게 한다. 사용자도 에이전트도 같은 한 줄이다. 앱 개발 서버(꺼져 있으면 시작) → 설계서 보기 서버(serve) → 브라우저 순서로 띄운다.
 * @basis 프로젝트 이름은 install.sh spec으로 등록된 프로젝트의 폴더 이름(spec-projects.txt)이고, 설정은 <프로젝트>/.spec/config.json이다. 앱 개발 서버가 없는 프로젝트는 설정의 app을 null로 둔다. 그 포트에서 응답한 설계서 보기가 다른 프로젝트 것이면(model.json의 projectDir 비교) 알리고 멈춘다.
 * @contract 옵션: --no-open은 ego-browser를 열지 않는다(에이전트가 끝낼 때 확인용으로 띄울 때), --stop은 이 도구가 띄운 서버를 끄고, --restart는 떠 있는 서버를 옛 코드인지 따지지 않고 끄고 새로 띄운다(서버가 스스로 갈아 띄울 때, 테스트를 올리기 전). 띄운 서버의 번호는 <프로젝트>/.spec/pids.json에 적는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT_DIR, LAUNCHER } from './paths.js';
import { srcStamp } from './stale.js';
import { configFile, readConfig } from './config.js';
import { parseArgs } from './cli.js';

/** 이름이나 폴더로 프로젝트 폴더를 찾는다. 못 찾으면 안내를 내고 null */
function resolveProject(t: string): string | null {
  if (fs.existsSync(t) && fs.statSync(t).isDirectory()) return path.resolve(t);
  const list = path.join(ROOT_DIR, 'spec-projects.txt');
  const paths = fs.existsSync(list) ? fs.readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
  const hit = paths.filter((p) => path.basename(p) === t);
  if (hit.length === 1) return hit[0];
  console.error(hit.length ? `이름 "${t}"이 여러 프로젝트와 맞는다: ${hit.join(', ')}` : `프로젝트 "${t}"를 찾지 못했다. 폴더 경로를 주거나 install.sh spec <프로젝트>로 등록한다 (등록된 것: ${paths.map((p) => path.basename(p)).join(', ') || '없음'})`);
  return null;
}

/** 주소가 응답하는가 */
const up = async (url: string): Promise<boolean> => { try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };
/** 설계서 보기 서버인지 응답 내용으로 확인한다(소스가 바뀐 직후엔 모델을 새로 만드느라 느리므로 오래 기다린다)(같은 포트를 다른 프로그램이 쓰고 있으면 켜진 것으로 착각하지 않게) */
const isSpec = async (u: string): Promise<boolean> => {
  try { const j = await (await fetch(u, { signal: AbortSignal.timeout(12000) })).json() as { screens?: unknown }; return Array.isArray(j.screens); } catch { return false; }
};
/** 응답한 설계서 보기 서버가 누구 것인지 읽는다. 설계서 보기가 아니면 null, 프로젝트 정보가 없는 옛 서버는 dir이 빈 글 */
const whose = async (u: string): Promise<{ dir: string; name: string } | null> => {
  try {
    const j = await (await fetch(u, { signal: AbortSignal.timeout(12000) })).json() as { screens?: unknown; projectDir?: string; project?: string };
    return Array.isArray(j.screens) ? { dir: j.projectDir ?? '', name: j.project ?? '' } : null;
  } catch { return null; }
};
/** 같은 폴더인가(바로가기·대소문자 차이를 같게 본다) */
const sameDir = (a: string, b: string): boolean => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return path.resolve(a) === path.resolve(b); } };
/** 주소가 응답할 때까지 기다린다. 시간 안에 안 되면 false */
const waitUp = async (url: string, ms: number, check: (u: string) => Promise<boolean> = up): Promise<boolean> => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await check(url)) return true; await new Promise((r) => setTimeout(r, 400)); }
  return false;
};

/** 포트를 듣고 있는 프로세스들을 끈다(pids.json에 없는 떠돌이 서버용, 테스트 서버도 이걸로 끈다). 끈 번호들을 돌려준다 */
export function killPort(port: number, signal: NodeJS.Signals = 'SIGTERM'): number[] {
  const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  const ids = (r.stdout || '').split('\n').map((x) => Number(x.trim())).filter(Boolean);
  for (const pid of ids) { try { process.kill(pid, signal); } catch { /* 이미 없음 */ } }
  return ids;
}

/** 명령: open [프로젝트 이름 또는 폴더, 기본 현재 폴더] [--no-open] [--stop] [--restart] */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, flags } = parseArgs(argv, ['no-open', 'stop', 'restart']);
  const project = resolveProject(pos[0] || '.');
  if (!project) return 1;
  if (!fs.existsSync(configFile(project))) { console.error(`${configFile(project)} 이 없다. 먼저: <dev-method>/install.sh spec ${project} <소스폴더> <앱주소>`); return 1; }
  const cfg = readConfig(project);
  // 앱 개발 서버가 없는 프로젝트는 설정의 app을 null로 둔다
  const app = cfg.app === null ? null : (cfg.app || 'http://localhost:5173');
  const port = cfg.port || 5290, start = cfg.start || 'npm run dev';
  const pidFile = path.join(project, '.spec', 'pids.json');
  const readPids = (): Record<string, number> => { try { return JSON.parse(fs.readFileSync(pidFile, 'utf8')) as Record<string, number>; } catch { return {}; } };
  const writePids = (p: Record<string, number>): void => fs.writeFileSync(pidFile, JSON.stringify(p));
  /** 서버를 떼어 내어 띄우고(이 명령이 끝나도 계속 돈다) 프로세스 번호를 돌려준다 */
  const launch = (cmd: string, args: string[], log: string, shell: boolean): number => {
    fs.mkdirSync(path.join(project, '.spec'), { recursive: true });
    const fd = fs.openSync(path.join(project, '.spec', log), 'w');
    const child = spawn(cmd, args, { cwd: project, shell, detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    return child.pid ?? 0;
  };
  const tail = (log: string): string => fs.readFileSync(path.join(project, '.spec', log), 'utf8').split('\n').slice(-8).join('\n');

  const stampFile = path.join(project, '.spec', 'serve-stamp');
  const base = `http://localhost:${port}`;
  // 그 포트에서 응답한 설계서 보기가 다른 프로젝트 것이면 이 프로젝트 것으로 착각하지 않고, 남의 서버를 끄지도 않는다
  const other = await whose(`${base}/__spec/model.json`);
  if (other && other.dir && !sameDir(other.dir, project)) {
    console.error(`포트 ${port}는 다른 프로젝트(${other.name || path.basename(other.dir)}, ${other.dir})의 설계서 보기가 쓰고 있다. ${configFile(project)}의 port를 바꾼다. 그 서버는 끄지 않았다.`);
    return 1;
  }
  if (flags.has('stop')) {
    for (const [k, pid] of Object.entries(readPids())) {
      try { process.kill(-pid); console.log(`끔: ${k} (${pid})`); } catch { try { process.kill(pid); console.log(`끔: ${k} (${pid})`); } catch { console.log(`이미 꺼져 있음: ${k}`); } }
    }
    fs.rmSync(pidFile, { force: true }); fs.rmSync(stampFile, { force: true });
    // 기록에 없는데 설계서 보기 서버가 아직 떠 있으면(옛 기록·다른 곳에서 띄움) 포트로 찾아 끈다
    if (await isSpec(`${base}/__spec/model.json`)) {
      const ids = killPort(port);
      console.log(ids.length ? `끔: 포트 ${port}의 설계서 보기 서버 (${ids.join(', ')})` : `포트 ${port}의 서버를 끄지 못했다 — 직접 끈다`);
    }
    return 0;
  }

  const pids = readPids();
  if (!app) console.log('앱 서버 없음 (설정의 app이 null) — 설계서 보기만 띄운다');
  else if (await up(app)) console.log(`앱 서버 이미 떠 있음: ${app}`);
  else {
    pids.app = launch(start, [], 'app.log', true); writePids(pids);
    if (!(await waitUp(app, 40000))) { console.error(`앱 서버가 ${app} 에서 응답하지 않는다. 시작 명령: ${start}\n로그: ${path.join(project, '.spec', 'app.log')}\n---\n${tail('app.log')}`); return 1; }
    console.log(`앱 서버 시작: ${app} (${start})`);
  }
  const stamp = srcStamp();
  let running = await isSpec(`${base}/__spec/model.json`);
  // 도구를 고친 뒤인데 서버가 옛 코드로 돌고 있으면 껐다 다시 띄운다. --restart는 옛 코드인지 따지지 않고 늘 갈아 띄운다(테스트를 올리기 전 절차)
  if (running && (flags.has('restart') || (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') !== stamp))) {
    killPort(port); if (pids.serve) try { process.kill(-pids.serve); } catch { /* 이미 없음 */ }
    for (let i = 0; i < 10 && await up(base); i++) await new Promise((r) => setTimeout(r, 300));
    if (await up(base)) { killPort(port, 'SIGKILL'); await new Promise((r) => setTimeout(r, 500)); }
    running = false; console.log('설계서 보기 서버를 새 코드로 다시 띄운다');
  }
  if (running) console.log(`설계서 보기 서버 이미 떠 있음: ${base}`);
  else {
    if (await up(base)) { console.error(`포트 ${port}를 다른 프로그램이 쓰고 있다. ${configFile(project)}의 port를 바꾼다.`); return 1; }
    pids.serve = launch(process.execPath, [LAUNCHER, 'serve', '--project', project], 'serve.log', false); writePids(pids); fs.writeFileSync(stampFile, stamp);
    if (!(await waitUp(`${base}/__spec/model.json`, 15000, isSpec))) { console.error(`설계서 보기 서버가 ${base} 에서 응답하지 않는다.\n로그: ${path.join(project, '.spec', 'serve.log')}\n---\n${tail('serve.log')}`); return 1; }
    console.log(`설계서 보기 서버 시작: ${base}`);
  }
  console.log(`\n설계서 보기: ${base}/`);
  if (!flags.has('no-open')) {
    // 화면을 여는 브라우저는 ego-browser만 쓴다(운영체제 기본 브라우저나 Chrome을 직접 열지 않는다)
    const task = `const task = await taskSpace("설계서 보기"); const page = task.page("p1"); await page.goto(${JSON.stringify(`${base}/`)});`;
    const r = spawnSync('ego-browser', ['nodejs'], { input: task, encoding: 'utf8', timeout: 60000 });
    if (r.error || r.status !== 0) console.error(`ego-browser로 열지 못했다. 직접 열려면 ${base}/ — ${r.error ? r.error.message : (r.stderr || r.stdout).trim().split('\n').slice(-1)[0]}`);
  }
  return 0;
}
