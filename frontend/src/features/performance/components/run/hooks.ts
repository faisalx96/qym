/** Performance run page: two small hooks (a value that settles, and the age of a read). */
import { useEffect, useState } from 'react';

/** `value`, once it has stayed the same for `ms`. */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * Whole seconds since a read arrived (`receivedAt`, on this computer's clock), counted on once a second
 * while `ticking`. The clock is passed in, so a test or a fixed picture can hold it still.
 */
export function useSecondsSince(receivedAt: number | undefined, ticking: boolean, now: () => number): number {
  const [at, setAt] = useState(receivedAt ?? 0);
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setAt(now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking, now]);
  if (receivedAt === undefined) return 0;
  return Math.max(0, Math.floor((Math.max(at, receivedAt) - receivedAt) / 1000));
}
