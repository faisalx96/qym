import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import styles from './Toast.module.css';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms; default 4000, min 1000, errors 6000. */
  timeout?: number;
}

export interface ToastItem extends ToastOptions {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
  pause: (id: number) => void;
  resume: (id: number) => void;
  toasts: ToastItem[];
}

const ToastContext = createContext<ToastApi | null>(null);
let counter = 0;

/** Mount once (in the app root). Provides useToast(); renders the top-right stack. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  // Hovering or focusing inside a toast pauses its timer (WCAG 2.2.1): the action
  // button must stay reachable for keyboard and slow pointer users.
  const pause = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);
  const resume = useCallback(
    (id: number) => {
      if (timers.current.has(id)) return;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 2000),
      );
    },
    [dismiss],
  );
  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = ++counter;
      const tone = options.tone ?? 'info';
      const timeout = Math.max(1000, options.timeout ?? (tone === 'error' ? 6000 : 4000));
      setToasts((prev) => [...prev.slice(-4), { id, message, ...options, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), timeout),
      );
      return id;
    },
    [dismiss],
  );
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);
  const api = useMemo(
    () => ({ show, dismiss, toasts, pause, resume }),
    [show, dismiss, toasts, pause, resume],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export function useToast(): Pick<ToastApi, 'show' | 'dismiss'> {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function Toaster() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;
  return (
    <div className={styles.container} data-toast-container>
      {ctx.toasts.map((t) => (
        <div
          key={t.id}
          className={styles.toast}
          data-tone={t.tone}
          role={t.tone === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => ctx.pause(t.id)}
          onMouseLeave={() => ctx.resume(t.id)}
          onFocus={() => ctx.pause(t.id)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) ctx.resume(t.id);
          }}
        >
          <span className={styles.message}>{t.message}</span>
          {t.action ? (
            <Button
              variant="ghost"
              className={styles.action}
              onPress={() => {
                t.action?.onClick();
                ctx.dismiss(t.id);
              }}
            >
              {t.action.label}
            </Button>
          ) : null}
          <IconButton label="Dismiss" icon="close" onPress={() => ctx.dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
