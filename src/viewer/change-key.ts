/**
 * @spec viewer-change-key 화면을 새로 그려야 할 만큼 달라졌는지 판단하는 값
 * @why 담당이 일하는 동안 활동 시각·비용·작업 폴더 상태는 계속 변한다. 이것까지 "달라짐"으로 보면 "새 내용이 있습니다" 알약이 쉬지 않고 떠서 읽던 화면 위에서 사용자를 방해한다(요청 #102).
 * @contract 같은 값이면 같은 글을 돌려준다. 모델을 만든 시각·코멘트와 요청의 활동(activity)·비용(cost)·작업 폴더 상태(worktree)는 뺀다. 나머지 내용이 달라지면 글도 달라진다.
 */
import type { Model } from '../types.js';

export function changeKey(m: Model): string {
  const requests = m.requests.map(({ activity: _a, cost: _c, worktree: _w, ...r }) => r);
  return JSON.stringify({ ...m, requests, generatedAt: 0, comments: 0 });
}
