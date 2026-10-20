/**
 * @spec viewer-route 설계서 보기의 주소 만들기와 이동
 * @why 화면마다 이동 방법을 따로 만들면 어디로 가는지 코드에서 읽을 수 없으므로, 주소(#)를 만드는 것과 이동하는 것을 한 곳에 둔다. 이동 검사(nav)가 hash(...) 호출을 읽어 사용 흐름의 이동을 확인한다.
 * @contract 주소 모양은 #/<보는 곳>/<대상>[/<그 아래 쪽>]?<쿼리>다(대상에 /를 넣으면 아래 쪽으로 나뉜다). app.ts가 같은 모양으로 읽는다.
 */

/** 가고 싶은 곳을 주소(#)로 만든다 */
export const hash = (view: string, arg = '', params: Record<string, string | undefined> = {}): string => {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return `#/${view}${arg ? `/${arg.split('/').map(encodeURIComponent).join('/')}` : ''}${qs ? `?${qs}` : ''}`;
};

/** 주소를 바꿔 이동한다(replace면 뒤로 가기 기록을 남기지 않는다) */
export const nav = (hh: string, replace?: boolean): void => { if (replace) history.replaceState(null, '', hh); else location.hash = hh; };
