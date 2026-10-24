/**
 * @spec viewer-keep-ui 다시 그려도 보던 자리 지키기
 * @why 다른 곳에서 요청·코멘트·리포트가 바뀌면 화면이 통째로 다시 그려지는데, 그때마다 아래쪽을 보던 사람이 맨 위로 올라가고 펼쳐 둔 곳이 닫히고 쓰던 글이 사라지면 쓸 수가 없다. 그리기 전에 보던 자리·펼침·입력을 적어 두었다가 그린 뒤 같은 자리에 돌려놓는다.
 * @contract snapshot()은 그리기 직전에, restore()는 그린 직후에 부른다. 같은 종류·같은 모양의 칸을 순서로 짝지으므로, 화면이 다른 곳으로 옮겨 갔을 때(주소가 바뀜)는 쓰지 않는다. 지키는 것: 스크롤 위치, details 펼침, 'shut/each/hidden' 클래스로 접고 펼치는 곳, 입력칸의 글·포커스·커서.
 */
const TOGGLES = ['shut', 'each', 'hidden'];

/** 같은 모양의 칸을 구분하는 이름: 태그 + 접힘 상태를 뺀 클래스 */
const sig = (el: Element): string => `${el.tagName}.${[...el.classList].filter((c) => !TOGGLES.includes(c)).join('.')}`;

/** 칸마다 "같은 모양 중 몇 번째"인지 이름 붙여 돌려준다 */
function keyed(root: HTMLElement): Map<string, HTMLElement> {
  const seen = new Map<string, number>(), out = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const s = sig(el), n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    out.set(`${s}#${n}`, el);
  }
  return out;
}

/** 다시 그리기 전에 적어 둔 화면 상태 */
export interface UiSnapshot {
  /** 스크롤·펼침·입력·포커스가 있던 칸마다 한 줄. 새로 그린 화면에서 같은 이름의 칸을 찾아 돌려놓는다 */
  entries: { key: string; top: number; left: number; open?: boolean; toggles: string[]; value?: string; checked?: boolean; focus: boolean; sel?: [number | null, number | null] }[];
  /** 창 전체를 얼마나 내려 보고 있었나 */
  page: number;
}
  /** 스크롤·펼침·입력·포커스가 있는 칸들(칸 이름은 keyed가 붙인다) */
  entries: { key: string; top: number; left: number; open?: boolean; toggles: string[]; value?: string; checked?: boolean; focus: boolean; sel?: [number | null, number | null] }[];
  /** 창 전체의 세로 스크롤 */
  page: number;
}

/** 지금 보던 자리·펼침·입력을 적어 둔다 */
export function snapshot(root: HTMLElement): UiSnapshot {
  const active = document.activeElement;
  const entries: UiSnapshot['entries'] = [];
  for (const [key, el] of keyed(root)) {
    const input = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
    const toggles = TOGGLES.filter((c) => el.classList.contains(c));
    const isFold = el instanceof HTMLDetailsElement;
    if (!el.scrollTop && !el.scrollLeft && !toggles.length && !isFold && !input && el !== active) continue;
    entries.push({ key, top: el.scrollTop, left: el.scrollLeft, open: isFold ? (el as HTMLDetailsElement).open : undefined, toggles, value: input && input.type !== 'checkbox' && input.type !== 'radio' ? input.value : undefined, checked: input instanceof HTMLInputElement ? input.checked : undefined, focus: el === active, sel: input && el === active ? [input.selectionStart, input.selectionEnd] : undefined });
  }
  return { entries, page: window.scrollY };
}

/** 적어 둔 것을 새로 그려진 화면에 돌려놓는다 */
export function restore(root: HTMLElement, snap: UiSnapshot): void {
  const now = keyed(root);
  for (const e of snap.entries) {
    const el = now.get(e.key);
    if (!el) continue;
    if (e.open !== undefined && el instanceof HTMLDetailsElement) el.open = e.open;
    for (const c of TOGGLES) el.classList.toggle(c, e.toggles.includes(c));
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      if (e.value !== undefined && e.value !== el.value) el.value = e.value;
      if (e.checked !== undefined && el instanceof HTMLInputElement) el.checked = e.checked;
    }
    if (e.top || e.left) { el.scrollTop = e.top; el.scrollLeft = e.left; }
    if (e.focus) { el.focus({ preventScroll: true }); if (e.sel && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) try { el.setSelectionRange(e.sel[0], e.sel[1]); } catch { /* 커서를 못 놓는 칸 */ } }
  }
  window.scrollTo(0, snap.page);
}
