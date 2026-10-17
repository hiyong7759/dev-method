// 개발 서버에 설계서 보기를 붙이는 접속 부분 — 서버 종류(vite, 순수 node)와 무관하게 같은 두 경로를 낸다.
//   /__spec/spec.json : 요청 때마다 소스 주석을 다시 읽어 만든 설계 목록 (소스가 원본이라 저장물이 없다)
//   /__spec/overlay.js : 화면 위에 얹는 보기
// 개발 서버에서만 쓴다: 운영 빌드에는 이 파일도 오버레이도 들어가지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSpecs } from './extract.mjs';
import { currentStatus, setStatus } from './status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OVERLAY_TAG = '<script type="module" src="/__spec/overlay.js"></script>';

export function specHandler(scanRoot) {
  return (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/__spec/spec.json') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      const out = extractSpecs(scanRoot);
      res.end(JSON.stringify({ ...out, status: currentStatus(scanRoot, out) }));
    } else if (url === '/__spec/status.json') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (req.method === 'POST') {
        // 승인·수정 필요는 사용자가 설계서 보기에서만 남긴다 (에이전트용 명령은 이 둘을 거부한다)
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try { const { status, note } = JSON.parse(body || '{}'); res.end(JSON.stringify(setStatus(scanRoot, status, { by: 'user', note: String(note || '') }))); }
          catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
        });
      } else res.end(JSON.stringify(currentStatus(scanRoot)));
    } else if (url === '/__spec/overlay.js') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(fs.readFileSync(path.join(HERE, 'overlay.js')));
    } else next();
  };
}
