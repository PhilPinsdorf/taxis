import { create } from 'zustand';
import clsx from 'clsx';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let seq = 0;

export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = ++seq;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 6000 : 3200);
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-14 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto rounded-lg px-3.5 py-2 text-sm shadow-lg ring-1',
            t.tone === 'error' && 'bg-[#dc2626] text-white ring-black/10',
            t.tone !== 'error' && 'bg-zinc-900 text-zinc-50 ring-black/10',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
