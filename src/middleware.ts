/**
 * @spec spec-handler 설계서 보기 접속 부분
 * @why 서버 종류(vite, 순수 node)와 무관하게 같은 경로로 설계서 보기를 내놓는다. 요청 때마다 소스에서 다시 만든 모델을 보여 주고, 사용자가 화면에서 남기는 상태·확인 목록·메모·요청 결정을 프로젝트 .spec 폴더에만 쓴다.
 * @basis 개발 서버에서만 쓴다. 운영 빌드에는 이 파일도 화면도 들어가지 않는다.
 * @contract 경로: /__spec/ 설계서 보기 화면, /__spec/model.json 모델, /__spec/history.json 화면 이력, 나머지 POST는 상태·확인 목록·메모·캡처·처리 요청 글과, 사용자만 하는 결정(리포트 처리, 설계·테스트 승인·반려, 요청 순서)이다. 화면(viewer/)이 이 경로를 그대로 부른다. 에이전트용 상태 명령이 거부하는 승인·수정 필요·승인 취소는 여기(사용자 화면)에서만 받는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { transformSync } from 'esbuild';
import { extractSpecs } from './extract.js';
import { buildModel } from './model.js';
import { specDir } from './project.js';
import { screenHistory } from './history.js';
import { decide, addNote } from './report.js';
import { addComment, replyComment, closeComment, commentToRequest, shotDir } from './comment.js';
import { addRequest, startDesign, recordUntracked, approveDesign, rejectDesign, redesign, checkTest, approveTest, testProblem, setOrder } from './request.js';
import { wakeOwner } from './wake.js';
import { startOwner } from './session.js';
import { errorText } from './cli.js';
import { ROOT_DIR, SKILL_DIR, VIEWER_DIR } from './paths.js';

/** 파일 확장자별 응답 종류 */
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

/** 화면 코드는 TypeScript로 쓰므로, 브라우저가 .js를 달라고 하면 같은 이름의 .ts를 JavaScript로 바꿔 준다(고친 파일만 다시 바꾼다) */
const compiled = new Map<string, { mtime: number; code: string }>();
function viewerScript(file: string): string | null {
  const ts = file.replace(/\.js$/, '.ts');
  if (!fs.existsSync(ts)) return null;
  const mtime = fs.statSync(ts).mtimeMs;
  const hit = compiled.get(ts);
  if (hit && hit.mtime === mtime) return hit.code;
  const code = transformSync(fs.readFileSync(ts, 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' }).code;
  compiled.set(ts, { mtime, code });
  return code;
}

/** 서버가 넘겨 주는 다음 처리기(설계서 보기 경로가 아니면 호출) */
type Next = () => void;
/** 설계서 보기 요청 처리기 */
export type SpecHandler = (req: IncomingMessage, res: ServerResponse, next: Next) => Promise<void>;
/** 화면이 보내는 JSON 본문(어떤 요청이냐에 따라 필요한 칸이 다르다) */
type Body = Record<string, unknown>;

/** 소스 폴더의 설계서 보기를 내놓는 요청 처리기를 만든다 */
export function specHandler(scanRoot: string): SpecHandler {
  const json = (res: ServerResponse, obj: unknown, code = 200): void => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  const body = (req: IncomingMessage): Promise<Body> => new Promise((ok) => {
    let b = '';
    req.on('data', (c: Buffer) => { b += c; });
    req.on('end', () => { try { ok(JSON.parse(b || '{}') as Body); } catch { ok({}); } });
  });
  const send = (res: ServerResponse, file: string): void => {
    res.setHeader('content-type', `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`);
    res.setHeader('cache-control', 'no-store');
    res.end(fs.readFileSync(file));
  };
  return async (req, res, next) => {
    const u = new URL(req.url || '/', 'http://x');
    const url = u.pathname;
    if (!url.startsWith('/__spec')) return next();
    try {
      if (url === '/__spec' || url === '/__spec/') return send(res, path.join(VIEWER_DIR, 'index.html'));
      if (url.startsWith('/__spec/ui/')) {
        const f = path.resolve(VIEWER_DIR, url.slice('/__spec/ui/'.length));
        if (!f.startsWith(VIEWER_DIR + path.sep)) { res.statusCode = 404; return void res.end('없음'); }
        const code = f.endsWith('.js') ? viewerScript(f) : null;
        if (code != null) { res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.setHeader('cache-control', 'no-store'); return void res.end(code); }
        if (!fs.existsSync(f)) { res.statusCode = 404; return void res.end('없음'); }
        return send(res, f);
      }
      if (url === '/__spec/vendor/html-to-image.js') return send(res, path.join(ROOT_DIR, 'node_modules', 'html-to-image', 'dist', 'html-to-image.js'));
      if (url.startsWith('/__spec/shots/')) {
        const f = path.join(specDir(scanRoot), 'shots', path.basename(url));
        if (!fs.existsSync(f)) { res.statusCode = 404; return void res.end('없음'); }
        res.setHeader('content-type', 'image/png'); res.setHeader('cache-control', 'no-store');
        return void res.end(fs.readFileSync(f));
      }
      if (url.startsWith('/__spec/comment-shots/')) {
        const f = path.join(shotDir(scanRoot), path.basename(url));
        if (!fs.existsSync(f)) { res.statusCode = 404; return void res.end('없음'); }
        res.setHeader('content-type', 'image/png'); res.setHeader('cache-control', 'no-store');
        return void res.end(fs.readFileSync(f));
      }
      if (url === '/__spec/model.json') return json(res, buildModel(scanRoot));
      if (url === '/__spec/history.json') {
        const out = extractSpecs(scanRoot);
        const sc = out.screens.find((s) => s.name === u.searchParams.get('screen'));
        if (!sc) return json(res, { items: [] });
        const m = buildModel(scanRoot);
        return json(res, { items: screenHistory(scanRoot, sc, { specs: m.specs, screens: m.screens, infos: m.infos }) });
      }
      if (req.method === 'POST') {
        const b = await body(req);
        if (url === '/__spec/shot') {
          // 화면 캡처 저장 (설계서 보기가 브라우저에서 찍은 PNG). 이름은 안전한 문자만
          const name = String(b.name || ''), data = String(b.data || '');
          if (!/^[\w.-]+\.png$/.test(name) || !data.startsWith('data:image/png;base64,')) throw new Error('캡처 이름이나 형식이 맞지 않는다');
          const dir = path.join(specDir(scanRoot), 'shots');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name), Buffer.from(data.split(',')[1], 'base64'));
          return json(res, { name });
        }
        // 사용자만 하는 결정: 리포트(확인 필요 포함) 처리와 요청의 승인·반려·순서. 에이전트용 명령은 이것들을 할 수 없다
        if (url === '/__spec/report/decide') {
          const id = String(b.id || ''), state = String(b.state || '');
          if (state !== 'registered' && state !== 'kept' && state !== 'tool') throw new Error('처리는 요청으로 처리·그냥 둠·도구 개선으로 전달 중 하나다(더 분석은 /__spec/report/analyze)');
          let request: number | undefined;
          if (state === 'registered') {
            const row = buildModel(scanRoot).reports.find((r) => r.id === id);
            if (!row) throw new Error('이 항목을 찾지 못했다');
            const screens = row.where.filter((w) => w.kind === 'screen').map((w) => w.name), infos = row.where.filter((w) => w.kind === 'info').map((w) => w.name);
            request = addRequest(scanRoot, { title: row.title, origin: row.detail, channel: row.origin === 'review' ? '확인 필요' : '리포트', screens, infos, source: 'report' }).id;
          }
          return json(res, decide(scanRoot, id, { state, request, reason: b.reason ? String(b.reason) : undefined }));
        }
        // 코멘트: 사용자의 글만 여기서 받는다(에이전트의 답은 명령으로)
        if (url === '/__spec/comment/add') return json(res, addComment(scanRoot, { target: b.target as never, text: String(b.text || ''), shot: b.shot ? String(b.shot) : undefined }));
        // 담아 둔 코멘트를 한번에 보낸다. 테스트 요청 번호가 오면 같은 묶음이 그 요청의 반려가 된다(담은 게 없으면 이유 한 줄)
        if (url === '/__spec/comment/send') {
          const items = (Array.isArray(b.items) ? b.items : []) as { target: never; text?: string; shot?: string }[];
          const request = b.request ? Number(b.request) : 0;
          if (!items.length && !request) throw new Error('보낼 코멘트가 없다');
          if (items.some((i) => !String(i.text ?? '').trim())) throw new Error('글이 빈 코멘트가 있다 — 고치거나 지운 뒤 다시 보낸다');
          if (request) testProblem(scanRoot, request, items.length ? `담은 코멘트 ${items.length}건을 한번에 보냄 — \`comment list\`로 읽는다${b.note ? `: ${String(b.note)}` : ''}` : String(b.note || ''));
          const sent = items.map((i) => addComment(scanRoot, { target: i.target, text: String(i.text), shot: i.shot || undefined }));
          if (request) wakeOwner(scanRoot, request);
          return json(res, sent);
        }
        if (url === '/__spec/comment/reply') return json(res, replyComment(scanRoot, Number(b.id), 'user', String(b.text || '')));
        if (url === '/__spec/comment/close') return json(res, closeComment(scanRoot, Number(b.id)));
        if (url === '/__spec/comment/to-request') return json(res, commentToRequest(scanRoot, Number(b.id), String(b.title || '')));
        // 더 분석: 사용자 의견(생략 가능)을 붙여 에이전트에게 더 조사시킨다. 결정은 아니므로 카드는 확인 중이 될 뿐이다
        if (url === '/__spec/report/analyze') {
          const id = String(b.id || '');
          if (!buildModel(scanRoot).reports.some((r) => r.id === id)) throw new Error('이 항목을 찾지 못했다 — 화면을 새로 고쳐 다시 본다');
          return json(res, addNote(scanRoot, id, { by: 'user', text: String(b.opinion || '') }));
        }
        // 묶음 처리: 같은 판단을 여러 줄에 한꺼번에 내린다. 요청으로 등록하면 고칠 일 하나(요청 하나)로 모은다
        if (url === '/__spec/report/decide-many') {
          const ids = (Array.isArray(b.ids) ? b.ids : []).map(String), state = String(b.state || '');
          if (!ids.length) throw new Error('처리할 항목이 없다');
          if (state !== 'registered' && state !== 'kept' && state !== 'tool') throw new Error('처리는 요청으로 처리·그냥 둠·도구 개선으로 전달 중 하나다');
          let request: number | undefined;
          if (state === 'registered') {
            const rows = buildModel(scanRoot).reports.filter((r) => ids.includes(r.id));
            if (rows.length !== ids.length) throw new Error('이미 해소됐거나 찾지 못한 항목이 있다 — 화면을 새로 고쳐 다시 본다');
            const names = (kind: string): string[] => [...new Set(rows.flatMap((r) => r.where.filter((w) => w.kind === kind).map((w) => w.name)))];
            request = addRequest(scanRoot, { title: String(b.title || rows[0].title), origin: rows.map((r) => `#${r.no} ${r.title}`).join('\n'), channel: rows.some((r) => r.origin === 'review') ? '확인 필요' : '리포트', screens: names('screen'), infos: names('info'), source: 'report' }).id;
          }
          return json(res, ids.map((id) => decide(scanRoot, id, { state, request, reason: b.reason ? String(b.reason) : undefined })));
        }
        if (url === '/__spec/request/record') return json(res, recordUntracked(scanRoot, String(b.hash || ''), String(b.title || '')));
        // 결정이 저장되면 그 요청을 맡은 세션이 닫혀 있을 때만 깨운다(열린 세션은 inbox 훅이 알린다)
        // 사용자가 '지금 다시 보내기'를 누르면 마지막 결정을 일하는 중인 세션에도 다시 보낸다
        if (url === '/__spec/request/resend') return json(res, { woken: wakeOwner(scanRoot, Number(b.id), true).length });
        if (url === '/__spec/request/start') { const r = startDesign(scanRoot, Number(b.id)); startOwner(scanRoot, Number(b.id), 'start'); return json(res, r); }
        if (url === '/__spec/request/design-approve') { const r = approveDesign(scanRoot, Number(b.id)); wakeOwner(scanRoot, Number(b.id)); return json(res, r); }
        if (url === '/__spec/request/design-reject') { const r = rejectDesign(scanRoot, Number(b.id), String(b.note || '')); wakeOwner(scanRoot, Number(b.id)); return json(res, r); }
        if (url === '/__spec/request/redesign') { const r = redesign(scanRoot, Number(b.id), 'user', String(b.reason || '')); wakeOwner(scanRoot, Number(b.id)); return json(res, r); }
        if (url === '/__spec/request/test-check') return json(res, checkTest(scanRoot, Number(b.id), String(b.key || ''), !!b.done));
        if (url === '/__spec/request/test-approve') { const r = approveTest(scanRoot, Number(b.id), !!b.none); wakeOwner(scanRoot, Number(b.id)); return json(res, r); }
        if (url === '/__spec/request/test-problem') { const r = testProblem(scanRoot, Number(b.id), String(b.note || '')); wakeOwner(scanRoot, Number(b.id)); return json(res, r); }
        if (url === '/__spec/request/order') { const r = setOrder(scanRoot, Number(b.first), Number(b.other)); wakeOwner(scanRoot, Number(b.other)); return json(res, r); }
      }
      res.statusCode = 404;
      res.end('없음');
    } catch (e) { json(res, { error: errorText(e) }, 400); }
  };
}
