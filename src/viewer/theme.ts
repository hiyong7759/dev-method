/**
 * @why 화면 밝기(다크·라이트·시스템)를 고르고 기억한다. 색 값은 style.css 맨 위 한 곳에만 있고, 여기서는 어느 쪽을 쓸지만 정한다.
 */
export type ThemeMode = 'dark' | 'light' | 'system';
export const THEME_MODES: { key: ThemeMode; label: string }[] = [{ key: 'dark', label: '다크' }, { key: 'light', label: '라이트' }, { key: 'system', label: '시스템' }];
const STORE = 'spec-theme';

/** 저장된 선택(없으면 시스템) */
export function themeMode(): ThemeMode {
  try { const v = localStorage.getItem(STORE); if (v === 'dark' || v === 'light') return v; } catch { /* 저장소를 못 쓰는 브라우저 */ }
  return 'system';
}

/** 선택을 화면에 적용하고 저장한다. 시스템이면 기기 설정을 따르도록 고정을 푼다 */
export function applyTheme(mode: ThemeMode): void {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  try { if (mode === 'system') localStorage.removeItem(STORE); else localStorage.setItem(STORE, mode); } catch { /* 저장 못 해도 이번 화면에는 적용됨 */ }
}

applyTheme(themeMode());
