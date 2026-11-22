/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
   The resize handle is the WAI-ARIA window splitter widget (as ui/SplitPane): a focusable separator that takes keys and drag. */
/**
 * The width controls of a side surface, shared by the item pane and the trace drawer: the resize handle (the WAI-ARIA
 * window splitter widget, as ui/SplitPane: a focusable separator that takes keys and drag), the header button that
 * takes the full page width and gives it back, and the reader's stored width.
 */
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { readLocal, writeLocal } from '@/lib/storage';
import { Act } from './actions';
import s from './pane.module.css';

export function clampWidth(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/**
 * The reader's own width of a surface, stored under `storageKey` (null: the default). `set(n, persist)` keeps a
 * width for the session of the surface, and in the browser too when `persist` (the end of a drag, a key, a button).
 */
export function useStoredWidth(
  storageKey: string,
): [number | null, (n: number | null, persist: boolean) => void] {
  const [stored, setStored] = useState<{ key: string; value: number | null }>(() => ({
    key: '',
    value: null,
  }));
  const value = (() => {
    if (stored.key === storageKey) return stored.value;
    const n = Number(readLocal(storageKey));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const set = (n: number | null, persist: boolean) => {
    const v = n === null ? null : Math.round(n);
    setStored({ key: storageKey, value: v });
    if (persist) writeLocal(storageKey, v === null ? null : String(v));
  };
  return [value, set];
}

export interface ResizeHandleProps {
  /** The name of the separator ("Resize the item pane"). */
  label: string;
  width: number;
  min: number;
  max: number;
  /** A new width; `persist` at the end of a drag and on a key. */
  onWidth: (n: number, persist: boolean) => void;
  /** Double click: back to the default width. */
  onReset: () => void;
  className?: string;
}

/**
 * The start edge of a surface that lies on the end side of the page: drag it, or focus it and use the arrow keys
 * (16px a step), Home (the full width) and End (the narrowest). A double click gives the default width back.
 */
export function ResizeHandle({ label, width, min, max, onWidth, onReset, className }: ResizeHandleProps) {
  const dragging = useRef(false);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
    if (step) onWidth(width + step, true);
    else if (e.key === 'Home') onWidth(max, true);
    else if (e.key === 'End') onWidth(min, true);
    else return;
    e.preventDefault();
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) onWidth(window.innerWidth - e.clientX, false);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onWidth(window.innerWidth - e.clientX, true);
  };
  return (
    <div
      className={className ?? s.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
    />
  );
}

/**
 * The header button that takes the full page width (expand) and gives it back (collapse); pressed while the surface
 * is at the full width. `narrowLabel` names what the narrow width gives back (the list of the item pane).
 */
export function WidthAct({
  full,
  onPress,
  narrowLabel = 'Give the list its room back',
}: {
  full: boolean;
  onPress: () => void;
  narrowLabel?: string;
}) {
  return (
    <Act
      label={full ? narrowLabel : 'Use the full page width'}
      icon={full ? 'collapse' : 'expand'}
      aria-pressed={full}
      onPress={onPress}
    />
  );
}
