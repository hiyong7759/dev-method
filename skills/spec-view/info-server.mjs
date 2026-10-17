// 정보 보기 서버 — 프로젝트 소스를 분석해 "어떤 정보가 있고 어디서 읽고 쓰나"를 웹 페이지로 보여준다.
// 존재 이유: 화면을 실행하지 않아도(네이티브 앱 포함) 소스만으로 정보 목록·사용 영역·확인 필요 지점을 볼 수 있게 하려고.
//   프로젝트 파일은 읽기만 하고 아무것도 쓰지 않는다. 분석 결과는 메모리에만 두고 "다시 분석" 때 새로 만든다(원본은 소스).
// 사용: node info-server.mjs <프로젝트 폴더> [포트=5240]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTs } from './analyze-ts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 5240);
let cache = null;

function analyze() {
  const t = Date.now();
  console.log(`분석 시작: ${root}`);
  cache = analyzeTs(root);
  console.log(`분석 끝: 정보 ${cache.infos.length}개, ${Date.now() - t}ms`);
  return cache;
}

analyze();
http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  try {
    if (url === '/api/info.json') { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(cache)); }
    else if (url === '/api/reanalyze') { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(analyze())); }
    else if (url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(HERE, 'info-viewer.html'))); }
    else { res.statusCode = 404; res.end('없음'); }
  } catch (e) { res.statusCode = 500; res.end(String(e)); }
}).listen(port, () => console.log(`정보 보기: http://localhost:${port}`));
