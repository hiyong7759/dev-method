/**
 * @spec memo 서버가 git 같은 느린 조회 결과를 잠시 기억해 쓰는 곳
 * @why 화면은 2.5초마다 데이터를 다시 요청하고, 한 번 만들 때마다 git을 20번쯤 동기로 실행해 서버가 막혔다(실측: 8초 중 5.2초가 git 대기). 같은 조회를 짧은 시간 기억하면 탭이 몇 개 열려 있어도 서버가 밀리지 않는다.
 * @contract 서버가 시작할 때 enableMemo()를 불러야 켜진다. 켜지지 않으면(시험·명령줄) 매번 새로 조회해 결과가 늘 최신이다. 기억은 만든 뒤 ttlMs가 지나면 버린다. 던지지 않고, 조회 함수가 던지면 그대로 던지며 기억하지 않는다.
 */
let enabled = false;
const store = new Map<string, { at: number; value: unknown }>();

/** 서버가 시작할 때 부른다 */
export const enableMemo = (): void => { enabled = true; };
/** 시험이 기억을 비운다 */
export const clearMemo = (): void => store.clear();

/** key로 ttlMs 안에 한 번 계산한 값이 있으면 그것을, 없으면 fn()을 불러 기억한다 */
export function memo<T>(key: string, ttlMs: number, fn: () => T): T {
  if (!enabled) return fn();
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = fn();
  store.set(key, { at: now, value });
  if (store.size > 2000) for (const [k, v] of store) if (now - v.at >= ttlMs) store.delete(k);
  return value;
}
