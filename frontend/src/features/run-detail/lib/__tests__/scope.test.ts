import { describe, expect, it } from 'vitest';
import { emptyView } from '../filterRules';
import {
  categoryTogglePatch,
  errorTogglePatch,
  isScopeActive,
  scopeChips,
  selectedCategoryValues,
} from '../scopeFilters';

describe('what counts as a scope', () => {
  it('is inactive for a pristine view and for pure view settings', () => {
    expect(isScopeActive(emptyView(), [], 'q')).toBe(false);
    const view = {
      ...emptyView(),
      sort: 'score_asc' as const,
      page: 3,
      threshold: 0.5,
      metric: 'q',
      view: 'heatmap' as const,
      hideFields: ['a'],
    };
    expect(isScopeActive(view, [], 'q')).toBe(false);
  });

  it('is active for search text, show, score, latency, category and error filters', () => {
    const base = emptyView();
    expect(isScopeActive({ ...base, q: 'abc' }, [], 'q')).toBe(true);
    expect(isScopeActive({ ...base, q: '   ' }, [], 'q')).toBe(false);
    expect(isScopeActive({ ...base, show: 'failed' }, [], 'q')).toBe(true);
    expect(
      isScopeActive({ ...base, filters: { ...base.filters, score: { min: 0, max: 0.2 } } }, [], 'q'),
    ).toBe(true);
    expect(
      isScopeActive({ ...base, filters: { ...base.filters, latency: { min: 1, max: 2 } } }, [], 'q'),
    ).toBe(true);
    expect(isScopeActive({ ...base, filters: { ...base.filters, categories: { k: ['v'] } } }, [], 'q')).toBe(
      true,
    );
    expect(
      isScopeActive(
        { ...base, filters: { ...base.filters, errors: { task: { kind: 'Task error', label: 'x' } } } },
        [],
        'q',
      ),
    ).toBe(true);
  });

  it('clears the search chip', () => {
    const chips = scopeChips({ ...emptyView(), q: 'hello' }, [], 'q');
    expect(chips.map((c) => c.key)).toEqual(['q']);
    expect(chips[0]!.clear({ ...emptyView(), q: 'hello' }).q).toBe('');
  });
});

describe('quick-filter toggles', () => {
  it('selects one category value and clears it on a second press', () => {
    const f = emptyView().filters;
    const on = { ...f, ...categoryTogglePatch(f, 'topic', 'x') };
    expect(selectedCategoryValues(on, 'topic')).toEqual(['x']);
    const off = { ...on, ...categoryTogglePatch(on, 'topic', 'X') };
    expect(selectedCategoryValues(off, 'topic')).toEqual([]);
    expect(categoryTogglePatch(f, 'domain', 'fin')).toMatchObject({ domain: ['fin'], domainMode: 'include' });
    expect(categoryTogglePatch(f, 'complexity', 'easy')).toEqual({ complexity: ['easy'] });
  });

  it('toggles an error bucket in its slot', () => {
    const f = emptyView().filters;
    const bucket = { kind: 'Task error' as const, label: 'boom' };
    const on = { ...f, ...errorTogglePatch(f, bucket) };
    expect(on.errors.task?.label).toBe('boom');
    const off = { ...on, ...errorTogglePatch(on, bucket) };
    expect(off.errors.task).toBeUndefined();
  });
});
