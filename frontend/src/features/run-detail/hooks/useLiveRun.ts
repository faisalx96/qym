/**
 * Follow a running run (brief 04 §2 J2): probe /live-status every 3 s
 * (1.5 s while a stop is requested; exponential backoff to 30 s on errors;
 * paused while the tab is hidden), and refetch the compact payload when the
 * revision changed and the size-based throttle allows (3 s / 10 s / 30 s for
 * <500 / <5000 / more rows×passes, never sooner than 10× the last reload
 * duration, max 120 s). When `live` turns false: one final reload and the
 * dependent queries are invalidated. A `qym:run-status` announcement from
 * another tab triggers an immediate probe. The owner must remount per run
 * (key={runId}); the hook does not reset itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchLiveStatus, runKeys } from '@/api/runs';
import { usePageVisible } from '@/lib/polling';
import { useRunStatus } from '@/lib/run-status';
import type { LiveStatus, RunPayload } from '../types';

export const LIVE_PROBE_MS = 3000;
export const LIVE_PROBE_STOPPING_MS = 1500;
export const LIVE_PROBE_MAX_BACKOFF_MS = 30_000;

export function reloadThrottleMs(rowsTimesPasses: number, lastReloadMs: number): number {
  const base = rowsTimesPasses < 500 ? 3000 : rowsTimesPasses < 5000 ? 10_000 : 30_000;
  return Math.min(120_000, Math.max(base, lastReloadMs * 10));
}

export interface LiveRunState {
  live: boolean;
  status: LiveStatus | null;
  /** Epoch ms of the last successful live probe or compact reload while live. */
  updatedAt: number | null;
  /** server_time − Date.now() in ms, for the ticking runtime. */
  serverOffsetMs: number;
  stopRequested: boolean;
}

export function useLiveRun(runId: string, payload: RunPayload | undefined): LiveRunState {
  const qc = useQueryClient();
  const visible = usePageVisible();
  const runStatus = String(payload?.run.status ?? '').toUpperCase();
  const initiallyLive = runStatus === 'RUNNING' || runStatus === 'PENDING';
  const [state, setState] = useState<LiveRunState>({
    live: initiallyLive,
    status: null,
    updatedAt: null,
    serverOffsetMs: 0,
    stopRequested: !!payload?.run.stop_requested,
  });
  const revision = useRef<string | null>(payload?.run.live_revision ?? null);
  const lastReloadAt = useRef(0);
  const lastReloadDuration = useRef(0);
  const reloading = useRef(false);
  const finalQueued = useRef(false);
  const pendingRevision = useRef<string | null>(null);
  const liveRef = useRef(initiallyLive);
  const backoff = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The header may paint from the list row (no revision yet); the summary or the rows bring it a moment later.
  const payloadRevision = payload?.run.live_revision ?? null;
  useEffect(() => {
    if (revision.current === null && payloadRevision) revision.current = payloadRevision;
  }, [payloadRevision]);
  const rowsTimesPasses = (payload?.snapshot.rows.length ?? 0) * Math.max(1, payload?.run.samples ?? 1);

  const reload = useCallback(
    async (final = false) => {
      if (reloading.current) {
        // The run finished while a reload was in flight: that reload predates the end, so go again after it.
        if (final) finalQueued.current = true;
        return;
      }
      reloading.current = true;
      let again = final;
      try {
        do {
          finalQueued.current = false;
          const started = Date.now();
          await qc.refetchQueries({ queryKey: runKeys.compact(runId), exact: true });
          lastReloadAt.current = Date.now();
          lastReloadDuration.current = Date.now() - started;
          setState((s) => ({ ...s, updatedAt: Date.now() }));
          again = again || finalQueued.current;
        } while (finalQueued.current);
      } finally {
        reloading.current = false;
      }
      if (again) {
        void qc.invalidateQueries({ queryKey: runKeys.stepLatency(runId, null) });
        void qc.invalidateQueries({ queryKey: runKeys.reviewHistory(runId) });
        void qc.invalidateQueries({ queryKey: runKeys.passes(runId) });
      }
    },
    [qc, runId],
  );

  const probe = useCallback(async () => {
    let status: LiveStatus;
    try {
      status = await fetchLiveStatus(runId);
      backoff.current = 0;
    } catch {
      backoff.current = Math.min(LIVE_PROBE_MAX_BACKOFF_MS, (backoff.current || LIVE_PROBE_MS) * 2);
      return;
    }
    const serverTime = status.server_time ? Date.parse(status.server_time) : NaN;
    const serverOffsetMs = Number.isFinite(serverTime) ? serverTime - Date.now() : 0;
    const wasLive = liveRef.current;
    liveRef.current = status.live;
    setState((s) => ({
      ...s,
      status,
      live: status.live,
      stopRequested: !!status.stop_requested,
      serverOffsetMs,
      // Every successful probe is a fresh look at the run, so "updated Ns ago" restarts here.
      updatedAt: Date.now(),
    }));
    qc.setQueryData<LiveStatus>(runKeys.live(runId), status);
    if (!status.live) {
      if (wasLive || revision.current !== status.revision) {
        revision.current = status.revision;
        await reload(true);
      }
      return;
    }
    if (status.revision !== revision.current || pendingRevision.current) {
      const wait = reloadThrottleMs(rowsTimesPasses, lastReloadDuration.current);
      if (Date.now() - lastReloadAt.current >= wait) {
        revision.current = status.revision;
        pendingRevision.current = null;
        await reload(false);
      } else {
        pendingRevision.current = status.revision;
      }
    }
  }, [qc, reload, rowsTimesPasses, runId]);

  useEffect(() => {
    if (!state.live || !visible) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await probe();
      if (cancelled || !liveRef.current) return;
      const interval = backoff.current || (state.stopRequested ? LIVE_PROBE_STOPPING_MS : LIVE_PROBE_MS);
      timer.current = setTimeout(tick, interval);
    };
    timer.current = setTimeout(tick, LIVE_PROBE_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [probe, state.live, state.stopRequested, visible]);

  useRunStatus(
    useCallback(
      (message) => {
        if (!message.runIds.includes(runId)) return;
        if (message.status === 'STOPPING') setState((s) => ({ ...s, stopRequested: true }));
        void probe();
      },
      [probe, runId],
    ),
  );

  return state;
}

/** 1 s ticking "updated Ns ago" / runtime clock. */
export function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
