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
type WithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

/**
 * `animate` is opt-in because a view transition is only valid in response to a
 * real change. Starting one during the initial render — or twice over, as
 * StrictMode's double-invoked effects do — is rejected as an invalid state.
 */
export function applyTheme(preference: ThemePref, animate = false): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const swap = () => {
    document.documentElement.dataset.theme = resolved;
  };

  // A hard snap between palettes is jarring. View Transitions cross-fade the
  // whole document for free where supported; elsewhere it just swaps.
  const doc = document as WithViewTransition;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (animate && doc.startViewTransition && !reduce && document.visibilityState === 'visible') {
    // A transition can still be superseded; that is not an error worth raising.
    doc.startViewTransition(swap).finished.catch(() => {});
  } else {
    swap();
  }

  return resolved;
}

/** Re-apply when the OS flips, but only while following the system. */
export function watchSystemTheme(preference: ThemePref, onChange: () => void): () => void {
  if (preference !== 'system') return () => {};
  const query = media();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
