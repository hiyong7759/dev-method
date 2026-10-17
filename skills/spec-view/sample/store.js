/**
 * @spec store 저장
 * @why 새로고침해도 적은 할 일이 남게, 목록을 한곳에 모아 저장하고 불러온다.
 * @basis 서버 없이 브라우저 localStorage에만 둔다 — 시험용이라 가장 단순한 방식
 * @contract 저장 형식(문자열 배열)을 바꾸면 옛 저장을 못 읽는다. 바꿀 때 load도 함께 고친다.
 */
const KEY = 'spec-view-sample.todos';

export function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

export function add(text) {
  const items = [text, ...load()];
  localStorage.setItem(KEY, JSON.stringify(items));
}
