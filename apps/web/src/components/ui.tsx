import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

/** Klassen zusammenführen – spätere Tailwind-Klassen überschreiben frühere (z.B. w-full → w-14) */
export const cx = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface text-zinc-800 border border-zinc-200 hover:bg-zinc-50 shadow-xs',
  ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
  danger: 'bg-surface text-red-600 border border-zinc-200 hover:bg-red-50 hover:border-red-200',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  icon: 'h-8 w-8 justify-center',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; active?: boolean }
>(function Button({ variant = 'secondary', size = 'md', active, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        variants[variant],
        sizes[size],
        active && 'bg-zinc-900! text-zinc-50! hover:bg-zinc-800!',
        className,
      )}
      {...props}
    />
  );
});

const fieldBase =
  'w-full rounded-lg border border-zinc-200 bg-surface px-2.5 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-zinc-50 disabled:text-zinc-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, 'h-9', className)} {...props} />;
});

export function NumberInput({
  value,
  onChange,
  className,
  allowNull,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | null;
  onChange: (v: number | null) => void;
  allowNull?: boolean;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      className={className}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.');
        if (raw === '') return onChange(allowNull ? null : 0);
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      {...props}
    />
  );
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cx(fieldBase, 'h-9 pr-7', className)} {...props} />;
});

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldBase, 'min-h-16 py-2', className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-[var(--color-accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="text-zinc-800">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Tone = 'neutral' | 'green' | 'blue' | 'amber' | 'red';
const tones: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/15',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/15',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-transparent ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Swatch({ color, round }: { color: string; round?: boolean }) {
  return (
    <span
      className={cx('inline-block h-3 w-3 shrink-0 ring-1 ring-black/10', round ? 'rounded-full' : 'rounded-[3px]')}
      style={{ background: color }}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh] backdrop-blur-[2px]">
      <div className="absolute inset-0" onClick={onClose} />
      <div className={cx('relative w-full rounded-xl bg-surface shadow-xl ring-1 ring-zinc-900/5', width)}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Schließen">
            <X size={16} />
          </Button>
        </div>
        <div className="px-5 pb-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 rounded-b-xl border-t border-zinc-100 bg-zinc-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Schließen">
            <X size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-surface px-6 py-14 text-center">
      <div className="text-zinc-400">{icon}</div>
      <div className="font-medium text-zinc-800">{title}</div>
      {children && <div className="max-w-sm text-sm text-zinc-500">{children}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-zinc-200 bg-surface shadow-xs', className)}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 font-sans text-[10px] font-medium text-zinc-500">
      {children}
    </kbd>
  );
}
