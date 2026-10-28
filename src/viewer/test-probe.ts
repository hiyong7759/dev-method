/**
 * @spec test-probe 테스트 화면 안쪽의 짚기 도우미
 * @why 테스트 화면 안쪽의 실제 화면은 테스트 서버(바깥과 다른 출처)라 바깥 코멘트 도구가 그 안의 부품과 모습을 읽지 못한다. 안쪽 화면에 이 작은 도우미를 두면 바깥이 묻는 대로 "그 자리의 부품 이름과 위치"와 "지금 화면 캡처"를 메시지로 돌려줘, 안쪽이 어떤 앱이든 같은 방식으로 짚을 수 있다.
 * @basis 다른 화면 안에 끼워 열렸을 때만 동작한다. 앱 중계(serve.ts)가 끼워 열린 앱 화면에 이 파일을 넣어 주고, 설계서 보기 자신이 앱인 프로젝트(dev-method)는 app.ts가 끼워 열린 때 직접 불러온다. 두 번 불려도 한 번만 동작한다.
 * @contract 바깥(테스트 화면)이 보내는 메시지만 받는다: 보낸 창이 부모 창이어야 한다. 메시지 모양은 { spec: 'probe', id, type: 'at' | 'capture', x?, y? }이고 답은 { spec: 'probe-reply', id, ... }로 보낸 창에 돌려준다. 이 파일은 다른 파일을 가져오지 않는다(앱 화면에서 단독으로 불려도 돌도록).
 */

interface Box { x: number; y: number; w: number; h: number }
interface ProbeAsk { spec: 'probe'; id: number; type: 'at' | 'capture' | 'info'; x?: number; y?: number }

/** 이 자리의 부품을 찾는다: data-ctarget이 붙은 곳, 아니면 글이 있고 화면 대부분을 덮지 않는 가장 가까운 덩어리 */
function partAt(x: number, y: number): { box: Box; label: string; src?: string } | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  const vw = innerWidth * innerHeight;
  while (el && el !== document.body && el !== document.documentElement) {
    const marked = el.closest<HTMLElement>('[data-ctarget]');
    if (marked?.dataset.ctarget) {
      try {
        const t = JSON.parse(marked.dataset.ctarget) as { label?: string; src?: string };
        const r = marked.getBoundingClientRect();
        return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, label: t.label ?? '', ...(t.src ? { src: t.src } : {}) };
      } catch { /* 깨진 표시는 무시하고 아래로 간다 */ }
    }
    const r = el.getBoundingClientRect();
    const text = (el.innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
    if (r.width >= 24 && r.height >= 16 && r.width * r.height < vw * 0.6 && text) {
      return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, label: `${document.title || location.pathname} › ${text.slice(0, 30)}` };
    }
    el = el.parentElement;
  }
  return null;
}

/** 지금 보이는 화면을 그림(png 데이터 주소)으로 찍는다. 찍는 도구는 처음 필요할 때 같은 서버에서 불러온다 */
async function capture(): Promise<string> {
  const w = window as unknown as { htmlToImage?: { toPng: (n: HTMLElement, o?: object) => Promise<string> } };
  if (!w.htmlToImage) await new Promise<void>((ok, bad) => { const s = document.createElement('script'); s.src = '/__spec/vendor/html-to-image.js'; s.onload = () => ok(); s.onerror = () => bad(new Error('캡처 도구를 못 불러옴')); document.head.append(s); });
  // 찍는 도구는 스크롤을 무시하고 맨 위부터 그리므로, 지금 스크롤만큼 밀어 보이는 모습 그대로 찍는다
  return (w.htmlToImage as { toPng: (n: HTMLElement, o?: object) => Promise<string> }).toPng(document.documentElement, { pixelRatio: 1, width: innerWidth, height: innerHeight, style: { transform: `translate(${-scrollX}px, ${-scrollY}px)` } });
}

(function start(): void {
  const w = window as unknown as { __specProbe?: boolean };
  if (w.__specProbe || window.parent === window) return;
  w.__specProbe = true;
  // 안쪽 화면을 누르는 중에도 Alt로 짚기를 잠깐 켤 수 있게, Alt가 눌리고 떼어지는 것만 바깥에 알린다(다른 키는 보내지 않는다)
  const key = (down: boolean) => (ev: KeyboardEvent): void => { if (ev.key === 'Alt') window.parent.postMessage({ spec: 'probe-key', down }, '*'); };
  document.addEventListener('keydown', key(true)); document.addEventListener('keyup', key(false));
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const d = e.data as ProbeAsk | null;
    if (!d || d.spec !== 'probe') return;
    const reply = (extra: object): void => (e.source as Window).postMessage({ spec: 'probe-reply', id: d.id, url: location.pathname + location.search + location.hash, ...extra }, e.origin === 'null' ? '*' : e.origin);
    if (d.type === 'info') { reply({}); return; }
    if (d.type === 'at') { reply({ part: partAt(d.x ?? 0, d.y ?? 0) }); return; }
    if (d.type === 'capture') { capture().then((shot) => reply({ shot })).catch((err: unknown) => reply({ shot: '', error: err instanceof Error ? err.message : String(err) })); }
  });
})();

export {};
