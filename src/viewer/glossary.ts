/**
 * @spec glossary-view 용어집 화면
 * @why 이 도구와 일하는 방식에서 우리가 만든 말만 모아, 화면에서 점선이 그어진 말에 마우스를 올렸을 때 나오는 설명과 같은 글을 한곳에서 읽게 한다. 일반 개발 용어는 넣지 않는다.
 * @contract model.glossary를 그대로 그린다. 용어는 에이전트가 glossary 명령으로 관리하고 사람은 보기만 한다.
 */
import { h, pageHead } from './util.js';
import type { Model } from '../types.js';

/**
 * @screen 용어집
 * @route /__spec/#/manage/glossary
 * @domain 관리
 * @why 우리가 만든 용어만 모아 한곳에서 읽게 한다. 화면의 점선 말에 올린 툴팁과 같은 설명이다.
 * @does 용어를 찾아 설명을 읽는다 | 용어와 설명, 쓰이는 곳이 나온다 | 용어집을 읽는다#1
 */
export function glossaryView(root: HTMLElement, { model, term }: { model: Model; term: string }): void {
  const input = h('input', { class: 'gl-search', placeholder: '용어 찾기', 'aria-label': '용어 찾기', value: term || '' });
  const list = h('div', { class: 'rlist noterm' });
  const draw = (): void => {
    const q = input.value.trim();
    const hit = model.glossary.filter((g) => !q || g.term.includes(q) || g.meaning.includes(q));
    list.replaceChildren(...(hit.length ? hit.map((g) => h('div', { class: `card gl${g.term === term ? ' pick' : ''}`, id: `term-${g.term}` }, h('h3', null, g.term), h('div', null, g.meaning), g.uses.length ? h('div', { class: 'hint' }, `쓰이는 곳: ${g.uses.join(' · ')}`) : null))
      : [h('div', { class: 'empty-note' }, model.glossary.length ? '맞는 용어가 없습니다.' : '아직 용어가 없습니다. 에이전트가 용어를 더하면 여기에 나옵니다.')]));
  };
  input.addEventListener('input', draw);
  draw();
  root.append(h('div', { class: 'wrap' },
    pageHead({ title: '용어집', lead: '이 도구와 일하는 방식에서 우리가 만든 말만 모았습니다. 일반적인 용어는 넣지 않습니다. 화면에서 점선이 그어진 말에 마우스를 올려도 같은 설명이 나옵니다.' }),
    h('div', { class: 'gl-cols' }, h('div', { class: 'gl-main' }, input, list),
      h('div', { class: 'gl-side' },
        h('div', { class: 'card' }, h('h3', null, '툴팁은 이렇게 보입니다'),
          h('div', { class: 'box' }, '예: ', h('span', { class: 'term demo' }, model.glossary[0]?.term ?? '설계 승인'), '을 하면 구현이 시작됩니다'),
          h('div', { class: 'hint' }, '용어에 마우스를 올리면(휴대폰은 한 번 누르면) 짧은 설명과 용어집 링크가 나옵니다.')),
        h('div', { class: 'card' }, h('h3', null, '무엇을 올리고 무엇을 안 올리나'),
          h('ul', { class: 'bul' },
            h('li', null, '올립니다: 이 방법과 도구에서 우리가 만든 말(설계 승인, 겹침, 요청 없는 변경 등)'),
            h('li', null, '올리지 않습니다: 일반 개발 용어, 화면에서 보이는 일반 단어'),
            h('li', null, '사람이 보는 글은 일상 말을 쓰고, 소스 태그나 도구 이름 같은 안쪽 이름은 그대로 둡니다'),
            h('li', null, '용어를 새로 만들거나 바꾸면 용어집에도 함께 반영합니다'))),
        h('div', { class: 'card' }, h('h3', null, '영역 이름'), h('div', { class: 'hint' }, '지금 “현행 | 관리”는 임시 이름입니다. 더 알맞은 이름을 찾으면 이 용어집과 화면에서 한 번에 바뀝니다.'))))));
}
