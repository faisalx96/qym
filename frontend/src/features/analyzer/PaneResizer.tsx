/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
   A focusable separator is the WAI-ARIA window splitter widget: it takes keys, pointer drag and focus. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import s from './analyzer.module.css';

/** The narrowest prompt pane (its head line: title, count, status, actions) and the narrowest settings column. */
export const PANE_MIN = 440;
export const MAIN_MIN = 600;
/** The column gap of the shell (`--space-lg`). */
const GAP = 20;
const STEP = 16;
const BIG_STEP = 64;
const KEY = 'qym:analyzer-pane-width';

export function readPaneWidth(): number | null {
  try {
    const v = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= PANE_MIN ? v : null;
  } catch {
    return null;
  }
}

function writePaneWidth(px: number | null) {
  try {
    if (px == null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(Math.round(px)));
  } catch {
    /* storage can be blocked: the width lasts for this page only */
  }
}

/** The prompt pane's width, remembered for the person (one value for the four tabs, cv5 Q3). */
export function usePaneWidth() {
  const [width, setWidth] = useState<number | null>(readPaneWidth);
  const set = useCallback((px: number | null, persist = true) => {
    setWidth(px);
    if (persist) writePaneWidth(px);
  }, []);
  return [width, set] as const;
}

/**
 * The window splitter between the tab content and the prompt pane (cv5 Q3, owner: "a size slider between it and the
 * main section"). It lives in the shell's pane column, sticky with the pane, in the column gap: pointer drag,
 * Left / Right 16px (Shift 64px), Home / End to the limits, double click or Enter back to the default. The look is
 * `ui/SplitPane`'s: an accent line on hover, drag and focus; at rest a short grip. No motion.
 */
export function PaneResizer({
  shell,
  pane,
  width,
  onWidth,
  controls,
}: {
  shell: RefObject<HTMLElement | null>;
  pane: RefObject<HTMLElement | null>;
  width: number | null;
  onWidth: (px: number | null, persist?: boolean) => void;
  controls?: string;
}) {
  const [box, setBox] = useState({ shell: 0, pane: 0 });
  const dragging = useRef(false);

  useEffect(() => {
    const el = shell.current;
    const p = pane.current;
    if (!el || !p) return undefined;
    const read = () => setBox({ shell: el.getBoundingClientRect().width, pane: p.getBoundingClientRect().width });
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    ro.observe(p);
    return () => ro.disconnect();
  }, [shell, pane]);

  const max = Math.max(PANE_MIN, box.shell - GAP - MAIN_MIN);
  const clamp = (px: number) => Math.round(Math.min(max, Math.max(PANE_MIN, px)));
  // the measured width: a remembered width can be wider than this window allows (the grid clamps it)
  const current = box.pane || width || PANE_MIN;
  // as `ui/SplitPane`: the value is the share of the start column, in percent
  const pct = (px: number) => (box.shell ? Math.round(((box.shell - GAP - px) / box.shell) * 100) : 0);
  const rtl = () => (shell.current ? getComputedStyle(shell.current).direction === 'rtl' : false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    // the pane is at the end: moving the handle toward the start makes it wider
    const toStart = rtl() ? 'ArrowRight' : 'ArrowLeft';
    const toEnd = rtl() ? 'ArrowLeft' : 'ArrowRight';
    let next: number | null | undefined;
    if (e.key === toStart) next = clamp(current + step);
    else if (e.key === toEnd) next = clamp(current - step);
    else if (e.key === 'Home') next = max;
    else if (e.key === 'End') next = PANE_MIN;
    else if (e.key === 'Enter') next = null;
    if (next === undefined) return;
    e.preventDefault();
    onWidth(next);
  };

  const fromPointer = (clientX: number) => {
    const rect = shell.current?.getBoundingClientRect();
    if (!rect) return null;
    return clamp((rtl() ? clientX - rect.left : rect.right - clientX) - GAP / 2);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the prompt pane"
      aria-controls={controls}
      aria-valuemin={pct(max)}
      aria-valuemax={pct(PANE_MIN)}
      aria-valuenow={pct(current)}
      aria-valuetext={`Prompt pane ${Math.round(current)} px wide`}
      tabIndex={0}
      className={s.resizer}
      data-testid="pane-resizer"
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.dataset.dragging = '';
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const px = fromPointer(e.clientX);
        if (px != null) onWidth(px, false);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        delete e.currentTarget.dataset.dragging;
        e.currentTarget.releasePointerCapture(e.pointerId);
        const px = fromPointer(e.clientX);
        if (px != null) onWidth(px);
      }}
      onPointerCancel={(e) => {
        dragging.current = false;
        delete e.currentTarget.dataset.dragging;
      }}
    />
  );
}
