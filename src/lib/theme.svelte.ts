/** Light, dark, or following the system. Stored per browser, applied as data-theme on <html>. */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'box-insert-studio/theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;

function stored(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const theme = $state({ pref: stored(), systemDark: media?.matches ?? false });

media?.addEventListener('change', (e) => (theme.systemDark = e.matches));

/** Whether the dark palette is showing right now. */
export function isDark() {
  return theme.pref === 'dark' || (theme.pref === 'system' && theme.systemDark);
}

export function setTheme(pref: ThemePref) {
  theme.pref = pref;
  if (pref === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
