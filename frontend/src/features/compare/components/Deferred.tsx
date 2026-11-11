/**
 * C076: the compare page paints its header, the run cards and Per-run averages first. The sections below mount on the
 * next idle moment after that paint, or at once when the reader scrolls near them, so their breakdowns are computed
 * after the first usable frame and not before it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useInView } from '@/lib/useInView';

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** False for the first paint, true from the next idle moment (at most 400 ms later). */
export function useAfterFirstPaint(): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const w = window as IdleWindow;
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setDone(true), { timeout: 400 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setDone(true), 50);
    return () => window.clearTimeout(t);
  }, []);
  return done;
}

/** Holds `minHeight` until `ready` or until it nears the viewport; then mounts its children (once). */
export function Deferred({
  ready,
  minHeight = 240,
  children,
}: {
  ready: boolean;
  minHeight?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { disabled: ready });
  if (ready || near) return <>{children}</>;
  return <div ref={ref} style={{ minHeight }} aria-busy="true" data-part="deferred-section" />;
}
