import { describe, expect, it } from 'vitest';
import { batchStatGroups, flattenRunsPage, type StatGroup } from '../dashboardModels';

const group = (key: string, n: number): StatGroup => ({
  key,
  runs: Array.from({ length: n }, (_, i) => `${key}-${i}`),
});

describe('batchStatGroups', () => {
  it('keeps one batch when within limits', () => {
    expect(batchStatGroups([group('a', 5), group('b', 5)])).toHaveLength(1);
  });
  it('splits beyond 100 groups', () => {
    const groups = Array.from({ length: 250 }, (_, i) => group(`g${i}`, 1));
    const batches = batchStatGroups(groups);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
  });
  it('splits beyond 2000 runs without splitting a group', () => {
    const batches = batchStatGroups([group('a', 1500), group('b', 400), group('c', 300), group('d', 2000)]);
    expect(batches.map((b) => b.map((g) => g.key))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(batches.every((b) => b.reduce((n, g) => n + g.runs.length, 0) <= 2000)).toBe(true);
  });
  it('drops duplicate runs inside a group', () => {
    expect(batchStatGroups([{ key: 'a', runs: ['r1', 'r1', 'r2'] }])[0]![0]!.runs).toEqual(['r1', 'r2']);
  });
  it('returns nothing for no groups', () => {
    expect(batchStatGroups([])).toEqual([]);
  });
});

describe('flattenRunsPage', () => {
  it('flattens task -> model -> runs, newest first', () => {
    const run = (id: string, timestamp: string) => ({ run_id: id, task_name: 't', timestamp });
    const rows = flattenRunsPage({
      t: { m1: [run('a', '2026-01-01'), run('c', '2026-03-01')], m2: [run('b', '2026-02-01')] },
    });
    expect(rows.map((r) => r.run_id)).toEqual(['c', 'b', 'a']);
  });
});
