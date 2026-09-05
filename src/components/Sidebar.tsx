import type { MethodDoc } from '../types';

export interface MethodBadge {
  pass: number;
  fail: number;
}

interface Props {
  methods: MethodDoc[];
  selectedId: string | null;
  query: string;
  badges: Record<string, MethodBadge>;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function Sidebar({
  methods,
  selectedId,
  query,
  badges,
  onQueryChange,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
}: Props) {
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? methods.filter(
        (m) =>
          m.name.toLowerCase().includes(needle) ||
          m.description.toLowerCase().includes(needle) ||
          m.code.toLowerCase().includes(needle),
      )
    : methods;

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <input
          className="search"
          placeholder="Search methods…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <button className="btn primary block" onClick={onCreate}>
          + New method
        </button>
      </div>

      <div className="method-list">
        {visible.length === 0 && (
          <p className="empty">{methods.length ? 'Nothing matches that search.' : 'No methods yet.'}</p>
        )}

        {visible.map((method) => {
          const badge = badges[method.id];
          return (
            <div
              key={method.id}
              className={`method-item ${method.id === selectedId ? 'active' : ''}`}
              onClick={() => onSelect(method.id)}
            >
              <div className="method-item-main">
                <span className="method-name">{method.name || 'untitled'}</span>
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
              </div>
              <div className="method-item-actions">
                <button
                  className="icon"
                  title="Duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(method.id);
                  }}
                >
                  ⧉
                </button>
                <button
                  className="icon danger"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${method.name}"? This cannot be undone.`)) onDelete(method.id);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
