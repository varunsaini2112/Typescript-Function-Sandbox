import { useEffect, useRef, useState } from 'react';

/** Rolls a number to its new value — a small, real hit of satisfaction on a passing suite. */
export default function CountUp({ value, duration = 420 }: { value: number; duration?: number }) {
  // Start at zero so the first appearance rolls up too — that is the moment
  // the count is most worth watching, and mounting at the final value skips it.
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // requestAnimationFrame is paused in a hidden tab, which would strand the
    // display at its starting value — showing a wrong count, not just a still one.
    if (reduce || document.hidden || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const origin = from.current;
    const delta = value - origin;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — quick to move, gentle to land.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + delta * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
      else from.current = value;
    };

    frame.current = requestAnimationFrame(step);

    // Belt and braces: if frames stop arriving mid-roll (the tab is hidden
    // partway through), land on the true value rather than freezing short of it.
    const settle = setTimeout(() => {
      from.current = value;
      setShown(value);
    }, duration + 120);

    return () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(settle);
    };
  }, [value, duration]);

  return <>{shown}</>;
}
