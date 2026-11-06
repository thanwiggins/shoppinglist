import { useSyncExternalStore } from 'react';

interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a short message at the bottom of the screen, optionally with an Undo-style button. */
export function notify(text: string, action?: Toast['action'], ms = 4000) {
  const t = { id: nextId++, text, action };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, ms);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => toasts
  );
  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && (
            <button type="button" onClick={() => { t.action!.run(); toasts = toasts.filter((x) => x.id !== t.id); emit(); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
