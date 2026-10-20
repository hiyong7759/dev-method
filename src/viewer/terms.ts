/**
 * @spec viewer-terms 용어 툴팁
 * @why 이 도구와 일하는 방식에서 우리가 만든 말(설계 승인, 겹침 등)은 처음 보면 뜻을 알 수 없으므로, 화면의 글 속에서 그 말에 점선을 긋고 마우스를 올리면(휴대폰은 한 번 누르면) 짧은 설명과 용어집 링크를 보여 준다.
 * @contract model.glossary의 용어로 글 조각(텍스트 노드)을 찾아 감싼다. 입력칸·코드·용어집 목록(.noterm) 안은 건드리지 않는다. 화면이 다시 그려진 뒤마다 markTerms를 부른다.
 */
import { h } from './util.js';
import { hash } from './route.js';
import type { GlossaryTerm } from '../types.js';

/** 용어 표시를 하지 않는 곳: 입력칸, 코드, 단추·링크·제목·이름표처럼 눌러야 하거나 이름인 자리, 상단 바 */
const SKIP = 'script,style,textarea,input,select,code,pre,button,a,h1,h2,h3,h4,.top,.tabs,.chip,.tag,.pill,.rv,.fc,.noterm,.term,.termtip,.mono,.rid,.rt,.rtitle';
/** 용어 하나는 한 덩어리(오른쪽 패널, 본문 한 쪽) 안에서 처음 나온 한 번만 표시한다(같은 말이 줄마다 점선이면 어지럽다) */
const REGION = '.sidepanel,.side,.wrap,.pg';
let tip: HTMLElement | null = null;
const closeTip = (): void => { tip?.remove(); tip = null; };

/** 용어 위에 설명 상자를 띄운다 */
function showTip(el: HTMLElement, t: GlossaryTerm): void {
  closeTip();
  const r = el.getBoundingClientRect();
  tip = h('div', { class: 'termtip', style: `left:${Math.max(8, Math.min(r.left, innerWidth - 340))}px;top:${r.bottom + 6}px` },
    h('b', null, t.term), h('div', null, t.meaning), h('a', { class: 'lnk', href: hash('manage', 'glossary', { term: t.term }) }, '용어집에서 보기 ›'));
  tip.addEventListener('mouseleave', closeTip);
  document.body.append(tip);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTip(); });
document.addEventListener('click', (e) => { if (tip && !(e.target as HTMLElement).closest('.term,.termtip')) closeTip(); });

/** 한 요소 안의 글에서 용어를 찾아 점선 표시로 감싼다 */
export function markTerms(root: Element, glossary: GlossaryTerm[]): void {
  if (!glossary.length) return;
  const terms = [...glossary].sort((a, b) => b.term.length - a.term.length);
  const rx = new RegExp(terms.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const byName = new Map(terms.map((t) => [t.term, t]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : rx.test(n.textContent ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const seen = new Map<Element, Set<string>>();
  for (const n of nodes) {
    const text = n.textContent ?? '';
    const frag = document.createDocumentFragment();
    let last = 0;
    rx.lastIndex = 0;
    for (let m = rx.exec(text); m; m = rx.exec(text)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const region = n.parentElement?.closest(REGION) ?? root;
      const done = seen.get(region) ?? new Set<string>();
      seen.set(region, done);
      if (done.has(m[0])) { frag.append(m[0]); last = m.index + m[0].length; continue; }
      done.add(m[0]);
      const t = byName.get(m[0]) as GlossaryTerm;
      const span = h('span', { class: 'term', tabindex: '0' }, m[0]);
      span.addEventListener('mouseenter', () => showTip(span, t));
      span.addEventListener('click', () => showTip(span, t));
      frag.append(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    n.replaceWith(frag);
  }
}
