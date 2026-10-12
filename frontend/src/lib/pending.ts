/**
 * Skeleton timing (shell.js arrival system): a skeleton never flashes for a
 * load shorter than --skeleton-wait (300 ms) and, once shown, stays at least
 * --skeleton-min (400 ms) so content does not jump in under it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const SKELETON_WAIT_MS = 300;
export const SKELETON_MIN_MS = 400;
export const ARRIVE_FADE_MS = 200;

export function useDelayedPending(pending: boolean, wait = SKELETON_WAIT_MS, min = SKELETON_MIN_MS): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (pending) {
      if (!shown) {
        timer = setTimeout(() => {
          shownAt.current = Date.now();
          setShown(true);
        }, wait);
      }
    } else if (shown) {
      const elapsed = Date.now() - (shownAt.current ?? 0);
      const remaining = Math.max(0, min - elapsed);
      timer = setTimeout(() => {
        shownAt.current = null;
        setShown(false);
      }, remaining);
    }
    return () => clearTimeout(timer);
  }, [pending, shown, wait, min]);
  return shown;
}

/** True for `ms` after `value` turns false (used to fade content in). */
export function useArrived(pending: boolean, ms = ARRIVE_FADE_MS): boolean {
  const [arriving, setArriving] = useState(false);
  const was = useRef(pending);
  useEffect(() => {
    if (was.current && !pending) {
      setArriving(true);
      const t = setTimeout(() => setArriving(false), ms);
      was.current = pending;
      return () => clearTimeout(t);
    }
    was.current = pending;
    return undefined;
  }, [pending, ms]);
  return arriving;
}

/**
 * Single-flight guard for form submits. Pressing Enter twice (or Enter then a click)
 * before React re-renders `isPending` would otherwise fire the mutation twice; a ref
 * flips synchronously so the second call is dropped (resolves `undefined`).
 */
export function useSubmitLock(): <T>(fn: () => Promise<T>) => Promise<T | undefined> {
  const busy = useRef(false);
  return useCallback(async <T>(fn: () => Promise<T>) => {
    if (busy.current) return undefined;
    busy.current = true;
    try {
      return await fn();
    } finally {
      busy.current = false;
    }
  }, []);
}
