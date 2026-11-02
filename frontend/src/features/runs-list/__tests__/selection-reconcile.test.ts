import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunRow } from '@/api/dashboardTypes';
import { readSelection, selectionKey, useRunsSelection } from '../selection';

const row = (run_id: string, pass_revision?: number) => ({ run_id, pass_revision }) as RunRow;

beforeEach(() => sessionStorage.clear());

describe('kept selection', () => {
  it('belongs to its project: another slug neither sees nor overwrites it', () => {
    const a = renderHook(() => useRunsSelection('pa'));
    act(() => a.result.current.setMany(['run-001', 'run-003'], true));
    expect(readSelection('pa').selected).toEqual(['run-001', 'run-003']);
    expect(readSelection('pb').selected).toEqual([]);
    const b = renderHook(() => useRunsSelection('pb'));
    expect([...b.result.current.selected]).toEqual([]);
    act(() => b.result.current.toggle('pb-run'));
    expect(readSelection('pa').selected).toEqual(['run-001', 'run-003']);
    expect(readSelection('pb').selected).toEqual(['pb-run']);
    // a fresh mount of pa (the tab came back) restores its picks
    expect([...renderHook(() => useRunsSelection('pa')).result.current.selected]).toEqual([
      'run-001',
      'run-003',
    ]);
  });

  it('deleted runs drop out and are not written back', () => {
    const { result } = renderHook(() => useRunsSelection('pa'));
    act(() => result.current.setMany(['run-001', 'run-002', 'run-003'], true));
    act(() => result.current.reconcile([row('run-001'), row('run-003')], new Set(['run-001', 'run-003'])));
    expect([...result.current.selected]).toEqual(['run-001', 'run-003']);
    const stored = sessionStorage.getItem(selectionKey('pa'))!;
    expect(stored).toContain('run-001');
    expect(stored).not.toContain('run-002');
  });

  it("a pick of a pass drops out when the run's passes changed, and one that did not change stays", () => {
    const { result } = renderHook(() => useRunsSelection('pa'));
    act(() => {
      result.current.setMany(['run-9::pass2', 'run-8::pass1'], true);
      result.current.notePassRevision('run-9', 1);
      result.current.notePassRevision('run-8', 4);
    });
    act(() => result.current.reconcile([row('run-9', 2), row('run-8', 4)], new Set(['run-9', 'run-8'])));
    expect([...result.current.selected]).toEqual(['run-8::pass1']);
  });

  it('a pass pick held in Cohort A is checked the same way', () => {
    const { result } = renderHook(() => useRunsSelection('pa'));
    act(() => {
      result.current.setMany(['run-9::pass2', 'run-1'], true);
      result.current.notePassRevision('run-9', 1);
    });
    act(() => result.current.lockCohortA());
    expect(result.current.cohortA).toEqual(['run-9::pass2', 'run-1']);
    act(() => result.current.reconcile([row('run-9', 3), row('run-1')], new Set(['run-9', 'run-1'])));
    expect(result.current.cohortA).toEqual(['run-1']);
  });

  it('Cohort A and the picks for Cohort B both survive a remount (opening a run and coming back)', () => {
    const first = renderHook(() => useRunsSelection('pa'));
    act(() => first.result.current.setMany(['run-001', 'run-002'], true));
    act(() => first.result.current.lockCohortA());
    act(() => first.result.current.toggle('run-004'));
    first.unmount();
    const back = renderHook(() => useRunsSelection('pa'));
    expect(back.result.current.cohortA).toEqual(['run-001', 'run-002']);
    expect([...back.result.current.selected]).toEqual(['run-004']);
  });

  it('Clear removes the stored selection', () => {
    const { result } = renderHook(() => useRunsSelection('pa'));
    act(() => result.current.toggle('run-001'));
    act(() => result.current.clear());
    expect(sessionStorage.getItem(selectionKey('pa'))).toBeNull();
  });
});
