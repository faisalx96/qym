import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunPass } from '@/api/dashboardTypes';
import { passRowsView } from '../PassesPanel';
import { cohortGuidance } from '../SelectionBar';
import { expandComparisonRefs, passRef, refsExclusive, useRunsSelection } from '../selection';

beforeEach(() => sessionStorage.clear());

describe('pass and run picks are exclusive', () => {
  it('ticking a pass drops its whole run, ticking the run drops its passes, other runs stay', () => {
    const { result } = renderHook(() => useRunsSelection('p'));
    act(() => result.current.setMany(['r1', 'r2'], true));
    act(() => result.current.toggle(passRef('r1', 1)));
    expect([...result.current.selected]).toEqual(['r2', 'r1::pass1']);
    act(() => result.current.toggle(passRef('r1', 2)));
    expect([...result.current.selected]).toEqual(['r2', 'r1::pass1', 'r1::pass2']);
    act(() => result.current.toggle('r1'));
    expect([...result.current.selected]).toEqual(['r2', 'r1']);
  });

  it('setMany on selects passes of a run without keeping the run, and off clears them', () => {
    const { result } = renderHook(() => useRunsSelection('p'));
    act(() => result.current.setMany(['r1'], true));
    act(() => result.current.setMany([passRef('r1', 1), passRef('r1', 2)], true));
    expect([...result.current.selected]).toEqual(['r1::pass1', 'r1::pass2']);
    act(() => result.current.setMany(['r1'], false));
    expect([...result.current.selected]).toEqual([]);
  });

  it('two passes of one run do not exclude each other', () => {
    expect(refsExclusive('r1::pass1', 'r1::pass2')).toBe(false);
    expect(refsExclusive('r1', 'r1::pass2')).toBe(true);
    expect(refsExclusive('r1', 'r2::pass2')).toBe(false);
  });

  it('dropPassPicks clears the pass picks of that run only', () => {
    const { result } = renderHook(() => useRunsSelection('p'));
    act(() => result.current.setMany([passRef('r1', 1), passRef('r2', 1), 'r3'], true));
    act(() => result.current.dropPassPicks('r1'));
    expect([...result.current.selected]).toEqual(['r2::pass1', 'r3']);
  });
});

describe('compare refs', () => {
  it('are de-duplicated when a pass and its run were both picked', () => {
    const refs = expandComparisonRefs(['r1::pass1', 'r1'], () => 3);
    expect(refs).toEqual(['r1::pass1', 'r1::pass2', 'r1::pass3']);
  });
});

describe('cohort guidance', () => {
  it('counts what is missing or extra and flags overlap', () => {
    expect(cohortGuidance(3, 1, false)).toEqual({ text: 'Select 2 more', valid: false });
    expect(cohortGuidance(3, 5, false)).toEqual({ text: 'Remove 2', valid: false });
    expect(cohortGuidance(2, 2, true).valid).toBe(false);
    expect(cohortGuidance(2, 2, false)).toEqual({ text: 'Balanced: 2 vs 2', valid: true });
  });
});

const pass = (n: number, status: string) => ({ pass_number: n, status }) as RunPass;

describe('passRowsView', () => {
  it('collapses waiting passes into one row and marks them not run once the run ended', () => {
    const live = passRowsView([pass(1, 'completed'), pass(2, 'pending'), pass(3, 'pending')], 3, 'RUNNING');
    expect(live.rows.map((r) => r.kind)).toEqual(['pass', 'queued']);
    expect(live.rows[1]).toMatchObject({ first: 2, last: 3, count: 2, notRun: false });
    const dead = passRowsView([pass(1, 'completed')], 3, 'STOPPED');
    expect(dead.rows[1]).toMatchObject({ first: 2, last: 3, count: 2, notRun: true });
  });

  it('shows a stale RUNNING pass as the run terminal status', () => {
    const v = passRowsView([pass(1, 'running')], 1, 'FAILED');
    expect(v.rows[0]).toMatchObject({ kind: 'pass', status: 'failed' });
    expect(passRowsView([pass(1, 'running')], 1, 'RUNNING').rows[0]).toMatchObject({ status: 'running' });
  });
});
