/**
 * Live-status cadence (brief 03 §2.J3): 60 s idle; 15 s with live runs or
 * while backfilling; 2 s for 60 s after a stop was requested; back-off
 * 2→4→8→15 s while summaries are updating; never while the tab is hidden;
 * a `qym:run-status` bus message refetches now and polls fast for 20 s.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageVisible } from '@/lib/polling';
import { useRunStatus } from '@/lib/run-status';
import type { Freshness, RunRow } from '@/api/dashboardTypes';

export const IDLE_MS = 60_000;
export const LIVE_MS = 15_000;
export const STOPPING_MS = 2_000;
export const ANNOUNCED_STOP_WINDOW_MS = 20_000;
export const STOPPING_FALLBACK_MS = 60_000;

export function isActiveRun(row: Pick<RunRow, 'status'>): boolean {
  return row.status === 'RUNNING' || row.status === 'PENDING';
}

export function isStoppingRun(row: Pick<RunRow, 'status' | 'stop_requested'>): boolean {
  return Boolean(row.stop_requested) && isActiveRun(row);
}

export interface CadenceInput {
  rows: Pick<RunRow, 'status' | 'stop_requested'>[];
  freshness?: Freshness | null;
  hasActiveRuns?: boolean | null;
}

/**
 * Pure cadence: `updatingPolls` counts consecutive polls seen while updating;
 * `stoppingSince`/`announcedUntil` are epoch ms.
 */
export function computeInterval(
  input: CadenceInput,
  state: { updatingPolls: number; stoppingSince: number; announcedUntil: number },
  now = Date.now(),
): number {
  const updating = Boolean(input.freshness?.updating);
  const backoff = Math.min(15_000, 2000 * 2 ** Math.max(0, state.updatingPolls - 1));
  const stoppingShown = input.rows.some(isStoppingRun);
  const stopping =
    now < state.announcedUntil || (stoppingShown && now - state.stoppingSince < STOPPING_FALLBACK_MS);
  if (stopping) return STOPPING_MS;
  if (input.freshness?.backfilling) return LIVE_MS;
  if (updating) return backoff;
  if (input.hasActiveRuns || input.rows.some(isActiveRun)) return LIVE_MS;
  return IDLE_MS;
}

/** The TanStack refetchInterval for the runs page; `onAnnounce` runs on a run-status bus message. */
export function useRunsCadence(input: CadenceInput, onAnnounce: () => void): number | false {
  const visible = usePageVisible();
  const [announcedUntil, setAnnouncedUntil] = useState(0);
  const [updatingPolls, setUpdatingPolls] = useState(0);
  const [stoppingSince, setStoppingSince] = useState(0);
  const updating = Boolean(input.freshness?.updating);
  const stoppingShown = input.rows.some(isStoppingRun);
  const freshness = input.freshness;

  // State adjusted during render (React docs pattern): one step per new
  // freshness payload while updating; the stop clock starts when a stopping
  // row first shows.
  const [seenFreshness, setSeenFreshness] = useState<Freshness | null | undefined>(freshness);
  if (seenFreshness !== freshness) {
    setSeenFreshness(freshness);
    setUpdatingPolls(updating ? updatingPolls + 1 : 0);
  }
  // The stop clock is an external clock: start/stop it in an effect (no setState
  // in the effect body; the timestamp is written through a ref the render reads
  // only via computeInterval's `now` argument on the next poll).
  useEffect(() => {
    if (!stoppingShown) return;
    const startedAt = Date.now();
    const id = setTimeout(() => setStoppingSince(startedAt), 0);
    return () => clearTimeout(id);
  }, [stoppingShown]);
  const effectiveStoppingSince = stoppingShown ? stoppingSince : 0;

  const listener = useCallback(() => {
    setAnnouncedUntil(Date.now() + ANNOUNCED_STOP_WINDOW_MS);
    onAnnounce();
  }, [onAnnounce]);
  useRunStatus(listener);

  // Leave the announced window on time (so the interval returns to normal).
  useEffect(() => {
    if (!announcedUntil) return;
    const t = setTimeout(() => setAnnouncedUntil(0), Math.max(0, announcedUntil - Date.now()));
    return () => clearTimeout(t);
  }, [announcedUntil]);

  if (!visible) return false;
  return computeInterval(input, { updatingPolls, stoppingSince: effectiveStoppingSince, announcedUntil });
}

/** Refetch once when the tab becomes visible again (hidden tabs never poll). */
export function useRefetchOnVisible(refetch: () => void): void {
  const visible = usePageVisible();
  const was = useRef(visible);
  useEffect(() => {
    if (!was.current && visible) refetch();
    was.current = visible;
  }, [visible, refetch]);
}
