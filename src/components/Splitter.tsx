import { useCallback, useEffect, useRef, useState } from 'react';
import { clampPanelWidth, DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH } from '../lib/storage';

interface Props {
  width: number;
  /** Called continuously while dragging, so the panel tracks the pointer. */
  onPreview: (width: number) => void;
  /** Called once on release — the only value worth persisting. */
  onCommit: (width: number) => void;
}

const STEP = 24;

export default function Splitter({ width, onPreview, onCommit }: Props) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(width);

  const measure = useCallback((clientX: number) => {
    // The panel is flush to the right edge, so its width is whatever is left of it.
    return clampPanelWidth(window.innerWidth - clientX, window.innerWidth);
  }, []);

  // Listening on the window rather than the handle means the drag survives the
  // pointer outrunning a 6px target.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent) => {
      latest.current = measure(event.clientX);
      onPreview(latest.current);
    };
    const onUp = () => {
      setDragging(false);
      onCommit(latest.current);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, measure, onPreview, onCommit]);

  const nudge = (delta: number) => {
    const next = clampPanelWidth(width + delta, window.innerWidth);
    onPreview(next);
    onCommit(next);
  };

  return (
    <div
      className={`splitter ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the results panel"
      aria-valuenow={width}
      aria-valuemin={MIN_PANEL_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        event.preventDefault();
        latest.current = width;
        setDragging(true);
      }}
      onDoubleClick={() => {
        onPreview(DEFAULT_PANEL_WIDTH);
        onCommit(DEFAULT_PANEL_WIDTH);
      }}
      onKeyDown={(event) => {
        // Arrow keys widen and narrow, so resizing is not mouse-only.
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          nudge(STEP);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          nudge(-STEP);
        }
      }}
    >
      <span className="splitter-grip" aria-hidden="true" />
    </div>
  );
}
