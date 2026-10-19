/**
 * @spec viewer-steps 숨은 컴포넌트 여는 한 단계
 * @why 처음 화면에 안 보이는 요소를 실제 화면(문서)에서 한 단계씩 열어 본다. 끝낼 때 확인(finish)과 설계서 보기의 "열어서 보기"가 같은 함수를 쓰게 한다.
 * @contract runStep은 화면 안에서 실행되도록 글자(함수 소스)로 옮겨 쓰므로 바깥 변수를 쓰지 않고 이 안에서 끝낸다. 단계는 types.ts의 RevealStep이고, 동작이 없으면 누르기다.
 */
import type { RevealStep } from '../types.js';

/** 한 단계(누르기, 올리기, 입력, 엔터)를 문서에서 해 본다. 해당 요소가 없으면 false */
export function runStep(doc: Document, st: RevealStep): boolean {
  const norm = (e: Element): string => ((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const win = doc.defaultView as Window & typeof globalThis;
  const act = st.act || '누르기';
  const text = st.text ?? '';
  const byText = (sel: string, t: string): HTMLElement | undefined => {
    const all = ([...doc.querySelectorAll(sel)] as HTMLElement[]).filter(vis);
    return all.find((e) => norm(e) === t) || all.find((e) => norm(e).includes(t));
  };
  if (act === '누르기' || act === '올리기') {
    let el: HTMLElement | undefined;
    if (st.tag) el = ([...doc.querySelectorAll(st.tag)] as HTMLElement[]).filter((x) => norm(x) === text)[st.nth || 0];
    else el = byText('button,[role=button],[role=tab],summary,a,label,[onclick]', text) || byText('li,div,span,p,h1,h2,h3', text);
    if (!el) return false;
    if (act === '올리기') { for (const t of ['mouseover', 'mouseenter', 'pointerover', 'pointerenter']) el.dispatchEvent(new win.MouseEvent(t, { bubbles: true })); }
    else el.click();
    return true;
  }
  if (act === '입력') {
    const inputs = ([...doc.querySelectorAll('input,textarea')] as (HTMLInputElement | HTMLTextAreaElement)[]).filter(vis);
    const label = (e: HTMLInputElement | HTMLTextAreaElement): string => [e.placeholder, e.getAttribute('aria-label'), e.name, e.id, e.labels && e.labels[0] && e.labels[0].innerText].filter(Boolean).join(' ');
    const el = inputs.find((e) => label(e).includes(text)) || (text ? null : inputs[0]);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, st.value || '');
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    el.focus();
    return true;
  }
  if (act === '엔터') {
    const el: Element = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.body;
    for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new win.KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    const form = el.closest && el.closest('form');
    if (form && form.requestSubmit) form.requestSubmit();
    return true;
  }
  return false;
}

/** 사람이 읽는 한 단계 설명 */
export function stepLabel(st: RevealStep): string {
  const act = st.act || '누르기';
  if (act === '입력') return `"${st.text}" 칸에 "${st.value || ''}" 입력`;
  if (act === '엔터') return '엔터';
  return `"${st.text}" ${act}`;
}
