/**
 * Background prefetch of the passes of the page's repeat runs (round 7, Q2; `redesign7/qa.md` section Q2.3).
 *
 * Opening a group used to start its two requests (`/passes` and `/group-metrics`) on the click, so every open waited for
 * the network with the placeholders on screen. After the list has painted and its own requests have settled, the page now
 * warms the cache with the same two queries (same keys and functions as the open group) for each terminal repeat run, a few
 * at a time, so a click finds the rows already in the cache: 0 requests after the click.
 *
 * The numbers below are choices to tune against real data, not product constants (decision R7-D4): the cap bounds the
 * server work one list view can cause, the concurrency bounds what the browser and the platform see at once.
 */
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { prefetchGroupMetrics, prefetchRunPasses, runKeys, type GroupMetricsView } from '@/api/dashboard';
import type { MetricType, RunRow } from '@/api/dashboardTypes';
import { isActiveRun } from '../polling';
import { groupQueryFor } from './groupQuery';

/** At most this many runs of one page are prefetched (spec Q2.3). */
export const PREFETCH_MAX_RUNS = 20;
/** At most this many prefetch requests are in flight at once (spec Q2.3). */
export const PREFETCH_CONCURRENCY = 4;
/** The queue starts when the browser is idle, at the latest after this long (spec Q2.3). */
export const PREFETCH_IDLE_TIMEOUT_MS = 500;

export interface PrefetchJob {
  runId: string;
  metric: string;
  threshold: number;
}

/**
 * The runs to warm, in row order: repeat runs (`samples > 1`) that have finished. A RUNNING or PENDING run polls and is
 * fetched when it is opened, as before. At most `PREFETCH_MAX_RUNS`.
 */
export function planPrefetch(
  rows: RunRow[],
  remembered: string | null,
  metricTypes: Record<string, MetricType>,
): PrefetchJob[] {
  const jobs: PrefetchJob[] = [];
  for (const row of rows) {
    if (jobs.length >= PREFETCH_MAX_RUNS) break;
    if (row.samples <= 1 || isActiveRun(row)) continue;
    const query = groupQueryFor(row, remembered, metricTypes);
    jobs.push({ runId: row.run_id, metric: query?.metric ?? '', threshold: query?.threshold ?? 0 });
  }
  return jobs;
}

/** `navigator.connection.saveData`: the reader asked the browser to spend less data, so nothing is prefetched. */
export function saveDataOn(): boolean {
  const connection = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/** Runs `cb` when the browser is idle (at the latest after `timeout` ms); returns the cancel function. */
export function whenIdle(cb: () => void, timeout = PREFETCH_IDLE_TIMEOUT_MS): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(cb, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
}

/** One request of the queue. */
export interface PrefetchUnit {
  runId: string;
  start: () => Promise<unknown>;
  /** Called for a unit in flight whose run left the page. */
  cancel: () => void;
}

/** A queue of requests started in order, `concurrency` at a time; pure (no React, no query client). */
export class PrefetchQueue {
  private pending: PrefetchUnit[];
  private active = new Set<PrefetchUnit>();
  private stopped = false;
  /** The most requests that were in flight together (for tests and measurements). */
  maxInFlight = 0;
  started = 0;

  constructor(
    units: PrefetchUnit[],
    private readonly concurrency = PREFETCH_CONCURRENCY,
  ) {
    this.pending = [...units];
  }

  get inFlight(): number {
    return this.active.size;
  }

  get queued(): number {
    return this.pending.length;
  }

  start(): void {
    this.pump();
  }

  /** Drops what has not started; cancels what is in flight for runs that are not in `keep`. */
  cancel(keep?: ReadonlySet<string>): void {
    if (!keep) this.stopped = true;
    this.pending = [];
    for (const unit of this.active) if (!keep || !keep.has(unit.runId)) unit.cancel();
  }

  private pump(): void {
    while (!this.stopped && this.active.size < this.concurrency && this.pending.length) {
      const unit = this.pending.shift()!;
      this.active.add(unit);
      this.started += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.active.size);
      void Promise.resolve()
        .then(() => unit.start())
        .catch(() => undefined) // a failed prefetch shows nothing: the group fetches again when it is opened
        .finally(() => {
          this.active.delete(unit);
          this.pump();
        });
    }
  }
}

const isPrefetchKey = (key: readonly unknown[]): boolean => key[0] === 'run';

/**
 * Starts the prefetch of `rows` once the page's own requests have settled and the browser is idle. A change of the page's
 * rows (page, filter, sort, time range, metric) drops what was queued and cancels the requests of runs that left it.
 */
export function usePassesPrefetch(
  rows: RunRow[],
  remembered: string | null,
  metricTypes: Record<string, MetricType>,
  enabled = true,
): void {
  const qc = useQueryClient();
  // everything but the prefetch's own queries ('run' keys): runs, overview, active-runs, versions ...
  const pageFetching = useIsFetching({ predicate: (q) => !isPrefetchKey(q.queryKey) });
  const settled = pageFetching === 0;
  const jobs = planPrefetch(rows, remembered, metricTypes);
  const planKey = jobs.map((j) => `${j.runId}:${j.metric}:${j.threshold}`).join('|');
  // the effects below are keyed by the plan, not by the identity of the arrays a poll hands us
  const latest = useRef({ jobs, pageIds: new Set<string>() });
  // (declared first: the effects after it read the plan of this very commit)
  useEffect(() => {
    latest.current = { jobs, pageIds: new Set(rows.map((r) => r.run_id)) };
  });
  const queue = useRef<{ key: string; queue: PrefetchQueue } | null>(null);
  const cancelIdle = useRef<(() => void) | null>(null);

  // a new plan (page, filter, sort, time range, metric) replaces the old one at once
  useEffect(() => {
    if (queue.current && queue.current.key !== planKey) {
      queue.current.queue.cancel(latest.current.pageIds);
      queue.current = null;
    }
    cancelIdle.current?.();
    cancelIdle.current = null;
  }, [planKey]);

  useEffect(() => {
    if (!enabled || !settled || !planKey || queue.current?.key === planKey || saveDataOn()) return undefined;
    cancelIdle.current = whenIdle(() => {
      cancelIdle.current = null;
      const view: GroupMetricsView = 'group';
      const units: PrefetchUnit[] = latest.current.jobs.flatMap((job) => {
        const passes: PrefetchUnit = {
          runId: job.runId,
          start: () => prefetchRunPasses(qc, job.runId),
          cancel: () => void qc.cancelQueries({ queryKey: runKeys.passes(job.runId), exact: true }),
        };
        const group: PrefetchUnit[] = job.metric
          ? [
              {
                runId: job.runId,
                start: () => prefetchGroupMetrics(qc, job.runId, job.metric, job.threshold, view),
                cancel: () =>
                  void qc.cancelQueries({
                    queryKey: runKeys.groupMetrics(job.runId, job.metric, job.threshold, view),
                    exact: true,
                  }),
              },
            ]
          : [];
        return [passes, ...group];
      });
      const q = new PrefetchQueue(units);
      queue.current = { key: planKey, queue: q };
      q.start();
    });
    return () => {
      cancelIdle.current?.();
      cancelIdle.current = null;
    };
    // `settled` flipping after the queue started changes nothing: the queue is keyed by the plan
  }, [enabled, settled, planKey, qc]);

  // leaving the page cancels what is in flight
  useEffect(
    () => () => {
      queue.current?.queue.cancel();
      queue.current = null;
    },
    [],
  );
}
