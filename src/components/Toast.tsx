export interface ToastState {
  id: string;
  message: string;
  tone?: 'normal' | 'error';
  action?: { label: string; run: () => void };
}

interface Props {
  toast: ToastState;
  onDismiss: () => void;
}

export default function Toast({ toast, onDismiss }: Props) {
  return (
    <div className={`toast ${toast.tone === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          className="toast-action"
          // Dismiss first: an action may raise its own follow-up toast, and
          // dismissing afterwards would clear the one it just set.
          onClick={() => {
            onDismiss();
            toast.action?.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="toast-close" aria-label="Dismiss notification" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
