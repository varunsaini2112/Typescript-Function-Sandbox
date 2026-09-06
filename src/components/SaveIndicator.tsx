import { useEffect, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveState {
  status: SaveStatus;
  at?: number;
  message?: string;
}

function relativeTime(from: number): string {
  const seconds = Math.round((Date.now() - from) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** Makes autosave visible — it is otherwise entirely silent, which reads as unreliable. */
export default function SaveIndicator({ state }: { state: SaveState }) {
  const [, setTick] = useState(0);

  // Re-render occasionally so "saved 2m ago" stays honest.
  useEffect(() => {
    if (state.status !== 'saved') return;
    const timer = setInterval(() => setTick((n) => n + 1), 20000);
    return () => clearInterval(timer);
  }, [state.status, state.at]);

  if (state.status === 'idle') return null;

  const label =
    state.status === 'saving'
      ? 'saving…'
      : state.status === 'error'
        ? 'not saved'
        : `saved ${state.at ? relativeTime(state.at) : ''}`.trim();

  return (
    <span
      className={`save-indicator ${state.status}`}
      title={state.message ?? (state.at ? new Date(state.at).toLocaleTimeString() : undefined)}
      role="status"
      aria-live="polite"
    >
      <span className="save-dot" />
      {label}
    </span>
  );
}
