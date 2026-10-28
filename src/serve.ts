/**
 * @spec serve 설계서 보기 서버
 * @why 프로젝트마다 플러그인을 설치하지 않고(어떤 개발 서버든 같은 방식), 앱 화면과 설계서가 같은 주소 안에 있어 컴포넌트 위치, 영역 선택, 화면 따라가기가 되게 한다. 프로젝트의 앱 개발 서버를 그대로 중계(프록시)하면서 그 위에 /__spec/ 설계서 보기를 얹는다.
 * @basis 이 서버 주소(기본 http://localhost:5290)를 열면 설계서 보기(사용 흐름)가 먼저 나온다. 앱 화면은 설계서 안에 끼워 넣어 보이고 앱의 요청은 그대로 통과시킨다. 브라우저가 앱 주소를 최상위 페이지로 직접 열면(주소창, 새 탭) 그 주소의 화면 설계서(없으면 사용 흐름)로 보낸다. 화면 안(iframe)의 요청과 도구(curl 등)의 요청은 그대로 통과한다.
 * @contract 설정은 <프로젝트>/.spec/config.json의 src, app, port이고 옵션(--src, --app, --port)이 우선한다. app이 null이면 앱 서버 없이 설계서 보기만 띄운다.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { specHandler } from './middleware.js';
import { ensureMessenger, kickWaiting, nextKickIn, setAfterEnqueue } from './outbox.js';
import { reconcile } from './reconcile.js';
import { markStalledReviews } from './request.js';
import { openWindowsForNotices } from './notify.js';
import { handOver, staleServer } from './stale.js';
import { projectRoot } from './project.js';
import { screenRoutes } from './snapshot.js';
import { watchTriggers } from './watch.js';
import type { TriggerKind } from './watch.js';
import { readConfig } from './config.js';
import { parseArgs } from './cli.js';
import { cleanupLeftover, isTermUrl, itermShouldOpen, reapTtyd, stopAllTtyd, termUpgrade } from './ttyd.js';

/** 중계할 때 그대로 넘기지 않는 연결 관리용 머리글 */
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer']);
/** 주소 모양(/trips/:id)과 실제 주소를 맞춰 보는 식 */
const rx = (pattern: string): RegExp => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '')}/?$`);

/** 명령: serve [--project <폴더>] [--app <주소>] [--port <번호>] [--src <소스 폴더>] — 서버를 띄우고 계속 돈다 */
export async function main(argv: string[]): Promise<number | undefined> {
  const { opts } = parseArgs(argv);
  const project = path.resolve(opts.project || '.');
  const cfg = readConfig(project);
  // 앱 개발 서버가 없는 프로젝트(설정의 app이 null)는 중계 없이 설계서 보기만 띄운다
  const appArg = opts.app ?? (cfg.app === undefined ? 'http://localhost:5173' : cfg.app);
  const app = appArg ? new URL(appArg) : null;
  const port = Number(opts.port || cfg.port || 5290);
  const scanRoot = path.resolve(project, opts.src || cfg.src || 'src');
  if (!fs.existsSync(scanRoot)) { console.error(`소스 폴더가 없다: ${scanRoot}  (--src 또는 .spec/config.json의 src)`); return 1; }

  const spec = specHandler(scanRoot);

  /** 앱 개발 서버로 요청을 그대로 넘기고 응답을 돌려준다 */
  const proxy = (req: IncomingMessage, res: ServerResponse): void => {
    if (!app) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('이 프로젝트에는 앱 서버가 없다. 설계서 보기는 /__spec/ 에 있다.'); return; }
    // 테스트 화면 안(iframe)에 끼워 열린 앱 화면에는 짚기 도우미(test-probe)를 끼워 준다. 안쪽이 바깥과 출처가 달라도 바깥 도구가 부품 이름·위치와 캡처를 받을 수 있게 하는 길이다
    const framed = req.headers['sec-fetch-dest'] === 'iframe';
    const up = http.request({ hostname: app.hostname, port: app.port || 80, path: req.url, method: req.method, headers: { ...req.headers, host: app.host, ...(framed ? { 'accept-encoding': 'identity' } : {}) } }, (pr) => {
      const headers: http.OutgoingHttpHeaders = {};
      for (const [k, v] of Object.entries(pr.headers)) if (!HOP.has(k)) headers[k] = v;
      const loc = headers.location;
      if (typeof loc === 'string' && loc.startsWith(app.origin)) headers.location = loc.slice(app.origin.length) || '/';
      if (framed && String(pr.headers['content-type'] ?? '').includes('text/html')) {
        const chunks: Buffer[] = [];
        pr.on('data', (c: Buffer) => chunks.push(c));
        pr.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          const tag = '<script type="module" src="/__spec/ui/test-probe.js"></script>';
          const out = Buffer.from(/<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : html + tag);
          delete headers['content-length'];
          headers['content-length'] = out.length;
          res.writeHead(pr.statusCode ?? 502, headers);
          res.end(out);
        });
        return;
      }
      res.writeHead(pr.statusCode ?? 502, headers);
      pr.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`앱 서버(${app.origin})에 연결하지 못했다: ${e.message}\n앱 개발 서버를 먼저 띄운다.`); });
    req.pipe(up);
  };

  /** 주소창으로 앱 화면을 직접 연 경우 → 설계서 보기로 보낸다. 화면 안(iframe)·스크립트·이미지 요청은 건드리지 않는다 */
  const toViewer = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    // x-spec-direct: 도구(로그인 도우미)가 앱 화면을 직접 열 때 붙이는 표시 — 보내지 않고 그대로 앱에 넘긴다
    if (req.method !== 'GET' || req.headers['sec-fetch-dest'] !== 'document' || req.headers['x-spec-direct']) return false;
    const pathname = new URL(req.url || '/', 'http://x').pathname;
    let to = '/__spec/#/flow';
    if (pathname !== '/') {
      const hit = (await screenRoutes(scanRoot)).map((s) => ({ s, r: s.routes.filter((x) => rx(x).test(pathname)).sort((a, b) => b.length - a.length)[0] })).filter((x) => x.r).sort((a, b) => b.r.length - a.r.length)[0]?.s;
      if (hit) to = `/__spec/#/screen/${encodeURIComponent(hit.name)}?at=${encodeURIComponent(pathname)}`;
    }
    res.writeHead(302, { location: to, 'cache-control': 'no-store' });
    res.end();
    return true;
  };

  const server = http.createServer((req, res) => { void spec(req, res, () => { void toViewer(req, res).then((done) => { if (!done) proxy(req, res); }); }); });
  // 개발 서버의 실시간 갱신(웹소켓)도 그대로 통과시킨다
  server.on('upgrade', (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    // 화면 아래 터미널(ttyd) 연결은 앱으로 넘기지 않고 우리가 검사해서 이어 준다
    if (isTermUrl((req.url || '').split('?')[0])) { termUpgrade(scanRoot, req, socket, head); return; }
    if (!app) { socket.destroy(); return; }
    const t = net.connect(Number(app.port || 80), app.hostname, () => {
      const h = { ...req.headers, host: app.host };
      t.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head?.length) t.write(head);
      socket.pipe(t); t.pipe(socket);
    });
    t.on('error', () => socket.destroy());
    socket.on('error', () => t.destroy());
  });
  // 1분마다 소스가 서버가 뜬 뒤 바뀌었는지(옛 코드) 보고, 바뀌었으면 같은 설정의 새 서버를 띄우고 자기는 물러난다.
  // 담당 세션에 글을 보내거나 다시 보내는 일은 서버가 하지 않는다(보낼 글은 outbox에 있고 메신저 세션이 보낸다. 서버가 물러나도 줄은 파일에 남는다)
  const root = projectRoot(scanRoot);
  // 단, 메신저 세션이 꺼져 있으면 승인한 결정이 대기에서 멈추므로 서버가 메신저를 살려 둔다(없으면 띄우고, 쉬는데 대기 줄이 있으면 깨운다). 담당 세션에 글을 보내는 일이 아니다
  setAfterEnqueue(() => { ensureMessenger(scanRoot); });
  ensureMessenger(scanRoot);
  // 담당의 사건(시작·설계 제출·질문·막힘·테스트 올림·담당 종료)이 생기면 그 요청의 담당 세션 창을 iTerm2에 연다(5초마다. 요청마다 창 하나, 닫기는 사용자가). 테스트 서버에서는 열지 않는다
  // 터미널 영역이 실제로 열릴 수 있을 때만 창을 열지 않는다(ttyd가 없거나 못 띄우거나 설정으로 껐으면 iTerm2 창이 대신 열린다). itermAutoOpen을 직접 적으면 그 값을 따른다
  // 테스트 서버는 운영 서버가 남긴 ttyd 기록을 읽어 운영 터미널을 끊지 않도록 정리하지 않는다
  if (!process.env.SPEC_TEST_DIR) cleanupLeftover(scanRoot);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopAllTtyd(); process.exit(0); });
  process.on('exit', stopAllTtyd);
  // 반복 타이머 대신 트리거로 한다(요청 #107): 바뀐 것이 있을 때만 해당 일을 한다. 알림이 빠질 수 있어 서버가 켜질 때 한 번 모두 한다
  const openWindows = (): void => { if (process.env.SPEC_TEST_DIR) return; try { for (const p of openWindowsForNotices(scanRoot, itermShouldOpen(scanRoot))) fs.appendFileSync(path.join(root, '.spec', 'wake.log'), `${new Date().toISOString()} 터미널 창 ${p}\n`); } catch { /* 알림이 서버를 멈추지 않게 */ } };
  const reap = (): void => { try { reapTtyd(scanRoot); } catch { /* 정리 실패가 서버를 멈추지 않게 */ } };
  // 마지막 안전장치: 앞 겹이 뚫려 담당·메신저가 겹쳤을 때만 정리한다
  const keepAlive = (): void => { ensureMessenger(scanRoot); try { reconcile(scanRoot); markStalledReviews(scanRoot); } catch { /* 점검이 서버를 멈추지 않게 */ } };
  // 담당 확인이 안 된 채 20초 넘게 남은 대기 줄을 다시 시키는 것은, 줄이 적힌 순간 그 건의 20초 뒤에 한 번만 도는 타이머로 한다
  let kickT: NodeJS.Timeout | undefined;
  const armKick = (): void => {
    clearTimeout(kickT);
    const wait = nextKickIn(scanRoot);
    if (wait == null) return;
    kickT = setTimeout(() => { try { kickWaiting(scanRoot); } catch { /* 점검이 서버를 멈추지 않게 */ } }, wait + 50);
    kickT.unref();
  };
  const staleCheck = (): void => { if (!staleServer()) return; handOver(root); setTimeout(() => process.exit(0), 300); };
  const on = (kind: TriggerKind): void => {
    if (kind === 'requests') { openWindows(); reap(); keepAlive(); }
    if (kind === 'outbox') { keepAlive(); armKick(); }
    if (kind === 'sessions') { reap(); keepAlive(); }
    if (kind === 'tool') staleCheck();
  };
  watchTriggers(scanRoot, on, { kinds: ['requests', 'outbox', 'sessions', 'tool'] });
  openWindows(); reap(); keepAlive(); armKick(); staleCheck();
  server.listen(port, () => console.log(`설계서 보기: http://localhost:${port}/\n앱 중계: ${app ? `${app.origin} (설계서 안에 끼워 넣어 보인다)` : '없음'}\n소스: ${scanRoot}`));
  return undefined;
}
