/**
 * Round 7 (Q2): the runs page warms the passes of its repeat runs in the background. Order, the cap of 20 runs, at most 4
 * requests in flight, terminal runs only, cancellation when the page's rows change, `saveData`, and the guarantee that
 * what is prefetched is what the strip asks for (same query key, one request per key).
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import { createQueryClient } from '@/app/queryClient';
import { runKeys, useGroupMetrics, useRunPasses } from '@/api/dashboard';
import type { MetricType, RunRow } from '@/api/dashboardTypes';
import { groupQueryFor } from './groupQuery';
import {
  PREFETCH_CONCURRENCY,
  PREFETCH_MAX_RUNS,
  PrefetchQueue,
  planPrefetch,
  saveDataOn,
  usePassesPrefetch,
  type PrefetchUnit,
} from './usePassesPrefetch';

// ---- the network: every request is a promise the test settles ------------------------------------------------------
interface Pending {
  url: string;
  signal: AbortSignal | undefined;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}
const requests: Pending[] = [];
let log: string[] = [];
vi.mock('@/lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(
        (url: string, init?: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            log.push(url);
            requests.push({ url, signal: init?.signal, resolve, reject });
          }),
      ),
    },
  };
});

const metricTypes: Record<string, MetricType> = { correct: 'score', quality: 'score', latency: 'numeric' };
const specs = {
  correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, primary: true },
  quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7 },
};
const row = (id: string, over: Partial<RunRow> = {}): RunRow =>
  ({
    run_id: id,
    run_name: id,
    external_run_id: id,
    model_key: 'm',
    timestamp: '2026-10-01T00:00:00Z',
    metrics: ['correct', 'quality', 'latency'],
    metric_specs: specs,
    metric_averages: { correct: 1, quality: 0.6 },
    samples: 10,
    total_items: 300,
    status: 'COMPLETED',
    ...over,
  }) as unknown as RunRow;
const rows = (n: number, over: Partial<RunRow> = {}) =>
  Array.from({ length: n }, (_, i) => row(`r${i + 1}`, over));

beforeEach(() => {
  requests.length = 0;
  log = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'connection');
});

describe('planPrefetch', () => {
  it('lists finished repeat runs in row order and stops at the cap', () => {
    const jobs = planPrefetch(rows(PREFETCH_MAX_RUNS + 5), null, metricTypes);
    expect(jobs).toHaveLength(PREFETCH_MAX_RUNS);
    expect(jobs.map((j) => j.runId)).toEqual(
      Array.from({ length: PREFETCH_MAX_RUNS }, (_, i) => `r${i + 1}`),
    );
  });

  it('skips single-pass runs and runs that are still running or pending', () => {
    const page = [
      row('classic', { samples: 1 }),
      row('live', { status: 'RUNNING' }),
      row('queued', { status: 'PENDING' }),
      row('done'),
      row('failed', { status: 'FAILED' }),
    ];
    expect(planPrefetch(page, null, metricTypes).map((j) => j.runId)).toEqual(['done', 'failed']);
  });

  it('asks for the metric and threshold a fresh strip would open with', () => {
    expect(planPrefetch([row('a')], null, metricTypes)).toEqual([
      { runId: 'a', metric: 'correct', threshold: 0.9999 },
    ]);
    // the remembered metric wins when the run has it; the declared threshold of that metric is the default otherwise
    const q = planPrefetch(
      [row('a', { metric_averages: { correct: 1, quality: 0.62 } })],
      'quality',
      metricTypes,
    )[0]!;
    expect(q.metric).toBe('quality');
    expect(q.threshold).toBe(
      groupQueryFor(row('a', { metric_averages: { correct: 1, quality: 0.62 } }), 'quality', metricTypes)!
        .threshold,
    );
  });

  it('uses the strip’s own helper, so the two cannot drift', () => {
    for (const remembered of [null, 'quality', 'latency', 'gone']) {
      const r = row('x');
      const q = groupQueryFor(r, remembered, metricTypes);
      const job = planPrefetch([r], remembered, metricTypes)[0]!;
      expect({ metric: job.metric, threshold: job.threshold }).toEqual(q);
      expect(q!.metric).not.toBe('latency'); // numeric metrics have no pass statistics
    }
  });
});

describe('PrefetchQueue', () => {
  const unit = (
    runId: string,
    started: string[],
    cancelled: string[],
  ): PrefetchUnit & { done: () => void; fail: () => void } => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const settled = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    settled.catch(() => undefined);
    return {
      runId,
      start: () => {
        started.push(runId);
        return settled;
      },
      cancel: () => cancelled.push(runId),
      done: () => resolve(),
      fail: () => reject(new Error('boom')),
    };
  };
  const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

  it('starts requests in order, at most four at a time, and refills as they finish', async () => {
    const started: string[] = [];
    const units = Array.from({ length: 10 }, (_, i) => unit(`r${i}`, started, []));
    const q = new PrefetchQueue(units);
    q.start();
    await flush();
    expect(started).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(q.inFlight).toBe(PREFETCH_CONCURRENCY);
    units[1]!.done();
    await flush();
    expect(started).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    units[0]!.fail(); // a failed prefetch frees its slot and shows nothing
    await flush();
    expect(started).toHaveLength(6);
    for (const u of units) u.done();
    for (let i = 0; i < 4; i++) await flush();
    expect(started).toHaveLength(10);
    expect(q.maxInFlight).toBeLessThanOrEqual(PREFETCH_CONCURRENCY);
  });

  it('cancel(keep) drops the queued units and cancels only in-flight ones whose run left the page', async () => {
    const started: string[] = [];
    const cancelled: string[] = [];
    const units = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => unit(id, started, cancelled));
    const q = new PrefetchQueue(units);
    q.start();
    await flush();
    q.cancel(new Set(['b', 'c']));
    expect(cancelled.sort()).toEqual(['a', 'd']);
    expect(q.queued).toBe(0);
    units[1]!.done();
    await flush();
    expect(started).toEqual(['a', 'b', 'c', 'd']); // nothing new starts after the cancel
  });

  it('cancel() with no keep set stops the queue for good', async () => {
    const started: string[] = [];
    const units = ['a', 'b', 'c', 'd', 'e'].map((id) => unit(id, started, []));
    const q = new PrefetchQueue(units);
    q.start();
    await flush();
    q.cancel();
    units[0]!.done();
    await flush();
    expect(started).toHaveLength(4);
  });
});

describe('saveData', () => {
  it('reads navigator.connection.saveData', () => {
    expect(saveDataOn()).toBe(false);
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    expect(saveDataOn()).toBe(true);
  });
});

describe('usePassesPrefetch', () => {
  const setup = (initial: RunRow[], remembered: string | null = null) => {
    const qc = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const hook = renderHook(
      (props: { rows: RunRow[] }) => usePassesPrefetch(props.rows, remembered, metricTypes),
      { wrapper, initialProps: { rows: initial } },
    );
    return { qc, hook, wrapper };
  };
  const idle = () => act(async () => void (await vi.advanceTimersByTimeAsync(600)));
  const settle = async (r: Pending, value: unknown = { passes: [], samples: 10, metrics: [] }) => {
    await act(async () => {
      r.resolve(value);
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  it('waits for the page to settle and the browser to idle, then keeps four requests in flight in row order', async () => {
    setup(rows(6));
    expect(requests).toHaveLength(0); // nothing starts before the idle callback
    await idle();
    expect(requests.map((r) => r.url)).toEqual([
      '/api/runs/r1/passes',
      '/api/runs/r1/group-metrics?metric=correct&threshold=0.9999&view=group',
      '/api/runs/r2/passes',
      '/api/runs/r2/group-metrics?metric=correct&threshold=0.9999&view=group',
    ]);
    await settle(requests[0]!);
    expect(requests).toHaveLength(5);
    expect(requests[4]!.url).toBe('/api/runs/r3/passes');
    expect(requests.filter((r) => !r.signal?.aborted).length - 1).toBeLessThanOrEqual(PREFETCH_CONCURRENCY); // one is done
  });

  it('issues nothing for running runs, for classic runs, and when saveData is on', async () => {
    setup([row('live', { status: 'RUNNING' }), row('classic', { samples: 1 })]);
    await idle();
    expect(requests).toHaveLength(0);
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    setup(rows(3));
    await idle();
    expect(requests).toHaveLength(0);
  });

  it('opening a prefetched group issues no request; a group already in flight issues no second one', async () => {
    const { qc, wrapper } = setup(rows(2));
    await idle();
    const passesReq = requests.find((r) => r.url === '/api/runs/r1/passes')!;
    // the click arrives while the prefetch of r1 is in flight: it attaches to the same request
    const open = renderHook(() => useRunPasses('r1'), { wrapper });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(log.filter((u) => u === '/api/runs/r1/passes')).toHaveLength(1);
    await settle(passesReq, { passes: [], samples: 10, metrics: ['correct'] });
    expect(open.result.current.data).toBeDefined();
    // once the data is in the cache a later open (within the 30 s of staleTime) starts nothing
    open.unmount();
    const before = log.length;
    renderHook(() => useRunPasses('r1'), { wrapper });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(log.length).toBe(before);
    // and the strip reads the entry the prefetch filled (`view=group` key)
    const q = groupQueryFor(rows(1)[0]!, null, metricTypes)!;
    expect(
      qc.getQueryCache().find({ queryKey: runKeys.groupMetrics('r1', q.metric, q.threshold, 'group') }),
    ).toBeDefined();
    const strip = renderHook(() => useGroupMetrics('r1', q.metric, q.threshold, { view: 'group' }), {
      wrapper,
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(log.filter((u) => u.startsWith('/api/runs/r1/group-metrics'))).toHaveLength(1);
    strip.unmount();
  });

  it('a change of the page drops the queue and cancels the requests of runs that left it', async () => {
    const { hook } = setup(rows(8));
    await idle();
    expect(requests).toHaveLength(4); // r1 and r2: passes + group-metrics
    hook.rerender({ rows: [row('r2'), row('x1'), row('x2')] }); // a new page: r1 is gone, r2 stays
    await idle();
    const byUrl = (u: string) => requests.find((r) => r.url.startsWith(u))!;
    expect(byUrl('/api/runs/r1/passes').signal?.aborted).toBe(true);
    expect(byUrl('/api/runs/r1/group-metrics').signal?.aborted).toBe(true);
    expect(byUrl('/api/runs/r2/passes').signal?.aborted).toBe(false);
    // the old queue's r3..r8 never start; the new plan starts after its own idle
    expect(log.some((u) => /\/r[3-8]\//.test(u))).toBe(false);
    expect(log.some((u) => u.startsWith('/api/runs/x1/passes'))).toBe(true);
  });
});
