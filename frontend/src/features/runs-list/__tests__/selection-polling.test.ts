import { beforeEach, describe, expect, it } from 'vitest';
import {
  cohortRefsConflict,
  cohortUnitCount,
  expandComparisonRefs,
  handoffCompare,
  passRef,
  readSelection,
  readVisibleColumns,
  writeSelection,
  writeVisibleColumns,
} from '../selection';
import { computeInterval, IDLE_MS, LIVE_MS, STOPPING_MS } from '../polling';

const samplesOf = (id: string) => (id === 'repeat' ? 3 : 1);

describe('selection refs', () => {
  beforeEach(() => sessionStorage.clear());
  it('expands repeat runs to pass refs for the compare page', () => {
    expect(expandComparisonRefs(['a', 'repeat', passRef('repeat', 2)], samplesOf)).toEqual([
      'a',
      'repeat::pass1',
      'repeat::pass2',
      'repeat::pass3',
      'repeat::pass2',
    ]);
    expect(cohortUnitCount(['a', 'repeat', 'repeat::pass1'], samplesOf)).toBe(5);
    expect(cohortRefsConflict('repeat', 'repeat::pass1')).toBe(true);
    expect(cohortRefsConflict('repeat::pass1', 'repeat::pass2')).toBe(false);
  });
  it('writes sessionStorage.compareRuns and the query', () => {
    expect(handoffCompare(['a', 'b'], samplesOf)).toBe('runs=a&runs=b');
    expect(JSON.parse(sessionStorage.getItem('compareRuns')!)).toEqual(['a', 'b']);
    expect(sessionStorage.getItem('compareCohorts')).toBeNull();
  });
  it('persists the selection per project with the legacy shape', () => {
    writeSelection('p', { selected: ['a'], cohortA: [], passRevisions: {} });
    expect(JSON.parse(sessionStorage.getItem('qym:runs-selection:p')!)).toEqual({
      selected: ['a'],
      cohortA: [],
      passRevisions: {},
    });
    expect(readSelection('p').selected).toEqual(['a']);
    writeSelection('p', { selected: [], cohortA: [], passRevisions: {} });
    expect(sessionStorage.getItem('qym:runs-selection:p')).toBeNull();
  });
  it('stores visible columns as {version:2, visible}', () => {
    expect(readVisibleColumns()).toBeNull();
    writeVisibleColumns(new Set(['accuracy', '__runs_col_task__']));
    expect(JSON.parse(sessionStorage.getItem('qym_visible_metrics')!)).toEqual({
      version: 2,
      visible: ['accuracy', '__runs_col_task__'],
    });
    expect([...readVisibleColumns()!]).toEqual(['accuracy', '__runs_col_task__']);
  });
});

describe('polling cadence', () => {
  const idle = { updatingPolls: 0, stoppingSince: 0, announcedUntil: 0 };
  const fresh = { updating: false, pending_partitions: 0, backfilling: false, unpublished_runs: 0, failed_partitions: 0, oldest_pending_at: null };
  it('idles at 60 s and goes live with an active row', () => {
    expect(computeInterval({ rows: [{ status: 'COMPLETED', stop_requested: false }], freshness: fresh }, idle)).toBe(IDLE_MS);
    expect(computeInterval({ rows: [{ status: 'RUNNING', stop_requested: false }], freshness: fresh }, idle)).toBe(LIVE_MS);
    expect(computeInterval({ rows: [], freshness: fresh, hasActiveRuns: true }, idle)).toBe(LIVE_MS);
  });
  it('backs off 2→4→8→15 while updating', () => {
    const upd = { ...fresh, updating: true };
    expect(computeInterval({ rows: [], freshness: upd }, { ...idle, updatingPolls: 1 })).toBe(2000);
    expect(computeInterval({ rows: [], freshness: upd }, { ...idle, updatingPolls: 2 })).toBe(4000);
    expect(computeInterval({ rows: [], freshness: upd }, { ...idle, updatingPolls: 3 })).toBe(8000);
    expect(computeInterval({ rows: [], freshness: upd }, { ...idle, updatingPolls: 9 })).toBe(15_000);
  });
  it('polls every 2 s after a stop, for a minute at most', () => {
    const now = 1_000_000;
    const stopping = { rows: [{ status: 'RUNNING' as const, stop_requested: true }], freshness: fresh };
    expect(computeInterval(stopping, { ...idle, stoppingSince: now - 1000 }, now)).toBe(STOPPING_MS);
    expect(computeInterval(stopping, { ...idle, stoppingSince: now - 61_000 }, now)).toBe(LIVE_MS);
    expect(computeInterval({ rows: [], freshness: fresh }, { ...idle, announcedUntil: now + 5000 }, now)).toBe(STOPPING_MS);
  });
});
