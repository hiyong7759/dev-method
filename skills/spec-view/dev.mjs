// 프레임워크 없는 프로젝트용 개발 서버 — 폴더를 그대로 내보내면서 html에 설계서 보기를 붙인다.
// 존재 이유: 어떤 프로젝트든(번들러가 없어도) 같은 설계서 보기를 쓰게 하고, 도구 자체를 샘플로 시험하기 위해.
// 사용: node dev.mjs <폴더> [포트=5200]   (개발 서버이므로 운영 배포에 쓰지 않는다)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { specHandler, OVERLAY_TAG } from './middleware.mjs';

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 5200);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const spec = specHandler(root);

http.createServer((req, res) => {
  spec(req, res, () => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('없음'); return; }
    const ext = path.extname(file);
    res.setHeader('content-type', TYPES[ext] || 'application/octet-stream');
    if (ext === '.html') res.end(fs.readFileSync(file, 'utf8').replace('</body>', `${OVERLAY_TAG}</body>`));
    else res.end(fs.readFileSync(file));
  });
}).listen(port, () => console.log(`설계서 보기 개발 서버: http://localhost:${port}  (폴더 ${root})`));
