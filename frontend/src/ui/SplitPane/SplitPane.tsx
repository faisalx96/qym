import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import styles from './SplitPane.module.css';

export interface SplitPaneProps {
  start: ReactNode;
  end: ReactNode;
  /** Initial size of the start pane, percent of the container. */
  defaultPct?: number;
  /** Neither pane gets narrower than this many px. */
  minPx?: number;
  /** localStorage key remembering the split per viewer (a convenience, never required). */
  storageKey?: string;
  /** Accessible name of the separator, e.g. "Resize tree and detail panes". */
  label: string;
  className?: string;
}

const STEP = 2;

function readStored(key: string | undefined): number | null {
  if (!key) return null;
  try {
    const v = Number(window.localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 && v < 100 ? v : null;
  } catch {
    return null;
  }
}

function writeStored(key: string | undefined, pct: number | null) {
  if (!key) return;
  try {
    if (pct == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(Math.round(pct * 10) / 10));
  } catch {
    /* storage can be blocked; the split just does not persist */
  }
}

/**
 * Two panes with a draggable, keyboard-operable divider (ARIA window splitter): pointer drag, Left/Right
 * move 2%, Home/End jump to the limits, double click resets. Logical in RTL. No motion.
 */
export function SplitPane({
  start,
  end,
  defaultPct = 55,
  minPx = 280,
  storageKey,
  label,
  className,
}: SplitPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pct, setPct] = useState<number>(() => readStored(storageKey) ?? defaultPct);
  const dragging = useRef(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const limits = useCallback((): [number, number] => {
    if (!width || width < 2 * minPx) return [10, 90];
    const lo = (minPx / width) * 100;
    return [lo, 100 - lo];
  }, [width, minPx]);
  const [lo, hi] = limits();
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  const shown = clamp(pct);

  const commit = (v: number, persist = true) => {
    const next = clamp(v);
    setPct(next);
    if (persist) writeStored(storageKey, next);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    const rtl = getComputedStyle(rootRef.current!).direction === 'rtl';
    const x = rtl ? rect.right - e.clientX : e.clientX - rect.left;
    return (x / rect.width) * 100;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = shown + (rtl ? STEP : -STEP);
    else if (e.key === 'ArrowRight') next = shown + (rtl ? -STEP : STEP);
    else if (e.key === 'Home') next = lo;
    else if (e.key === 'End') next = hi;
    if (next == null) return;
    e.preventDefault();
    commit(next);
  };

  return (
    <div
      ref={rootRef}
      className={[styles.split, className].filter(Boolean).join(' ')}
      style={{ ['--split-start' as string]: `${shown}%` }}
    >
      <div className={styles.pane} data-pane="start">
        {start}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={Math.round(lo)}
        aria-valuemax={Math.round(hi)}
        aria-valuenow={Math.round(shown)}
        tabIndex={0}
        className={styles.handle}
        data-testid="split-handle"
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          setPct(clamp(defaultPct));
          writeStored(storageKey, null);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.dataset.dragging = '';
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const v = fromPointer(e);
          if (v != null) commit(v, false);
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          delete e.currentTarget.dataset.dragging;
          e.currentTarget.releasePointerCapture(e.pointerId);
          writeStored(storageKey, shown);
        }}
        onPointerCancel={(e) => {
          dragging.current = false;
          delete e.currentTarget.dataset.dragging;
        }}
      />
      <div className={styles.pane} data-pane="end">
        {end}
      </div>
    </div>
  );
}
