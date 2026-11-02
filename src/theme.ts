import { useEffect, useState } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';

const THEME_KEY = 'pour-guide.theme.v1';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function loadTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // The theme still works when browser storage is unavailable.
  }
  return 'auto';
}

function applyTheme(mode: ThemeMode): void {
  const resolved = mode === 'auto'
    ? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light')
    : mode;
  document.documentElement.dataset.theme = resolved;
  const chrome = document.querySelector('meta[name="theme-color"]');
  if (chrome) chrome.setAttribute('content', resolved === 'dark' ? '#000000' : '#f2f2f7');
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(loadTheme);

  useEffect(() => {
    applyTheme(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Persistence is optional; the selected mode remains active in this tab.
    }
    if (mode !== 'auto') return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme('auto');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  const cycle = () => setMode(current =>
    current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto');

  return { mode, cycle };
}
