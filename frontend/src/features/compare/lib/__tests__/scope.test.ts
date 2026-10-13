import { describe, expect, it } from 'vitest';
import { buildCompareModel } from '../model';
import { emptyGroup, emptyView, fieldDefsFor, type CompareView } from '../filters';
import { categoryIsOn, compareScope, sweepScopeActive, toggleCategory } from '../scope';
import { makePayload } from './fixtures';

const payload = makePayload([
  { id: 'a', scores: { i1: { correct: 1, quality: 0.9 }, i2: { correct: 0, quality: 0.2 } } },
  { id: 'b', scores: { i1: { correct: 1, quality: 0.8 }, i2: { correct: 1, quality: 0.9 } } },
]);
const model = buildCompareModel(payload, ['a', 'b']);
const defs = fieldDefsFor(model, model.defaultMetric);
const label = (k: string) => k;
const view = (patch: Partial<CompareView> = {}): CompareView => ({ ...emptyView(), ...patch });

describe('compare scope (what counts as items chosen)', () => {
  it('is inactive for the plain view, metric, sort, baseline and thresholds', () => {
    const v = view({
      metric: 'correct',
      sort: 'score_asc',
      baseline: 'b',
      thresholds: { quality: 0.5 },
      page: 3,
    });
    expect(compareScope(v, model, defs, label).active).toBe(false);
  });

  it('counts show, winner, search, rules, baseline count buttons and categories', () => {
    expect(compareScope(view({ show: 'different' }), model, defs, label).active).toBe(true);
    expect(compareScope(view({ winner: 'win_0' }), model, defs, label).active).toBe(true);
    const q = compareScope(view({ q: ' needle ' }), model, defs, label);
    expect(q.active).toBe(true);
    expect(q.chips.map((c) => c.key)).toEqual(['q']);
    const f = emptyView().filters;
    const withBaseline = view({
      filters: { ...f, baseline: { metric: 'quality', columnKey: 'b', baselineKey: 'a', kind: 'improved' } },
    });
    expect(compareScope(withBaseline, model, defs, label).chips[0]!.key).toBe('baseline');
    const cat = view({ filters: toggleCategory(f, 'topic', 'x') });
    expect(compareScope(cat, model, defs, label).active).toBe(true);
  });

  it('chips clear back to an inactive scope', () => {
    const v = view({ show: 'errors', q: 'x' });
    const s = compareScope(v, model, defs, label);
    let next = v;
    for (const chip of s.chips) next = { ...next, ...chip.clear(next) };
    expect(compareScope(next, model, defs, label).active).toBe(false);
  });

  it('an empty rule group is not a scope', () => {
    const f = emptyView().filters;
    expect(compareScope(view({ filters: { ...f, rules: emptyGroup() } }), model, defs, label).active).toBe(
      false,
    );
  });
});

describe('category toggles', () => {
  it('selects one value, toggles it off and routes complexity / domain', () => {
    const f = emptyView().filters;
    const on = toggleCategory(f, 'domain', 'fin');
    expect(on.domain).toEqual(['fin']);
    expect(categoryIsOn(on, 'domain', 'fin')).toBe(true);
    expect(toggleCategory(on, 'domain', 'fin').domain).toBeNull();
    expect(toggleCategory(f, 'complexity', 'easy').complexity).toEqual(['easy']);
    expect(toggleCategory(toggleCategory(f, 'topic', 'a'), 'topic', 'a').categories).toEqual({});
  });
});

describe('sweep scope', () => {
  it('any sweep filter param is a scope; reverse alone is not', () => {
    expect(sweepScopeActive(new URLSearchParams('sweepReverse=1'))).toBe(false);
    for (const p of [
      'sweepMove=improved',
      'sweepOutcome=both_fail',
      'sweepQ=a',
      'sweepKey=domain',
      'sweepValues=x',
    ])
      expect(sweepScopeActive(new URLSearchParams(p))).toBe(true);
  });
});
