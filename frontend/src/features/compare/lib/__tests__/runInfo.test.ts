import { describe, expect, it } from 'vitest';
import type { Run, RunPayload } from '@/features/run-detail/types';
import { differingContext, runCounts } from '../runInfo';

const run = (p: Partial<Run>): Run => ({ run_id: 'r', status: 'COMPLETED', ...p });

describe('differingContext', () => {
  it('lists only the keys that differ, grouped, with one value per run', () => {
    const a = run({
      git_branch: 'main',
      git_commit: 'abcdef1234567',
      config: { temperature: 0, top_p: 1 },
      versioning_details: { prompt: 'v1' },
    });
    const b = run({
      git_branch: 'feat',
      git_commit: 'abcdef1234567',
      config: { temperature: 0.7, top_p: 1 },
      versioning_details: { prompt: 'v1', extra: 'x' },
    });
    const diff = differingContext([a, b]);
    expect(diff.map((d) => `${d.group}:${d.key}`)).toEqual([
      'Git:branch',
      'Config:temperature',
      'Versioning:extra',
    ]);
    expect(diff[1]!.values).toEqual(['0', '0.7']);
    expect(diff[2]!.values).toEqual(['', 'x']);
  });
  it('is empty for identical runs or a single run', () => {
    expect(differingContext([run({ config: { a: 1 } }), run({ config: { a: 1 } })])).toEqual([]);
    expect(differingContext([run({})])).toEqual([]);
  });
});

describe('runCounts', () => {
  it('reads totals from the snapshot and errors from the run', () => {
    const rows = [
      { item_id: 'a', status: 'error', metric_values: [0] },
      { item_id: 'b', status: 'error', metric_values: [0] },
      { item_id: 'c', status: 'completed', metric_values: [0], metric_meta: { q: { status: 'error' } } },
      { item_id: 'd', status: 'completed', metric_values: [1] },
    ];
    // run.error_count + execution_error_count would say 5 here; the page counts items: 2 task + 1 scorer.
    const p = {
      run: run({ error_count: 2, execution_error_count: 3 }),
      snapshot: { rows, stats: { total: 40, completed: 37, failed: 3 } },
    } as unknown as RunPayload;
    expect(runCounts(p)).toEqual({ items: 40, completed: 37, errors: 3 });
  });
});
