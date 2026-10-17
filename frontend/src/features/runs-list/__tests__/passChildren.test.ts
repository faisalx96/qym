import { describe, expect, it, vi } from 'vitest';
import type { RunPass, RunPasses, RunRow } from '@/api/dashboardTypes';
import { childRowsOf, loadingCount, resolveMetric, runKeyOf } from '../passes/rows';

const run = (samples: number, status = 'COMPLETED') => ({ run_id: 'r1', samples, status }) as unknown as RunRow;
const pass = (n: number, status: string) => ({ pass_number: n, status }) as unknown as RunPass;
const data = (passes: RunPass[], samples: number) => ({ passes, samples }) as unknown as RunPasses;
const q = (over: Partial<Parameters<typeof childRowsOf>[1] & object>) => ({
  isPending: false,
  isError: false,
  error: null,
  refetch: () => undefined,
  ...over,
});

describe('childRowsOf', () => {
  it('shows as many loading rows as the run has passes (1..10) and keeps the strip's frame', () => {
    const out = childRowsOf(run(3), q({ isPending: true }));
    expect(out.rows.map((r) => r.kind)).toEqual(['loading', 'loading', 'loading']);
    expect(out.detail).toBe(true);
    expect(loadingCount(30)).toBe(10);
    expect(loadingCount(0)).toBe(1);
  });

  it('shows one error row with a retry that refetches', () => {
    const refetch = vi.fn();
    const out = childRowsOf(run(3), q({ isError: true, error: new Error('x'), refetch }));
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0]!;
    expect(row.kind).toBe('error');
    if (row.kind === 'error') row.retry();
    expect(refetch).toHaveBeenCalled();
    expect(out.detail).toBe(false);
  });

  it('keeps the data while a refetch fails', () => {
    const out = childRowsOf(run(1), q({ isError: true, data: data([pass(1, 'completed')], 1) }));
    expect(out.rows.map((r) => r.kind)).toEqual(['pass']);
  });

  it('keys passes by pass ref and folds waiting passes into one queued row after them', () => {
    const out = childRowsOf(
      run(5, 'RUNNING'),
      q({ data: data([pass(1, 'completed'), pass(2, 'running')], 5) }),
    );
    expect(out.rows.map((r) => r.key)).toEqual(['r1::pass1', 'r1::pass2', 'r1::queued']);
    expect(out.detail).toBe(true);
  });

  it('shows the run terminal status for a stale running pass and not-run for the rest', () => {
    const out = childRowsOf(run(3, 'STOPPED'), q({ data: data([pass(1, 'running')], 3) }));
    const first = out.rows[0]!;
    expect(first.kind === 'pass' && first.status).toBe('stopped');
    const last = out.rows[1]!;
    expect(last.kind === 'queued' && last.queued.notRun).toBe(true);
  });
});

describe('resolveMetric / runKeyOf', () => {
  it('uses the remembered metric only when the run has it', () => {
    expect(resolveMetric('q', ['c', 'q'], 'c')).toBe('q');
    expect(resolveMetric('zzz', ['c', 'q'], 'c')).toBe('c');
    expect(resolveMetric(null, ['c'], null)).toBe('c');
    expect(resolveMetric(null, [], null)).toBeNull();
  });
  it('reads the run id of any child key', () => {
    expect(runKeyOf('r1::pass2')).toBe('r1');
    expect(runKeyOf('r1::queued')).toBe('r1');
    expect(runKeyOf('r1')).toBe('r1');
  });
});
