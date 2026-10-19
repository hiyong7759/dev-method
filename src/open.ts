#!/usr/bin/env node
// 설계서 보기를 한 번에 띄운다: 앱 개발 서버(꺼져 있으면 시작) → 설계서 보기 서버(serve.mjs) → 브라우저.
// 존재 이유: 프로젝트 이름만 대면 서버 둘을 따로 띄우지 않아도 설계서 보기가 열리게 하려고. 사용자도 에이전트도 같은 한 줄이다.
// 사용: node open.mjs [프로젝트 이름 또는 폴더, 기본 현재 폴더] [--no-open] [--stop]
//   이름은 install.sh spec으로 등록된 프로젝트의 폴더 이름(spec-projects.txt). 설정은 <프로젝트>/.spec/config.json
//   { "src": "src", "app": "http://localhost:5173", "port": 5290, "start": "npm run dev" }
//   --no-open: 브라우저는 열지 않는다(에이전트가 끝낼 때 확인용으로 띄울 때). --stop: 이 도구가 띄운 서버를 끈다
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT_DIR, LAUNCHER } from './paths.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const target = argv.find((a) => !a.startsWith('--')) || '.';

function resolveProject(t) {
  if (fs.existsSync(t) && fs.statSync(t).isDirectory()) return path.resolve(t);
  const list = path.join(ROOT_DIR, 'spec-projects.txt');
  const paths = fs.existsSync(list) ? fs.readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
  const hit = paths.filter((p) => path.basename(p) === t);
  if (hit.length === 1) return hit[0];
  console.error(hit.length ? `이름 "${t}"이 여러 프로젝트와 맞는다: ${hit.join(', ')}` : `프로젝트 "${t}"를 찾지 못했다. 폴더 경로를 주거나 install.sh spec <프로젝트>로 등록한다 (등록된 것: ${paths.map((p) => path.basename(p)).join(', ') || '없음'})`);
  process.exit(1);
}
const project = resolveProject(target);
const cfgFile = path.join(project, '.spec', 'config.json');
if (!fs.existsSync(cfgFile)) { console.error(`${cfgFile} 이 없다. 먼저: <dev-method>/install.sh spec ${project} <소스폴더> <앱주소>`); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
// 앱 개발 서버가 없는 프로젝트는 설정의 app을 null로 둔다
const app = cfg.app === null ? null : (cfg.app || 'http://localhost:5173'), port = cfg.port || 5290, start = cfg.start || 'npm run dev';
const pidFile = path.join(project, '.spec', 'pids.json');
const readPids = () => { try { return JSON.parse(fs.readFileSync(pidFile, 'utf8')); } catch { return {}; } };

const up = async (url) => { try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };
// 설계서 보기 서버인지 응답 내용으로 확인한다(같은 포트를 다른 프로그램이 쓰고 있으면 켜진 것으로 착각하지 않게)
const isSpec = async (u) => { try { const j = await (await fetch(u, { signal: AbortSignal.timeout(1500) })).json(); return Array.isArray(j.screens); } catch { return false; } };
const waitUp = async (url, ms, check = up) => { const t = Date.now(); while (Date.now() - t < ms) { if (await check(url)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const launch = (cmd, args, log, shell) => {
  fs.mkdirSync(path.join(project, '.spec'), { recursive: true });
  const fd = fs.openSync(path.join(project, '.spec', log), 'w');
  const child = spawn(cmd, args, { cwd: project, shell: !!shell, detached: true, stdio: ['ignore', fd, fd] });
  child.unref(); return child.pid;
};

if (flags.has('--stop')) {
  const pids = readPids();
  for (const [k, pid] of Object.entries(pids)) { try { process.kill(-pid); console.log(`끔: ${k} (${pid})`); } catch { try { process.kill(pid); console.log(`끔: ${k} (${pid})`); } catch { console.log(`이미 꺼져 있음: ${k}`); } } }
  fs.rmSync(pidFile, { force: true }); process.exit(0);
}

const pids = readPids();
if (!app) console.log('앱 서버 없음 (설정의 app이 null)');
else if (await up(app)) console.log(`앱 서버 이미 떠 있음: ${app}`);
else {
  pids.app = launch(start, [], 'app.log', true); fs.writeFileSync(pidFile, JSON.stringify(pids));
  if (!(await waitUp(app, 40000))) { console.error(`앱 서버가 ${app} 에서 응답하지 않는다. 시작 명령: ${start}\n로그: ${path.join(project, '.spec', 'app.log')}\n---\n${fs.readFileSync(path.join(project, '.spec', 'app.log'), 'utf8').split('\n').slice(-8).join('\n')}`); process.exit(1); }
  console.log(`앱 서버 시작: ${app} (${start})`);
}
const base = `http://localhost:${port}`;
if (await isSpec(`${base}/__spec/model.json`)) console.log(`설계서 보기 서버 이미 떠 있음: ${base}`);
else {
  if (await up(base)) { console.error(`포트 ${port}를 다른 프로그램이 쓰고 있다. ${path.join(project, '.spec', 'config.json')}의 port를 바꾼다.`); process.exit(1); }
  pids.serve = launch(process.execPath, [LAUNCHER, 'serve', '--project', project], 'serve.log', false); fs.writeFileSync(pidFile, JSON.stringify(pids));
  if (!(await waitUp(`${base}/__spec/model.json`, 15000, isSpec))) { console.error(`설계서 보기 서버가 ${base} 에서 응답하지 않는다.\n로그: ${path.join(project, '.spec', 'serve.log')}\n---\n${fs.readFileSync(path.join(project, '.spec', 'serve.log'), 'utf8').split('\n').slice(-8).join('\n')}`); process.exit(1); }
  console.log(`설계서 보기 서버 시작: ${base}`);
}
console.log(`\n설계서 보기: ${base}/`);
if (!flags.has('--no-open')) {
  const opener = process.platform === 'darwin' ? ['open', [`${base}/`]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', `${base}/`]] : ['xdg-open', [`${base}/`]];
  spawnSync(opener[0], opener[1], { stdio: 'ignore' });
}
