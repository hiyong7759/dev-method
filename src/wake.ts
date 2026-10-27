/**
 * @spec wake-session 요청 시작과 시작 글 적기
 * @why 요청을 시작하면 설계를 시작한 기록을 남기고 담당 세션에 시작 글이 가야 한다. 예전에는 서버가 닫힌 세션을 헤드리스(claude -p)로 깨우고 재전송·멈춤 재깨움까지 했지만, 열린 창에 사용자 메시지처럼 들어가지 않아 결정이 사라졌다. 이제 서버는 아무 프로세스도 띄우지 않고 보낼 글을 outbox.ts에 적기만 한다.
 * @contract 화면의 시작 단추와 `request start`가 함께 쓴다. 설계 시작 기록 → 전달 기록 열기 → 시작 글을 상자에 적기 순서이며, 적기가 실패해도 설계 시작은 성공한다. 보내는 일과 재시도는 메신저 세션과 사용자의 다시 보내기가 한다(서버의 자동 재전송·멈춤 재깨움은 없다).
 */
import { enqueueOutbox } from './outbox.js';
import type { OutboxRow } from './outbox.js';
import { startDesign } from './request.js';

/** 요청을 시작한다: 설계 시작 기록 → 전달 기록 열기와 시작 글 적기. 적은 줄을 돌려준다(없으면 null) */
export function startRequest(scanRoot: string, id: number): { request: ReturnType<typeof startDesign>; row: OutboxRow | null } {
  const request = startDesign(scanRoot, id);
  return { request, row: enqueueOutbox(scanRoot, id, 'start') };
}
