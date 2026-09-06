import { useEffect, useRef, useState } from 'react';

/**
 * Gate a busy indicator so it only appears for work that is actually slow.
 *
 * Worker reuse made a whole-workspace run take about 80ms, so a plain
 * `isRunning &&` bar flashed for four frames — which reads as a rendering
 * glitch rather than as progress. Waiting `delay` before showing anything means
 * fast runs stay silent, and `minVisible` stops the indicator from vanishing
 * the instant it appears when a run lands just over the threshold.
 */
export function useBusyIndicator(active: boolean, delay = 180, minVisible = 400): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active && !visible) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delay);
      return () => clearTimeout(timer);
    }

    if (!active && visible) {
      const remaining = Math.max(0, minVisible - (Date.now() - shownAt.current));
      const timer = setTimeout(() => setVisible(false), remaining);
      return () => clearTimeout(timer);
    }
  }, [active, visible, delay, minVisible]);

  return visible;
}
