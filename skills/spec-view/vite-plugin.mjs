// vite 프로젝트용 접속 — vite.config의 plugins에 specView({ scan: '..' })를 넣는다.
// 존재 이유: 개발 서버(apply: 'serve')에서만 동작하게 해 운영 빌드에 설계서 보기가 섞이지 않게 하려고.
// scan: 주석을 모을 폴더(기본은 vite 루트). 소스가 vite 루트 밖에도 있으면 그 위 폴더를 준다.
import path from 'node:path';
import { specHandler, OVERLAY_TAG } from './middleware.mjs';

export default function specView({ scan } = {}) {
  let root = process.cwd();
  return {
    name: 'spec-view',
    apply: 'serve',
    configResolved(config) { root = config.root; },
    configureServer(server) {
      server.middlewares.use(specHandler(scan ? path.resolve(scan) : root));
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/__spec/overlay.js' }, injectTo: 'body' }];
    },
  };
}
export { OVERLAY_TAG };
