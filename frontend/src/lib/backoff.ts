/**
 * Polling cadence for live pages (decision logged in the experiments OPEN_QUESTIONS,
 * Q10): start at 5 s, multiply by 1.5 after every refresh that arrives, cap at 60 s.
 * Polling stops while nothing is live and while the tab is hidden.
 */
import { useState } from 'react';
import { usePageVisible } from './polling';

export const BACKOFF_MIN_MS = 5000;
export const BACKOFF_FACTOR = 1.5;
export const BACKOFF_MAX_MS = 60000;

export interface BackoffOptions {
  minMs?: number;
  factor?: number;
  maxMs?: number;
  /** TanStack `dataUpdatedAt`: every new value means a refresh arrived, so the delay grows. */
  dataUpdatedAt?: number;
  /** When this changes the delay restarts at `minMs` (e.g. a fingerprint of the data). */
  resetKey?: unknown;
}

/** The delay that follows `current` (rounded to whole milliseconds, never above `maxMs`). */
export function nextBackoff(
  current: number,
  factor = BACKOFF_FACTOR,
  minMs = BACKOFF_MIN_MS,
  maxMs = BACKOFF_MAX_MS,
): number {
  return Math.min(maxMs, Math.max(minMs, Math.round(current * factor)));
}

interface BackoffState {
  delay: number;
  stamp: number;
  key: unknown;
}

/**
 * `refetchInterval` value for TanStack Query: a growing delay while `active`, `false`
 * when nothing is live or the tab is hidden.
 */
export function useBackoffInterval(active: boolean, options: BackoffOptions = {}): number | false {
  const {
    minMs = BACKOFF_MIN_MS,
    factor = BACKOFF_FACTOR,
    maxMs = BACKOFF_MAX_MS,
    dataUpdatedAt = 0,
    resetKey,
  } = options;
  const visible = usePageVisible();
  const [state, setState] = useState<BackoffState>({ delay: minMs, stamp: dataUpdatedAt, key: resetKey });
  // Adjust state during render (React docs pattern): no effect, no extra paint.
  if (!active) {
    if (state.delay !== minMs || state.stamp !== dataUpdatedAt || state.key !== resetKey)
      setState({ delay: minMs, stamp: dataUpdatedAt, key: resetKey });
  } else if (!Object.is(state.key, resetKey)) {
    setState({ delay: minMs, stamp: dataUpdatedAt, key: resetKey });
  } else if (state.stamp !== dataUpdatedAt) {
    // The very first load keeps the minimum delay; later refreshes back off.
    setState({
      delay: state.stamp === 0 ? minMs : nextBackoff(state.delay, factor, minMs, maxMs),
      stamp: dataUpdatedAt,
      key: resetKey,
    });
  }
  if (!active || !visible) return false;
  return state.delay;
}
