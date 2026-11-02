import { unstable_batchedUpdates } from 'react-dom';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** How long a mark keeps `data-enter` (longest entrance: fill 360ms + 10 staggered marks of 24ms, rounded up). */
export const ENTER_MS = 700;

/**
 * True for the first ENTER_MS after a component mounts, then false for good. A mark sets `data-enter` from it,
 * so the grow-in keyframes run once; a re-render, sort or filter never replays them (the attribute is gone
 * and the keyframes only run when the element is created with it).
 */
export function useFirstMount(active = true): boolean {
  // `active = false` (a container whose entrance is over) starts false and sets no timer: a virtualised table
  // mounts a mark per cell as rows scroll in, and each of those timers used to cost a React commit.
  const [first, setFirst] = useState(active);
  useEffect(() => {
    if (!active) return undefined;
    return afterEntrance(() => setFirst(false));
  }, [active]);
  return active && first;
}

/**
 * One timer per 100 ms bucket of mounts instead of one per mark: a table paints hundreds of marks in a commit, and a
 * timer each meant hundreds of separate commits ENTER_MS later. The callbacks of a bucket run in one batch.
 */
const BUCKET_MS = 100;
const buckets = new Map<number, Set<() => void>>();
function afterEntrance(cb: () => void): () => void {
  const key = Math.floor(performance.now() / BUCKET_MS);
  let set = buckets.get(key);
  if (!set) {
    const mine = new Set<() => void>();
    set = mine;
    buckets.set(key, mine);
    window.setTimeout(() => {
      buckets.delete(key);
      unstable_batchedUpdates(() => mine.forEach((f) => f()));
    }, ENTER_MS + BUCKET_MS);
  }
  set.add(cb);
  const mine = set;
  return () => void mine.delete(cb);
}

/**
 * Containers that mount marks late or repeatedly (a virtualised table that remounts rows as they scroll into
 * view) provide `false` once their own first paint is over, so scrolled-in marks do not grow in again.
 */
export const EnterContext = createContext(true);

/** Entrance flag for a data mark: its own first mount AND its container still in its entrance window. */
export function useEntrance(): boolean {
  const container = useContext(EnterContext);
  const first = useFirstMount(container);
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
