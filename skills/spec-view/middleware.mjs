// 개발 서버에 설계서 보기를 붙이는 접속 부분 — 서버 종류(vite, 순수 node)와 무관하게 같은 경로를 낸다.
//   /__spec/            설계서 보기 화면(화면 흐름·정보 흐름·화면 설계서)
//   /__spec/fab.js      앱 화면 아래 구석의 "설계서 보기" 토글(누르면 위 화면으로 간다)
//   /__spec/model.json  요청 때마다 소스에서 다시 만든 모델 (저장물 없음)
//   /__spec/*           상태·확인 목록·메모·히스토리·처리 요청 글 (쓰기는 프로젝트 .spec 폴더만)
// 개발 서버에서만 쓴다: 운영 빌드에는 이 파일도 화면도 들어가지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSpecs } from './extract.mjs';
import { buildModel } from './model.mjs';
import { allStatus, setStatus, setCheck, specDir } from './status.mjs';
import { addMemo, confirmMemo, markCopied, exportText, loadMemos } from './memo.mjs';
import { screenHistory } from './history.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FAB_TAG = '<script type="module" src="/__spec/fab.js"></script>';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export function specHandler(scanRoot) {
  const json = (res, obj, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
  const send = (res, file) => {
    const ext = path.extname(file);
    res.setHeader('content-type', `${TYPES[ext] || 'application/octet-stream'}; charset=utf-8`); res.setHeader('cache-control', 'no-store');
    res.end(fs.readFileSync(file));
  };
  return async (req, res, next) => {
    const u = new URL(req.url || '/', 'http://x');
    const url = u.pathname;
    if (!url.startsWith('/__spec')) return next();
    try {
      if (url === '/__spec' || url === '/__spec/') return send(res, path.join(HERE, 'viewer', 'index.html'));
      if (url === '/__spec/fab.js') return send(res, path.join(HERE, 'viewer', 'fab.js'));
      if (url.startsWith('/__spec/ui/')) {
        const f = path.resolve(HERE, 'viewer', url.slice('/__spec/ui/'.length));
        if (!f.startsWith(path.join(HERE, 'viewer') + path.sep) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('없음'); }
        return send(res, f);
      }
      if (url === '/__spec/vendor/html-to-image.js') return send(res, path.join(HERE, 'node_modules', 'html-to-image', 'dist', 'html-to-image.js'));
      if (url.startsWith('/__spec/shots/')) {
        const f = path.join(specDir(scanRoot), 'shots', path.basename(url));
        if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('없음'); }
        res.setHeader('content-type', 'image/png'); res.setHeader('cache-control', 'no-store'); return res.end(fs.readFileSync(f));
      }
      if (url === '/__spec/model.json') return json(res, buildModel(scanRoot));
      if (url === '/__spec/history.json') {
        const out = extractSpecs(scanRoot);
        const sc = out.screens.find((s) => s.name === u.searchParams.get('screen'));
        if (!sc) return json(res, { items: [] });
        return json(res, { items: screenHistory(scanRoot, sc, allStatus(scanRoot, out)[sc.name]) });
      }
      if (req.method === 'POST') {
        const b = await body(req);
        // 승인·수정 필요·승인 취소는 사용자가 설계서 보기에서만 남긴다 (에이전트용 status 명령은 이 값들을 거부한다)
        if (url === '/__spec/status.json') return json(res, setStatus(scanRoot, b.screen, b.status, { by: 'user', note: String(b.note || ''), shot: /^[\w.-]+\.png$/.test(b.shot || '') ? b.shot : '' }));
        if (url === '/__spec/shot') {
          // 화면 캡처 저장 (설계서 보기가 브라우저에서 찍은 PNG). 이름은 안전한 문자만
          if (!/^[\w.-]+\.png$/.test(b.name || '') || !String(b.data || '').startsWith('data:image/png;base64,')) throw new Error('캡처 이름이나 형식이 맞지 않는다');
          const dir = path.join(specDir(scanRoot), 'shots'); fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, b.name), Buffer.from(b.data.split(',')[1], 'base64'));
          return json(res, { name: b.name });
        }
        if (url === '/__spec/check') return json(res, setCheck(scanRoot, b.screen, b.index, b.done));
        if (url === '/__spec/memo') return json(res, addMemo(scanRoot, b));
        if (url === '/__spec/memo/confirm') return json(res, confirmMemo(scanRoot, b.id));
        if (url === '/__spec/export') {
          const text = exportText(scanRoot, { screen: b.screen, scriptDir: HERE });
          const ids = loadMemos(scanRoot).memos.filter((m) => m.state === 'pending' && (!b.screen || m.screen === b.screen)).map((m) => m.id);
          if (b.mark) markCopied(scanRoot, ids);
          return json(res, { text, ids });
        }
      }
      res.statusCode = 404; res.end('없음');
    } catch (e) { json(res, { error: e.message }, 400); }
  };
}
