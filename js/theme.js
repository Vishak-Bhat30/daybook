const KEY = 'daybook.theme';
export const getTheme = () => localStorage.getItem(KEY) || 'system';

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0d0d' : '#f4f3f0');
}

export function setTheme(theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
