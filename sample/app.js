// 할 일 샘플 화면의 동작 — 입력을 저장소에 넣고 목록과 개수를 다시 그린다.
// 존재 이유: 설계서 보기가 dom(화면 요소)과 로직(화면 없음) 두 종류를 모두 보여주는지 시험하려고.
import { load, add } from './store.js';

const list = document.getElementById('todo-list');
const count = document.getElementById('todo-count');

function draw() {
  const items = load();
  list.replaceChildren(...items.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  count.textContent = `${items.length}개`;
}

document.getElementById('todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('todo-input');
  if (input.value.trim()) add(input.value.trim());
  input.value = '';
  draw();
});
draw();
