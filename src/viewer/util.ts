// 설계서 보기 화면의 공통 도구: 요소 만들기, 서버 호출, 주소 맞추기, 표시용 글.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}

export async function get(url) { const r = await fetch(url, { cache: 'no-store' }); return r.json(); }
export async function post(url, body) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (j && j.error) throw new Error(j.error);
  return j;
}

// 라우트 패턴('/trips/:tripId/days/:n')과 실제 주소 맞추기
const rx = (pattern) => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '')}/?$`);
export function matchScreen(model, pathname) {
  const hits = model.screens.filter((s) => s.route && rx(s.route).test(pathname));
  return hits.sort((a, b) => b.route.length - a.route.length)[0] || null;
}

export const fmt = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
export const ROLE_LABEL = { input: '입력', shown: '보여줌', modify: '수정', judge: '판단' };
export const ROLES = ['input', 'shown', 'modify', 'judge'];

export function statusChip(st, extra = '') {
  return h('span', { class: `chip-st ${st.status}${extra}` }, st.label);
}

let toastTimer;
export function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' }, text);
  document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3200);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 보안 문맥이 아니면 아래로 */ }
  const ta = h('textarea', { style: 'position:fixed;left:-999px' }, text);
  document.body.append(ta); ta.select();
  const ok = document.execCommand('copy'); ta.remove(); return ok;
}
