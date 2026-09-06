import { useEffect, useMemo, useState } from 'react';

const COLORS = ['var(--good)', 'var(--accent)', 'var(--confetti-1)', 'var(--confetti-2)', 'var(--confetti-3)'];
const PIECES = 34;
const DURATION = 1500;

export interface Origin {
  x: number;
  y: number;
}

/**
 * A brief burst for a whole workspace going green, thrown from the button that
 * caused it so cause and effect are visually linked. Deliberately reserved for
 * that one event — firing on every passing run would make it meaningless.
 */
export default function Celebration({ trigger, origin }: { trigger: number; origin: Origin | null }) {
  const [visible, setVisible] = useState(false);

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), DURATION);
    return () => clearTimeout(timer);
  }, [trigger, reduceMotion]);

  // Regenerated per burst so no two look identical.
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => {
        // Fan upward and outward, then let gravity take over in the keyframes.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.1;
        const speed = 90 + Math.random() * 190;
        return {
          id: i,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          delay: Math.random() * 90,
          spin: (Math.random() - 0.5) * 900,
          size: 5 + Math.random() * 6,
          color: COLORS[i % COLORS.length],
          round: Math.random() > 0.55,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trigger],
  );

  if (!visible) return null;

  // Fall back to the top centre if the source button could not be measured.
  const from = origin ?? { x: window.innerWidth / 2, y: 60 };

  return (
    <div className="celebration" aria-hidden="true">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className={`confetti ${piece.round ? 'round' : ''}`}
          style={
            {
              left: from.x,
              top: from.y,
              width: piece.size,
              height: piece.size * (piece.round ? 1 : 1.7),
              background: piece.color,
              animationDelay: `${piece.delay}ms`,
              '--dx': `${piece.dx}px`,
              '--dy': `${piece.dy}px`,
              '--spin': `${piece.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
