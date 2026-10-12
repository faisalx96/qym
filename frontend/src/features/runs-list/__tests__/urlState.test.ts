import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  contextForView,
  countActiveFilters,
  defaultDirection,
  filterSummary,
  modelUrlValues,
  parseSort,
  parseView,
  viewToFilters,
  viewToParams,
} from '../urlState';

describe('runs view ⇄ URL', () => {
  it('round-trips the legacy contract', () => {
    const url =
      'task=a&task=b&model=gpt-4o&status=COMPLETED&sort=model-asc&page=2&range=custom&from=2026-01-01&origin=local&q=hello';
    const view = parseView(new URLSearchParams(url));
    expect(view.tasks).toEqual(['a', 'b']);
    expect(view.models).toEqual(['gpt-4o|||plain', 'gpt-4o|||reasoning']);
    expect(view.statuses).toEqual(['COMPLETED']);
    expect(view.sort).toBe('model-asc');
    expect(view.page).toBe(2);
    expect(view.range).toBe('custom');
    expect(view.from).toBe('2026-01-01');
    expect(view.to).toBe('');
    expect(view.origin).toBe('local');
    expect(view.q).toBe('hello');
    expect(viewToParams(view).toString()).toBe(
      'range=custom&from=2026-01-01&task=a&task=b&model=gpt-4o&status=COMPLETED&origin=local&q=hello&sort=model-asc&page=2',
    );
  });
  it('writes nothing for the default view', () => {
    expect(viewToParams(DEFAULT_VIEW).toString()).toBe('');
    expect(countActiveFilters(DEFAULT_VIEW)).toBe(0);
  });
  it('encodes versioning filters as v.<key>', () => {
    const view = parseView(
      new URLSearchParams('v.prompt_version=p1&v.prompt_version=p2&v.model_tag=__empty__'),
    );
    expect(view.versioning).toEqual({ prompt_version: ['p1', 'p2'], model_tag: ['__empty__'] });
    expect(viewToParams(view).toString()).toBe(
      'v.model_tag=__empty__&v.prompt_version=p1&v.prompt_version=p2',
    );
    expect(viewToFilters(view).versioning).toEqual({
      prompt_version: ['p1', 'p2'],
      model_tag: ['__empty__'],
    });
    expect(countActiveFilters(view)).toBe(2);
    // The legacy run-page context ignores versioning (OPEN_QUESTIONS §9.1).
    expect(contextForView(view)).toBe('');
  });
  it('collapses model variants only when both are selected', () => {
    expect(modelUrlValues(['m|||plain', 'm|||reasoning', 'n|||plain', '__none__'])).toEqual([
      'm',
      'n|||plain',
      '__none__',
    ]);
  });
  it('ignores a custom range without dates and invalid values', () => {
    const view = parseView(new URLSearchParams('range=custom&sort=nonsense&page=0&origin=verified'));
    expect(view.range).toBe('all');
    expect(view.sort).toBe('time-desc');
    expect(view.page).toBe(1);
    expect(view.origin).toBe('all');
  });
  it('builds the status-bar sentence', () => {
    const view = parseView(new URLSearchParams('task=rag-qa&status=COMPLETED&range=week&q=x'));
    expect(filterSummary(view, { total: 43, filtered: 8 })).toBe(
      '8 of 43 runs — task: rag-qa, status: Completed, search: "x", last 7d',
    );
    expect(filterSummary(DEFAULT_VIEW, { total: 43, filtered: 43 })).toBe('43 runs');
  });
  it('parses metric sort keys containing dashes', () => {
    expect(parseSort('metric-exact-match-desc')).toEqual({ field: 'metric-exact-match', direction: 'desc' });
    expect(defaultDirection('model')).toBe('asc');
    expect(defaultDirection('metric-x')).toBe('desc');
    expect(defaultDirection('time')).toBe('desc');
  });
  it('produces the run-page context from the view', () => {
    const view = parseView(new URLSearchParams('status=FAILED&sort=model-asc&page=3'));
    expect(contextForView(view)).toBe('status=FAILED&sort=model-asc');
  });
});
