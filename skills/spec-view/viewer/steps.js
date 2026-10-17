// 숨은 컴포넌트를 여는 한 단계를 실제 화면(문서)에서 해 본다. 끝낼 때 확인(finish.mjs)과 설계서 보기의 '열어서 보기'가 같은 함수를 쓴다
// 이 함수는 화면 안에서 실행되도록 문자열로 옮겨 쓰므로, 바깥 변수를 쓰지 않고 이 안에서 끝낸다
// 단계: { act: '누르기'|'입력'|'엔터'|'올리기', text, value, tag, nth }  (act가 없으면 누르기, tag·nth는 자동으로 찾은 것)
export function runStep(doc, st) {
  const norm = (e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const win = doc.defaultView;
  const act = st.act || '누르기';
  const byText = (sel, text) => {
    const all = [...doc.querySelectorAll(sel)].filter(vis);
    return all.find((e) => norm(e) === text) || all.find((e) => norm(e).includes(text));
  };
  if (act === '누르기' || act === '올리기') {
    let el;
    if (st.tag) el = [...doc.querySelectorAll(st.tag)].filter((x) => norm(x) === st.text)[st.nth || 0];
    else el = byText('button,[role=button],[role=tab],summary,a,label,[onclick]', st.text) || byText('li,div,span,p,h1,h2,h3', st.text);
    if (!el) return false;
    if (act === '올리기') { for (const t of ['mouseover', 'mouseenter', 'pointerover', 'pointerenter']) el.dispatchEvent(new win.MouseEvent(t, { bubbles: true })); }
    else el.click();
    return true;
  }
  if (act === '입력') {
    const inputs = [...doc.querySelectorAll('input,textarea')].filter(vis);
    const label = (e) => [e.placeholder, e.getAttribute('aria-label'), e.name, e.id, e.labels && e.labels[0] && e.labels[0].innerText].filter(Boolean).join(' ');
    const el = inputs.find((e) => label(e).includes(st.text)) || (st.text ? null : inputs[0]);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, st.value || '');
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    el.focus();
    return true;
  }
  if (act === '엔터') {
    const el = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.body;
    for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new win.KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    const form = el.closest && el.closest('form'); if (form && form.requestSubmit) form.requestSubmit();
    return true;
  }
  return false;
}

// 사람이 읽는 한 단계 설명
export function stepLabel(st) {
  const act = st.act || '누르기';
  if (act === '입력') return `"${st.text}" 칸에 "${st.value || ''}" 입력`;
  if (act === '엔터') return '엔터';
  return `"${st.text}" ${act}`;
}
