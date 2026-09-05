import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Null when the preamble is open, or nothing is selected. */
  methodName: string | null;
  onExportMethod: () => void;
  onExportWorkspace: () => void;
}

export default function ExportMenu({ methodName, onExportMethod, onExportWorkspace }: Props) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <div className="menu" ref={container}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        Export ▾
      </button>

      {open && (
        <div className="menu-popover" role="menu">
          <button
            role="menuitem"
            className="menu-item"
            disabled={!methodName}
            onClick={() => choose(onExportMethod)}
          >
            <span className="menu-item-label">This method (.ts)</span>
            <span className="menu-item-hint">
              {methodName ? `${methodName}.ts — code, tests and settings` : 'no method selected'}
            </span>
          </button>

          <button role="menuitem" className="menu-item" onClick={() => choose(onExportWorkspace)}>
            <span className="menu-item-label">Whole workspace (.json)</span>
            <span className="menu-item-hint">every method plus the preamble — your backup</span>
          </button>
        </div>
      )}
    </div>
  );
}
