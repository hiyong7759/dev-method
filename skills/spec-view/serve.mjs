#!/usr/bin/env node
// 설계서 보기 서버 — 프로젝트의 개발 서버를 그대로 중계(프록시)하면서 그 위에 /__spec/ 설계서 보기를 얹는다.
// 존재 이유: 프로젝트마다 플러그인을 설치하지 않고(어떤 개발 서버든 같은 방식), 앱 화면과 설계서가 같은 주소 안에 있어 컴포넌트 위치·영역 선택·화면 따라가기가 되게 하려고.
// 사용: node serve.mjs [--project <폴더, 기본 현재>] [--app http://localhost:5173] [--port 5290] [--src src]
// 설정: <프로젝트>/.spec/config.json  { "src": "src", "app": "http://localhost:5173", "port": 5290 }  (옵션이 우선)
// 이 서버 주소(기본 http://localhost:5290)를 열면 설계서 보기(화면 흐름)가 먼저 나온다. 앱 화면은 설계서 안에 끼워 넣어 보이고, 앱의 요청은 그대로 통과시킨다.
// 브라우저가 앱 주소를 최상위 페이지로 직접 열면(주소창, 새 탭) 그 주소의 화면 설계서(없으면 화면 흐름)로 보낸다. 화면 안(iframe)의 요청과 도구(curl 등)의 요청은 그대로 통과한다.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { specHandler } from './middleware.mjs';
import { extractSpecs } from './extract.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const project = path.resolve(opt('project') || '.');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(project, '.spec', 'config.json'), 'utf8')); } catch { /* 설정 없음 */ }
const app = new URL(opt('app') || cfg.app || 'http://localhost:5173');
const port = Number(opt('port') || cfg.port || 5290);
const scanRoot = path.resolve(project, opt('src') || cfg.src || 'src');
if (!fs.existsSync(scanRoot)) { console.error(`소스 폴더가 없다: ${scanRoot}  (--src 또는 .spec/config.json의 src)`); process.exit(1); }

const spec = specHandler(scanRoot);
const hop = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer']);

function proxy(req, res) {
  const headers = { ...req.headers, host: app.host };
  const up = http.request({ hostname: app.hostname, port: app.port || 80, path: req.url, method: req.method, headers }, (pr) => {
    const out = {};
    for (const [k, v] of Object.entries(pr.headers)) if (!hop.has(k)) out[k] = v;
    if (out.location && String(out.location).startsWith(app.origin)) out.location = String(out.location).slice(app.origin.length) || '/';
    res.writeHead(pr.statusCode, out); pr.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`앱 서버(${app.origin})에 연결하지 못했다: ${e.message}\n앱 개발 서버를 먼저 띄운다.`); });
  req.pipe(up);
}

// 주소창으로 앱 화면을 직접 연 경우 → 설계서 보기로. 화면 안(iframe)·스크립트·이미지 요청은 건드리지 않는다
function toViewer(req, res) {
  if (req.method !== 'GET' || req.headers['sec-fetch-dest'] !== 'document') return false;
  const pathname = new URL(req.url, 'http://x').pathname;
  const rx = (pt) => new RegExp(`^${pt.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '')}/?$`);
  let to = '/__spec/#/map';
  if (pathname !== '/') {
    const hit = extractSpecs(scanRoot).screens.filter((s) => s.route && rx(s.route).test(pathname)).sort((a, b) => b.route.length - a.route.length)[0];
    if (hit) to = `/__spec/#/screen/${encodeURIComponent(hit.name)}?at=${encodeURIComponent(pathname)}`;
  }
  res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); return true;
}

const server = http.createServer((req, res) => spec(req, res, () => { if (!toViewer(req, res)) proxy(req, res); }));
// 개발 서버의 실시간 갱신(웹소켓)도 그대로 통과시킨다
server.on('upgrade', (req, socket, head) => {
  const t = net.connect(Number(app.port || 80), app.hostname, () => {
    const h = { ...req.headers, host: app.host };
    t.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head?.length) t.write(head);
    socket.pipe(t); t.pipe(socket);
  });
  t.on('error', () => socket.destroy()); socket.on('error', () => t.destroy());
});
server.listen(port, () => console.log(`설계서 보기: http://localhost:${port}/\n앱 중계: ${app.origin} (설계서 안에 끼워 넣어 보인다)\n소스: ${scanRoot}`));
