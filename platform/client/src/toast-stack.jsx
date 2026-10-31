export default function ToastStack({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`toast-item ${toast.tone ? `is-${toast.tone}` : ""}`}
          onClick={() => onDismiss?.(toast.id)}
          type="button"
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
