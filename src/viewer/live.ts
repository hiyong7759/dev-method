/**
 * @spec viewer-live 서버가 보내는 알림 받기
 * @why 화면이 2.5초·3초마다 서버에 물어보면 아무것도 안 바뀐 동안에도 서버가 일한다(요청 #107). 서버가 "모델/탭이 달라졌다"고 알려 줄 때만 새로 받는다.
 * @contract 서버(/__spec/events)는 연결될 때 현재 번호를 한 번 보내고, 달라질 때마다 보낸다. 끊겼다 다시 연결되면 그때도 현재 번호가 오므로 그 사이에 놓친 것을 한 번 새로 받아 메운다(브라우저가 연결을 스스로 다시 건다). 연결이 끊긴 동안은 onDown이 불린다.
 */
/** 서버가 알려 주는 번호들. 번호가 달라졌을 때만 새로 받는다 */
export interface Versions {
  /** 설계서 보기 모델의 번호(모델 내용이 달라질 때 오른다) */
  model: number;
  /** 터미널 탭 목록의 번호(탭이 달라질 때 오른다) */
  tabs: number;
}

const onVersions = new Set<(v: Versions) => void>();
const onDownFns = new Set<() => void>();
let started = false;

/** 알림을 받을 함수를 건다(처음 걸 때 연결을 연다) */
export function live(fn: (v: Versions) => void, down?: () => void): void {
  onVersions.add(fn);
  if (down) onDownFns.add(down);
  if (started) return;
  started = true;
  const es = new EventSource('/__spec/events');
  es.onmessage = (e) => { try { const v = JSON.parse(e.data) as Versions; for (const f of onVersions) f(v); } catch { /* 모양이 다른 알림은 무시 */ } };
  es.onerror = () => { for (const f of onDownFns) f(); };
}
