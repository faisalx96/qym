import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** How long a mark keeps `data-enter` (longest entrance: fill 360ms + 10 staggered marks of 24ms, rounded up). */
export const ENTER_MS = 700;

/**
 * True for the first ENTER_MS after a component mounts, then false for good. A mark sets `data-enter` from it,
 * so the grow-in keyframes run once; a re-render, sort or filter never replays them (the attribute is gone
 * and the keyframes only run when the element is created with it).
 */
export function useFirstMount(): boolean {
  const [first, setFirst] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setFirst(false), ENTER_MS);
    return () => window.clearTimeout(id);
  }, []);
  return first;
}

/**
 * Containers that mount marks late or repeatedly (a virtualised table that remounts rows as they scroll into
 * view) provide `false` once their own first paint is over, so scrolled-in marks do not grow in again.
 */
export const EnterContext = createContext(true);

/** Entrance flag for a data mark: its own first mount AND its container still in its entrance window. */
export function useEntrance(): boolean {
  const container = useContext(EnterContext);
  const first = useFirstMount();
  return container && first;
}

/** Stagger index for `--i`, capped so a long list never waits more than 240ms. */
export function staggerIndex(index: number | undefined): number {
  return Math.max(0, Math.min(index ?? 0, 10));
}

/**
 * M5: true for `--motion-flash` (700ms) after `value` changes (never on the first render), so a live value
 * (SSE update on a running run) can flash a faint tint. Off unless `enabled`.
 */
export function useFlashOnChange(value: unknown, enabled: boolean): boolean {
  const [flash, setFlash] = useState(false);
  const prev = useRef<unknown>(value);
  useEffect(() => {
    if (prev.current === value) return undefined;
    prev.current = value;
    if (!enabled) return undefined;
    const on = window.setTimeout(() => setFlash(true), 0);
    const off = window.setTimeout(() => setFlash(false), 700);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, [value, enabled]);
  return flash;
}
