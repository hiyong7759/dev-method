// 옛 방식: 프로젝트의 vite에 플러그인으로 설계서 보기를 붙였다. 지금은 serve.mjs(중계 서버)로 바뀌었다.
// 이 파일은 vite.config가 아직 import하고 있어도 깨지지 않게 두는 빈 껍데기다. vite.config에서 이 플러그인을 지운다.
export default function specView() {
  return { name: 'spec-view-removed', apply: 'serve', configureServer() { console.warn('[spec-view] vite 플러그인은 더 쓰지 않는다. vite.config에서 지우고 serve.mjs로 설계서 보기를 띄운다.'); } };
}
export const FAB_TAG = '';
