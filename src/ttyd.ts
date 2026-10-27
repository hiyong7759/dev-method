/**
 * @spec terminal-dock-server 화면 아래 터미널 영역의 서버 쪽(담당 세션별 브라우저 터미널)
 * @why 담당 세션을 화면의 일부로 보려면 브라우저에서 `claude attach`를 돌려야 한다. 그런데 브라우저 터미널(ttyd)은 인증이 없으면 이 컴퓨터에서 열리는 어떤 웹 페이지든 연결해 세션을 조작할 수 있다. 그래서 ttyd는 이 컴퓨터 안(127.0.0.1)에서만 열고, 브라우저는 비밀 값을 모른 채 설계서 보기 서버를 거쳐서만 닿게 한다.
 * @contract 탭은 담당이 있고 아직 끝나지 않은(설계·구현·테스트 단계) 요청마다 하나다. 끝나거나 취소된 요청은 "지난 담당"으로 돌려준다. ttyd는 탭을 처음 열 때 세션마다 하나만 띄운다(무작위 포트, 무작위 비밀 값 --credential, 127.0.0.1에만 --interface, 쓰기 허용 -W). 비밀 값은 서버 메모리에만 있고 파일·로그·화면에 나가지 않는다(서버가 중계하며 인증 머리글을 대신 붙인다). 중계는 ① 요청한 쪽이 이 컴퓨터 안이고 ② 받는 주소(Host)가 localhost·127.0.0.1·*.localhost이며(DNS 재바인딩 방지) ③ 웹소켓·POST는 보낸 쪽 출처(Origin)가 같은 주소일 때만 한다. 하나라도 어긋나면 403이다. 요청이 끝나면, 또는 연결이 5분 없으면, 서버가 꺼질 때 ttyd를 끈다(세션은 계속 돈다: 끄는 것은 접속 창구뿐). 뜬 ttyd의 번호는 .spec/ttyd-pids.log(커밋하지 않음)에 적어 서버가 새로 뜰 때 남은 것을 정리한다. 테스트 서버(SPEC_TEST_DIR)와 SPEC_NO_TERMINAL=1에서는 ttyd를 띄우지 않는다.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadRequests, openNotes } from './request.js';
import { ownersOf } from './session.js';
import { projectRoot } from './project.js';
import { attachCommand } from './terminal.js';
import type { TermTab, TermTabs } from './types.js';

/** 연결이 이 시간 없으면 ttyd를 끈다 */
const IDLE_MS = 5 * 60 * 1000;
const PREFIX = '/__spec/term/';

interface Box { proc: ChildProcess; port: number; secret: string; sid: string; conns: number; idleSince: number }
/** 요청 번호 → 떠 있는 ttyd */
const boxes = new Map<number, Box>();

const disabled = (): boolean => !!(process.env.SPEC_TEST_DIR || process.env.SPEC_NO_TERMINAL);
const ttydPath = (): string => { const r = spawnSync('which', ['ttyd'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };

/** 지금 열 수 있는 탭들과 지난 담당들 */
export function termTabs(scanRoot: string): TermTabs {
  const root = projectRoot(scanRoot);
  const live: TermTab[] = [], past: TermTab[] = [];
  for (const r of loadRequests(scanRoot)) {
    const sid = (ownersOf(root, r.id).slice(-1)[0] ?? '').slice(0, 8);
    if (!r.agent?.name || !sid) continue;
    const tab: TermTab = { id: r.id, title: `#${r.id} 담당`, sid, command: attachCommand(sid), live: r.stage !== 'done' && r.stage !== 'cancelled', askingUser: Object.keys(openNotes(r)).length > 0 };
    (tab.live ? live : past).push(tab);
  }
  past.sort((a, b) => b.id - a.id);
  const why = disabled() ? '테스트 환경에서는 터미널을 띄우지 않는다' : ttydPath() ? '' : 'ttyd가 없다(brew install ttyd)';
  return { live, past: past.slice(0, 20), available: !why, reason: why };
}

const pidFile = (root: string): string => path.join(root, '.spec', 'ttyd-pids.log');
const writePids = (root: string): void => {
  try { fs.mkdirSync(path.dirname(pidFile(root)), { recursive: true }); fs.writeFileSync(pidFile(root), JSON.stringify([...boxes.values()].map((b) => b.proc.pid).filter(Boolean))); } catch { /* 기록 실패가 터미널을 막지 않게 */ }
};

/** 서버가 새로 뜰 때: 이전 서버가 남긴 ttyd를 끈다(번호가 다른 프로그램으로 재사용됐을 수 있어 이름이 ttyd일 때만) */
export function cleanupLeftover(scanRoot: string): void {
  const root = projectRoot(scanRoot);
  try {
    for (const pid of JSON.parse(fs.readFileSync(pidFile(root), 'utf8')) as number[]) {
      const cmd = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout;
      if (/ttyd/.test(cmd)) { try { process.kill(pid); } catch { /* 이미 없다 */ } }
    }
    fs.rmSync(pidFile(root), { force: true });
  } catch { /* 기록이 없다 */ }
}

function freePort(): Promise<number> {
  return new Promise((ok, no) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); }); s.on('error', no); });
}
const waitPort = async (port: number): Promise<boolean> => {
  for (let i = 0; i < 40; i++) {
    if (await new Promise<boolean>((ok) => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); ok(true); }); c.on('error', () => ok(false)); })) return true;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return false;
};

function stop(root: string, id: number): void {
  const b = boxes.get(id);
  if (!b) return;
  boxes.delete(id);
  try { b.proc.kill(); } catch { /* 이미 끝났다 */ }
  writePids(root);
}

/** 요청의 ttyd를 (없으면) 띄운다. 못 띄우면 이유를 던진다 */
const starting = new Map<number, Promise<Box>>();
function ensure(scanRoot: string, id: number): Promise<Box> {
  const going = starting.get(id);
  if (going) return going;
  const p = start(scanRoot, id).finally(() => starting.delete(id));
  starting.set(id, p);
  return p;
}
async function start(scanRoot: string, id: number): Promise<Box> {
  const root = projectRoot(scanRoot);
  const tab = termTabs(scanRoot).live.find((t) => t.id === id);
  if (!tab) throw new Error('지금 일하는 담당 세션이 아니다');
  const had = boxes.get(id);
  if (had && had.sid === tab.sid) { had.idleSince = Date.now(); return had; }
  if (had) stop(root, id);
  const bin = ttydPath();
  if (disabled() || !bin) throw new Error(termTabs(scanRoot).reason);
  const port = await freePort();
  const secret = crypto.randomBytes(24).toString('hex');
  // -O: ttyd 쪽에서도 출처를 확인한다(중계가 출처를 ttyd 주소로 바꿔 보내므로 우리 중계로 온 것만 통과). -W: 입력 허용
  const proc = spawn(bin, ['-i', '127.0.0.1', '-p', String(port), '-c', `dev:${secret}`, '-O', '-W', '-t', 'fontSize=14', '-t', 'theme={"background":"#0b0d12"}', 'claude', 'attach', tab.sid], { stdio: 'ignore' });
  const box: Box = { proc, port, secret, sid: tab.sid, conns: 0, idleSince: Date.now() };
  proc.on('exit', () => { if (boxes.get(id) === box) { boxes.delete(id); writePids(root); } });
  boxes.set(id, box);
  writePids(root);
  if (!(await waitPort(port))) { stop(root, id); throw new Error('ttyd가 뜨지 않았다'); }
  return box;
}

/** 서버가 5초마다 부른다: 끝난 요청·오래 쉬는 ttyd를 끈다 */
export function reapTtyd(scanRoot: string): void {
  if (!boxes.size) return;
  const root = projectRoot(scanRoot);
  const live = new Set(termTabs(scanRoot).live.map((t) => t.id));
  for (const [id, b] of boxes) if (!live.has(id) || (b.conns === 0 && Date.now() - b.idleSince > IDLE_MS)) stop(root, id);
}

/** 서버가 꺼질 때: 떠 있는 ttyd를 모두 끈다 */
export function stopAllTtyd(): void {
  for (const b of boxes.values()) { try { b.proc.kill(); } catch { /* 이미 끝났다 */ } }
  boxes.clear();
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const hostOk = (host: string | undefined): boolean => { const n = (host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase(); return n === 'localhost' || n === '127.0.0.1' || n === '::1' || n.endsWith('.localhost'); };
/** 중계해도 되는 요청인가(이 컴퓨터 안, 알려진 주소, 쓰는 요청은 같은 출처) */
export function termAllowed(req: IncomingMessage, writing: boolean): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '') || !hostOk(req.headers.host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; } }
  else if (writing) return false;
  return true;
}

/** /__spec/term/<번호>/<나머지> 주소를 쪼갠다 */
const parseUrl = (url: string): { id: number; rest: string } | null => { const m = /^\/__spec\/term\/(\d+)(\/.*)?$/.exec(url); return m ? { id: Number(m[1]), rest: m[2] || '/' } : null; };
export const isTermUrl = (url: string): boolean => url.startsWith(PREFIX) && !!parseUrl(url.split('?')[0]);

const auth = (b: Box): string => `Basic ${Buffer.from(`dev:${b.secret}`).toString('base64')}`;

/** 브라우저의 요청을 그 요청의 ttyd로 넘기고 응답을 돌려준다 */
export async function termHttp(scanRoot: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = new URL(req.url || '/', 'http://x');
  const p = parseUrl(u.pathname);
  const fail = (code: number, text: string): void => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
  if (!p) return fail(404, '없음');
  if (!termAllowed(req, req.method !== 'GET' && req.method !== 'HEAD')) return fail(403, '허용하지 않는 접속이다');
  let box: Box;
  try { box = await ensure(scanRoot, p.id); } catch (e) { return fail(503, `터미널을 열지 못했다: ${e instanceof Error ? e.message : String(e)}`); }
  const up = http.request({ hostname: '127.0.0.1', port: box.port, path: p.rest + u.search, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${box.port}`, authorization: auth(box), origin: `http://127.0.0.1:${box.port}`, cookie: '' } }, (pr) => {
    res.writeHead(pr.statusCode ?? 502, { ...pr.headers, 'cache-control': 'no-store' });
    pr.pipe(res);
  });
  up.on('error', () => fail(502, '터미널에 연결하지 못했다'));
  req.pipe(up);
}

/** 웹소켓(터미널 입출력)을 그 요청의 ttyd로 이어 준다 */
export function termUpgrade(scanRoot: string, req: IncomingMessage, socket: net.Socket, head: Buffer): void {
  const u = new URL(req.url || '/', 'http://x');
  const p = parseUrl(u.pathname);
  const deny = (line: string): void => { socket.end(`HTTP/1.1 ${line}\r\nConnection: close\r\n\r\n`); };
  if (!p) return deny('404 Not Found');
  if (!termAllowed(req, true)) return deny('403 Forbidden');
  const b = boxes.get(p.id);
  if (!b) return deny('409 Conflict');
  b.conns++;
  const t = net.connect(b.port, '127.0.0.1', () => {
    const h = { ...req.headers, host: `127.0.0.1:${b.port}`, authorization: auth(b), origin: `http://127.0.0.1:${b.port}`, cookie: '' };
    t.write(`${req.method} ${p.rest}${u.search} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head?.length) t.write(head);
    socket.pipe(t); t.pipe(socket);
  });
  let closed = false;
  const done = (): void => { if (closed) return; closed = true; b.conns = Math.max(0, b.conns - 1); b.idleSince = Date.now(); socket.destroy(); t.destroy(); };
  t.on('error', done); t.on('close', done); socket.on('error', done); socket.on('close', done);
}
