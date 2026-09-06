import { useMemo, useState } from 'react';
import type { MethodDoc } from '../types';

export interface MethodBadge {
  pass: number;
  fail: number;
}

interface Props {
  methods: MethodDoc[];
  selectedId: string | null;
  query: string;
  activeTags: string[];
  badges: Record<string, MethodBadge>;
  errorCounts: Record<string, number>;
  preambleOpen: boolean;
  onQueryChange: (value: string) => void;
  onToggleTag: (tag: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenPreamble: () => void;
  /** Move `fromId` to sit before or after `toId` in the library. */
  onReorder: (fromId: string, toId: string, below: boolean) => void;
  /** Keyboard equivalent: shift one place up (-1) or down (+1). */
  onNudge: (id: string, delta: number) => void;
}

/** Supports plain text plus `tag:name` terms in the same box. */
function matches(method: MethodDoc, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  return terms.every((term) => {
    if (term.startsWith('tag:')) {
      const wanted = term.slice(4);
      return method.tags.some((tag) => tag.toLowerCase().includes(wanted));
    }
    return (
      method.name.toLowerCase().includes(term) ||
      method.description.toLowerCase().includes(term) ||
      method.code.toLowerCase().includes(term)
    );
  });
}

export default function Sidebar({
  methods,
  selectedId,
  query,
  activeTags,
  badges,
  errorCounts,
  preambleOpen,
  onQueryChange,
  onToggleTag,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  onOpenPreamble,
  onReorder,
  onNudge,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [below, setBelow] = useState(false);
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const method of methods) {
      for (const tag of method.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [methods]);

  const visible = methods.filter(
    (method) =>
      matches(method, query) && activeTags.every((tag) => method.tags.includes(tag)),
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <input
          className="search"
          placeholder="Search — or tag:strings"
          aria-label="Search methods"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <button className="btn primary block" onClick={onCreate}>
          + New method
        </button>
      </div>

      {allTags.length > 0 && (
        <div className="tag-filters" role="group" aria-label="Filter by tag">
          {allTags.map(([tag, count]) => (
            <button
              key={tag}
              className={`tag-chip ${activeTags.includes(tag) ? 'active' : ''}`}
              aria-pressed={activeTags.includes(tag)}
              onClick={() => onToggleTag(tag)}
            >
              {tag}
              <span className="tag-count">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="method-list">
        {visible.length === 0 && (
          <p className="empty">{methods.length ? 'Nothing matches that filter.' : 'No methods yet.'}</p>
        )}

        {visible.map((method) => {
          const badge = badges[method.id];
          const errors = errorCounts[method.id] ?? 0;

          const dropClass =
            overId === method.id && dragId && dragId !== method.id
              ? below
                ? 'drop-below'
                : 'drop-above'
              : '';

          return (
            <div
              key={method.id}
              className={`method-item ${method.id === selectedId ? 'active' : ''} ${
                dragId === method.id ? 'dragging' : ''
              } ${dropClass}`}
              draggable
              onDragStart={(e) => {
                setDragId(method.id);
                e.dataTransfer.effectAllowed = 'move';
                // Firefox refuses to start a drag without payload.
                e.dataTransfer.setData('text/plain', method.id);
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === method.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const box = e.currentTarget.getBoundingClientRect();
                setOverId(method.id);
                setBelow(e.clientY > box.top + box.height / 2);
              }}
              onDragLeave={() => setOverId((current) => (current === method.id ? null : current))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== method.id) onReorder(dragId, method.id, below);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              <span className="drag-grip" aria-hidden="true" title="Drag to reorder">
                ⠿
              </span>
              <button
                className="method-item-main"
                onClick={() => onSelect(method.id)}
                aria-current={method.id === selectedId}
                title="Alt + ↑ / ↓ to reorder"
                onKeyDown={(e) => {
                  // Reordering must not be mouse-only.
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                  e.preventDefault();
                  onNudge(method.id, e.key === 'ArrowUp' ? -1 : 1);
                }}
              >
                <span className="method-name">
                  {method.name || 'untitled'}
                  {errors > 0 && (
                    <span className="error-dot" title={`${errors} type error${errors === 1 ? '' : 's'}`} />
                  )}
                </span>
                {method.description && <span className="method-desc">{method.description}</span>}
                <span className="method-meta">
                  {method.tests.length} test{method.tests.length === 1 ? '' : 's'}
                  {badge && (badge.pass || badge.fail) ? (
                    <>
                      {' · '}
                      <span className={badge.fail ? 'bad' : 'good'}>
                        {badge.pass}/{badge.pass + badge.fail} passing
                      </span>
                    </>
                  ) : null}
                </span>
              </button>

              <div className="method-item-actions">
                <button
                  className="icon"
                  aria-label={`Duplicate ${method.name}`}
                  title="Duplicate"
                  onClick={() => onDuplicate(method.id)}
                >
                  ⧉
                </button>
                <button
                  className="icon danger"
                  aria-label={`Delete ${method.name}`}
                  title="Delete"
                  onClick={() => onDelete(method.id)}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        className={`preamble-link ${preambleOpen ? 'active' : ''}`}
        onClick={onOpenPreamble}
        aria-current={preambleOpen}
      >
        ⚙ Shared preamble
      </button>
    </aside>
  );
}
