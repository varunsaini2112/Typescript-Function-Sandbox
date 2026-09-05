import type { ThemePref } from '../types';

export type ResolvedTheme = 'light' | 'dark';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(preference: ThemePref): ResolvedTheme {
  if (preference === 'system') return media().matches ? 'dark' : 'light';
  return preference;
}

/**
 * Stamp the resolved theme on the root element. CSS defines the light palette on
 * `:root` and overrides it for dark, so an explicit choice always wins over the
 * system setting.
 */
export function applyTheme(preference: ThemePref): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/** Re-apply when the OS flips, but only while following the system. */
export function watchSystemTheme(preference: ThemePref, onChange: () => void): () => void {
  if (preference !== 'system') return () => {};
  const query = media();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
