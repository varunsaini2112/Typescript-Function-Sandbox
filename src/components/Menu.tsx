import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  label: ReactNode;
  /** Accessible name, since several triggers are icon-only. */
  title: string;
  align?: 'left' | 'right';
  className?: string;
  children: (close: () => void) => ReactNode;
}

/** Popover with click-outside and Escape handling, shared by every menu here. */
export default function Menu({ label, title, align = 'right', className = '', children }: Props) {
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

  return (
    <div className="menu" ref={container}>
      <button
        className={`btn ${className}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={title}
        title={title}
      >
        {label}
      </button>

      {open && (
        <div className={`menu-popover ${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface ItemProps {
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

export function MenuItem({ label, hint, disabled, danger, onClick }: ItemProps) {
  return (
    <button
      role="menuitem"
      className={`menu-item ${danger ? 'danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-label">{label}</span>
      {hint && <span className="menu-item-hint">{hint}</span>}
    </button>
  );
}
