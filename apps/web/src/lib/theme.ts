import { create } from 'zustand';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'taxis-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const resolve = (pref: ThemePref) => (pref === 'system' ? (media.matches ? 'dark' : 'light') : pref);

export const useTheme = create<{ pref: ThemePref; dark: boolean }>(() => {
  const pref = readPref();
  return { pref, dark: resolve(pref) === 'dark' };
});

function apply() {
  const dark = resolve(useTheme.getState().pref) === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  if (useTheme.getState().dark !== dark) useTheme.setState({ dark });
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* Speicher nicht verfügbar – Auswahl gilt nur für diese Sitzung */
  }
  useTheme.setState({ pref });
  apply();
}

media.addEventListener('change', apply);
// Gedruckt wird immer hell
window.addEventListener('beforeprint', () => document.documentElement.classList.remove('dark'));
window.addEventListener('afterprint', apply);
apply();
