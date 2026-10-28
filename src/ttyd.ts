/**
 * @spec terminal-dock-server 화면 아래 터미널 영역의 서버 쪽(담당 세션별 브라우저 터미널)
 * @why 담당 세션을 화면의 일부로 보려면 브라우저에서 `claude attach`를 돌려야 한다. 그런데 브라우저 터미널(ttyd)은 인증이 없으면 이 컴퓨터에서 열리는 어떤 웹 페이지든 연결해 세션을 조작할 수 있다. 그래서 ttyd는 네트워크 포트가 아니라 나만 들어갈 수 있는 폴더(0700) 안의 유닉스 소켓으로만 열고, 브라우저는 설계서 보기 서버를 거쳐서만 닿게 한다.
 * @contract 탭은 담당이 있고 아직 끝나지 않은(설계·구현·테스트 단계) 요청마다 하나다. 끝나거나 취소된 요청은 "지난 담당"으로 돌려준다. ttyd는 탭을 처음 열 때 세션마다 하나만 띄운다(소유자만 열 수 있는 임시 폴더 0700 안의 유닉스 소켓 --interface, 쓰기 허용 -W). 포트도 비밀 값도 없으므로 실행 인자(ps)에 드러나는 값이 없고, 같은 컴퓨터의 다른 사용자도 소켓에 들어갈 수 없다(폴더 권한이 막는다). 같은 담당에 attach가 둘 생기지 않도록 새 웹소켓이 오면 먼저 있던 연결을 닫는다(ttyd -m 1은 접었다 바로 펴면 새 연결을 거절해 쓰지 않는다). 테스트 서버는 운영 서버가 남긴 ttyd 기록을 정리하지 않는다. 탭의 사용자 차례 표시(askingUser)는 질문·막힘과 설계·테스트 승인 대기를 모두 본다. 중계는 ① 요청한 쪽이 이 컴퓨터 안이고 ② 받는 주소(Host)가 localhost·127.0.0.1·*.localhost이며(DNS 재바인딩 방지) ③ 웹소켓·POST는 보낸 쪽 출처(Origin)가 같은 주소일 때만 한다. 하나라도 어긋나면 403이다. 요청이 끝나면, 또는 연결이 5분 없으면, 서버가 꺼질 때 ttyd를 끈다(세션은 계속 돈다: 끄는 것은 접속 창구뿐). 뜬 ttyd의 번호는 .spec/ttyd-pids.log(커밋하지 않음)에 적어 서버가 새로 뜰 때 남은 것을 정리한다. SPEC_NO_TERMINAL=1에서만 ttyd를 띄우지 않는다(자동 시험용 스위치). 테스트 데이터 서버(SPEC_TEST_DIR)에서도 실제 담당 세션의 터미널이 열린다: 탭의 요청 목록은 테스트 자리 .spec의 복사본을 따르고, 담당 세션 번호는 운영 .spec/sessions.json에서 찾는다(복사하지 않는 파일이라). 터미널 영역이 실제로 열릴 수 있는지(dockWorks: 설정이 켜져 있고, ttyd가 있고, 마지막 띄우기가 실패하지 않았음)는 한 곳에서 판단해, 못 열 때는 iTerm2 창 자동 열기가 대신한다.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { memo } from './memo.js';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadRequests, openNotes, STEP } from './request.js';
import { ownersOf } from './session.js';
import { projectRoot } from './project.js';
import { readConfig } from './config.js';
import { attachCommand } from './terminal.js';
import type { TermTab, TermTabs } from './types.js';

/** 연결이 이 시간 없으면 ttyd를 끈다 */
const IDLE_MS = 5 * 60 * 1000;
const PREFIX = '/__spec/term/';

interface Box { proc: ChildProcess; dir: string; sock: string; sid: string; conns: number; idleSince: number; idleTimer?: NodeJS.Timeout; /** 열려 있는 연결을 닫는 함수들(새 연결이 오면 먼저 있던 것을 닫는다) */ closers: Set<() => void> }
/** 요청 번호 → 떠 있는 ttyd */
const boxes = new Map<number, Box>();

/** 터미널 탭 목록이 달라질 수 있는 일(ttyd 시작·끝, 실패 기록)이 생기면 부를 함수들(snapshot.ts가 건다) */
const termListeners = new Set<() => void>();
export function onTermChange(fn: () => void): void { termListeners.add(fn); }
const termChanged = (): void => { for (const f of termListeners) { try { f(); } catch { /* 듣는 쪽 오류가 터미널을 막지 않게 */ } } };

/** SPEC_NO_TERMINAL=1만 터미널을 끄는 스위치다(자동 시험이 쓴다). 테스트 데이터 서버(SPEC_TEST_DIR)는 막지 않는다: 사용자가 승인 전에 실제 담당 세션의 터미널을 시험해야 하기 때문이다 */
const disabled = (): boolean => !!process.env.SPEC_NO_TERMINAL;
const ttydPath = (): string => memo('ttydPath', 60_000, () => { const r = spawnSync('which', ['ttyd'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; });

/** 지금 열 수 있는 탭들과 지난 담당들 */
export function termTabs(scanRoot: string): TermTabs {
  const root = projectRoot(scanRoot);
  const live: TermTab[] = [], past: TermTab[] = [];
  for (const r of loadRequests(scanRoot)) {
    const sid = (ownersOf(root, r.id).slice(-1)[0] ?? '').slice(0, 8);
    if (!r.agent?.name || !sid) continue;
    const tab: TermTab = { id: r.id, title: `#${r.id} 담당`, sid, command: attachCommand(sid), live: r.stage !== 'done' && r.stage !== 'cancelled', askingUser: Object.keys(openNotes(r)).length > 0 || STEP[`${r.stage}:${r.step}`]?.turn === 'user' };
    (tab.live ? live : past).push(tab);
  }
  past.sort((a, b) => b.id - a.id);
  const why = unavailableReason(root);
  return { live, past: past.slice(0, 20), available: !why, reason: why };
}

/** 마지막으로 ttyd를 띄우다 실패한 이유(성공하면 비운다). 실패한 동안은 영역을 못 여는 것으로 본다 */
let lastFailure = '', lastFailureAt = 0;
/** 실패 뒤 이 시간이 지나면 다시 열 수 있는 것으로 본다(다시 시도하게) */
const RETRY_MS = 60_000;
/** 터미널 영역을 못 여는 이유. 열 수 있으면 빈 글 */
function unavailableReason(root: string): string {
  if (readConfig(root).terminalDock === false) return '설정(terminalDock)에서 껐다';
  if (disabled()) return '터미널을 끄는 스위치(SPEC_NO_TERMINAL)가 켜져 있다';
  if (!ttydPath()) return 'ttyd가 없다(brew install ttyd)';
  return lastFailure && Date.now() - lastFailureAt < RETRY_MS ? lastFailure : '';
}
/** 터미널 영역이 실제로 열릴 수 있는가. 아니면 iTerm2 창을 대신 열어야 한다 */
export const dockWorks = (scanRoot: string): boolean => !unavailableReason(projectRoot(scanRoot));

/** iTerm2 담당 창을 자동으로 열어야 하는가: 설정(itermAutoOpen)이 있으면 그 값, 없으면 터미널 영역이 못 열릴 때만 연다 */
export const itermShouldOpen = (scanRoot: string): boolean => readConfig(projectRoot(scanRoot)).itermAutoOpen ?? !dockWorks(scanRoot);

const pidFile = (root: string): string => path.join(root, '.spec', 'ttyd-pids.log');
const writePids = (root: string): void => {
  try { fs.mkdirSync(path.dirname(pidFile(root)), { recursive: true }); fs.writeFileSync(pidFile(root), JSON.stringify([...boxes.values()].map((b) => ({ pid: b.proc.pid, dir: b.dir })))); } catch { /* 기록 실패가 터미널을 막지 않게 */ }
};

/** 서버가 새로 뜰 때: 이전 서버가 남긴 ttyd를 끈다(번호가 다른 프로그램으로 재사용됐을 수 있어 이름이 ttyd일 때만) */
export function cleanupLeftover(scanRoot: string): void {
  const root = projectRoot(scanRoot);
  try {
    for (const { pid, dir } of JSON.parse(fs.readFileSync(pidFile(root), 'utf8')) as { pid?: number; dir: string }[]) {
      if (dir && path.basename(dir).startsWith('spec-ttyd-')) fs.rmSync(dir, { recursive: true, force: true });
      if (!pid) continue;
      const cmd = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout;
      if (/ttyd/.test(cmd)) { try { process.kill(pid); } catch { /* 이미 없다 */ } }
    }
    fs.rmSync(pidFile(root), { force: true });
  } catch { /* 기록이 없다 */ }
}

/** 소켓이 연결될 때까지 기다린다 */
const waitSock = async (sock: string): Promise<boolean> => {
  for (let i = 0; i < 40; i++) {
    if (await new Promise<boolean>((ok) => { const c = net.connect({ path: sock }, () => { c.destroy(); ok(true); }); c.on('error', () => ok(false)); })) return true;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return false;
};

function stop(root: string, id: number): void {
  const b = boxes.get(id);
  if (!b) return;
  boxes.delete(id);
  clearTimeout(b.idleTimer);
  try { b.proc.kill(); } catch { /* 이미 끝났다 */ }
  fs.rmSync(b.dir, { recursive: true, force: true });
  writePids(root);
  termChanged();
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
  // 소유자만 들어갈 수 있는 임시 폴더(0700) 안의 유닉스 소켓: 포트도 비밀 값도 없어 ps에 드러나는 것이 없고 다른 사용자는 들어올 수 없다
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-ttyd-'));
  fs.chmodSync(dir, 0o700);
  const sock = path.join(dir, 's.sock');
  // -O: ttyd 쪽에서도 출처를 확인한다(중계가 출처를 ttyd 주소로 바꿔 보내므로 우리 중계로 온 것만 통과). -W: 입력 허용
  const proc = spawn(bin, ['-i', sock, '-O', '-W', '-t', 'fontSize=14', '-t', 'theme={"background":"#0b0d12"}', 'claude', 'attach', tab.sid], { stdio: 'ignore' });
  const box: Box = { proc, dir, sock, sid: tab.sid, conns: 0, idleSince: Date.now(), closers: new Set() };
  proc.on('error', () => { /* 실행 파일을 못 열었다: 아래 기다림이 실패로 처리한다 */ });
  proc.on('exit', () => { if (boxes.get(id) === box) { boxes.delete(id); fs.rmSync(dir, { recursive: true, force: true }); writePids(root); } });
  boxes.set(id, box);
  writePids(root);
  if (!(await waitSock(sock))) { stop(root, id); lastFailure = 'ttyd가 뜨지 않았다'; lastFailureAt = Date.now(); termChanged(); retryTimer(); throw new Error(lastFailure); }
  lastFailure = '';
  armIdle(scanRoot, id, box);
  termChanged();
  return box;
}

/** 실패 뒤 다시 열 수 있게 되는 때(RETRY_MS 뒤)에 탭 목록을 한 번 새로 만들게 한다(사건 하나짜리 타이머) */
let retryT: NodeJS.Timeout | undefined;
function retryTimer(): void { clearTimeout(retryT); retryT = setTimeout(termChanged, RETRY_MS + 100); retryT.unref(); }

/** 연결이 없는 ttyd는 쉬는 한도(IDLE_MS)가 지난 시점에 그 건 하나만 한 번 도는 타이머로 끈다(연결이 생기면 취소, 끊기면 다시 건다) */
function armIdle(scanRoot: string, id: number, b: Box): void {
  clearTimeout(b.idleTimer);
  if (b.conns > 0) return;
  b.idleTimer = setTimeout(() => { if (boxes.get(id) === b && b.conns === 0) stop(projectRoot(scanRoot), id); }, IDLE_MS + 100);
  b.idleTimer.unref();
}

/** 끝난 요청·오래 쉬는 ttyd를 끈다. 요청 기록이나 세션 폴더가 바뀔 때(serve.ts의 트리거)와 쉬는 한도 타이머가 부른다 */
export function reapTtyd(scanRoot: string): void {
  if (!boxes.size) return;
  const root = projectRoot(scanRoot);
  const live = new Set(termTabs(scanRoot).live.map((t) => t.id));
  for (const [id, b] of boxes) if (!live.has(id) || (b.conns === 0 && Date.now() - b.idleSince > IDLE_MS)) stop(root, id);
}

/** 서버가 꺼질 때: 떠 있는 ttyd를 모두 끈다 */
export function stopAllTtyd(): void {
  for (const b of boxes.values()) { try { b.proc.kill(); } catch { /* 이미 끝났다 */ } fs.rmSync(b.dir, { recursive: true, force: true }); }
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

/** ttyd가 보기에 접속한 쪽(우리 중계)의 주소와 출처. 소켓이라 실제 주소는 없으므로 같은 값을 쓴다 */
const UP_HOST = '127.0.0.1';
const UP_ORIGIN = `http://${UP_HOST}`;

/** 브라우저의 요청을 그 요청의 ttyd로 넘기고 응답을 돌려준다 */
export async function termHttp(scanRoot: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = new URL(req.url || '/', 'http://x');
  const p = parseUrl(u.pathname);
  const fail = (code: number, text: string): void => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
  if (!p) return fail(404, '없음');
  if (!termAllowed(req, req.method !== 'GET' && req.method !== 'HEAD')) return fail(403, '허용하지 않는 접속이다');
  let box: Box;
  try { box = await ensure(scanRoot, p.id); } catch (e) { return fail(503, `터미널을 열지 못했다: ${e instanceof Error ? e.message : String(e)}`); }
  const up = http.request({ socketPath: box.sock, path: p.rest + u.search, method: req.method, headers: { ...req.headers, host: UP_HOST, origin: UP_ORIGIN, cookie: '', authorization: '' } }, (pr) => {
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
  // 같은 담당에 attach가 둘 생기지 않게, 새 연결이 오면 먼저 있던 연결을 닫는다(접었다 바로 펴도, 창이 둘이어도). -m 1은 이전 연결이 닫히기 전에 온 새 연결을 거절해 쓰지 않는다
  for (const close of [...b.closers]) close();
  b.conns++;
  clearTimeout(b.idleTimer);
  const t = net.connect({ path: b.sock }, () => {
    const h = { ...req.headers, host: UP_HOST, origin: UP_ORIGIN, cookie: '' };
    t.write(`${req.method} ${p.rest}${u.search} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head?.length) t.write(head);
    socket.pipe(t); t.pipe(socket);
  });
  let closed = false;
  const done = (): void => { if (closed) return; closed = true; b.closers.delete(done); b.conns = Math.max(0, b.conns - 1); b.idleSince = Date.now(); armIdle(scanRoot, p.id, b); socket.destroy(); t.destroy(); };
  b.closers.add(done);
  t.on('error', done); t.on('close', done); socket.on('error', done); socket.on('close', done);
}
