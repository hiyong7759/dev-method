// 앱 화면 아래 구석의 "설계서 보기" 토글. 켜면 설계서 보기 화면(지금 보던 화면의 설계서)으로 간다. 설계서 보기 안의 화면(iframe)에서는 나타나지 않는다.
// 존재 이유: 앱을 쓰다가 같은 자리에서 설계서로 넘어가고, 확인할 일(테스트 요청, 전달 전 메모)이 있으면 닫혀 있어도 깜빡여 알리려고.
import { matchScreen } from '/__spec/ui/util.js';

if (window.top === window.self) {
  const host = document.createElement('div');
  host.style.cssText = 'all:initial';
  document.documentElement.appendChild(host);
  const sh = host.attachShadow({ mode: 'open' });
  sh.innerHTML = `<style>
    .fab{position:fixed;right:20px;bottom:16px;z-index:2147483001;display:flex;align-items:center;gap:10px;min-height:44px;padding:0 16px 0 14px;border:1px solid #3a362f;border-radius:22px;background:#1c1a17;color:#efe9e0;font:500 13px -apple-system,'Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif;box-shadow:0 6px 20px rgba(28,26,23,.28);cursor:pointer}
    .sw{position:relative;width:36px;height:20px;border-radius:10px;background:#5a564f}.sw i{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:8px;background:#efe9e0}
    .b{font-size:11px;padding:1px 7px;border-radius:10px;font-weight:700;color:#14161f}.b.t{background:#9db4ff}.b.c{background:#e0b25a}.b.m{background:#c9b0ff}.b.hide{display:none}
    @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(157,180,255,.6)}50%{box-shadow:0 0 0 7px rgba(157,180,255,0)}}
    @media (prefers-reduced-motion:no-preference){.b{animation:pulse 1.8s ease-in-out infinite}}
  </style>
  <button class="fab" aria-pressed="false"><span>설계서 보기</span><span class="b t hide">테스트 요청</span><span class="b c hide">승인 후 변경됨</span><span class="b m hide">메모 전달 전</span><span class="sw"><i></i></span></button>`;
  const btn = sh.querySelector('.fab');
  let current = null;
  const refresh = () => fetch('/__spec/model.json', { cache: 'no-store' }).then((r) => r.json()).then((m) => {
    current = matchScreen(m, location.pathname);
    const st = current?.status.status;
    sh.querySelector('.b.t').classList.toggle('hide', st !== 'test-requested');
    sh.querySelector('.b.c').classList.toggle('hide', st !== 'approved-changed');
    sh.querySelector('.b.m').classList.toggle('hide', !(current ? current.memoPending : m.summary.memosUndelivered));
  }).catch(() => {});
  refresh(); setInterval(refresh, 4000);
  btn.addEventListener('click', () => {
    const at = location.pathname + location.search;
    location.href = `/__spec/?at=${encodeURIComponent(at)}#/${current ? `screen/${encodeURIComponent(current.name)}` : 'map'}`;
  });
}
