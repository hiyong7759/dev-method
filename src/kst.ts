/**
 * @spec kst-time 시각을 한국시간으로 보여 주기
 * @why 기록은 UTC(세계 표준시)로 저장되는데, 에이전트와 사용자에게 그대로 보이면 한국시간보다 9시간 이른 시각을 사실처럼 옮겨 말하게 된다. 사람과 에이전트가 읽는 글은 모두 이 함수를 거쳐 한국시간으로 보여 준다.
 * @contract 저장 값(ISO 문자열)은 그대로 두고 보여 줄 때만 바꾼다. 결과는 "MM-DD HH:mm KST"이고, 읽을 수 없는 값은 그대로 돌려준다. 서버·화면 양쪽에서 쓰므로 Node 전용 모듈을 쓰지 않는다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 시각을 "MM-DD HH:mm KST"로. withYear면 "YYYY-MM-DD HH:mm KST" */
export function kst(iso: string, withYear = false): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = new Date(t + KST_OFFSET_MS).toISOString();
  return `${withYear ? s.slice(0, 10) : s.slice(5, 10)} ${s.slice(11, 16)} KST`;
}
