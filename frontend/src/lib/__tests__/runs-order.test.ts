import { describe, expect, it } from 'vitest';
import {
  collatedColumn,
  collation,
  contextFromParams,
  normalizeContext,
  queryFromContext,
  runHref,
} from '@/lib/runs-order';

// Mirrors tests/platform/test_runs_order_js.py so the run page (legacy) and
// this list agree on the ?list= wire format.
describe('runs order context', () => {
  it('is the list view without its page', () => {
    expect(
      contextFromParams({ sort: 'model-asc', model: ['m-b', 'm-a'], range: 'week', q: '  run  1 ' }),
    ).toBe('range=week&model=m-b&model=m-a&q=run+1&sort=model-asc');
    expect(contextFromParams({ sort: 'time-desc', task: [], range: null, q: '' })).toBe('');
    expect(contextFromParams({ range: 'custom', from: '2026-01-01', to: '2026-01-31', owner: ['u1'] })).toBe(
      'range=custom&from=2026-01-01&to=2026-01-31&owner=u1',
    );
  });
  it('keeps only the list view when read back from a URL', () => {
    expect(normalizeContext('page=4&sort=run-asc&item=x&task=a&task=b&evil=1')).toBe(
      'task=a&task=b&sort=run-asc',
    );
    expect(normalizeContext(null)).toBe('');
    expect(normalizeContext('sort=time-desc')).toBe('');
    expect(runHref('/projects/pa/runs/r1', 'page=2')).toBe('/projects/pa/runs/r1');
    expect(runHref('/projects/pa/runs/r1', 'status=FAILED&sort=model-asc')).toBe(
      '/projects/pa/runs/r1?list=status%3DFAILED%26sort%3Dmodel-asc',
    );
  });
  it('sends the filters and sort the list sends', () => {
    const now = new Date(2026, 9, 2, 15, 30);
    const first = queryFromContext(
      'model=m-a&model=m-b|||reasoning&model=__none__&model=m-a&task=t&status=FAILED&owner=u1&version=main/abc&dataset=d1&q=%20Run%20%201&sort=model-asc',
      now,
    );
    expect(first).toEqual({
      filters: {
        tasks: ['t'],
        models: ['m-a|||plain', 'm-a|||reasoning', 'm-b|||reasoning', '__none__'],
        datasets: ['d1'],
        statuses: ['FAILED'],
        versions: ['main/abc'],
        users: ['u1'],
        q: 'Run 1',
      },
      sort: 'model-asc',
    });
    const today = queryFromContext('range=today', now);
    const start = new Date(2026, 9, 2, 0, 0, 0, 0);
    expect(today.filters.since).toBe(start.toISOString());
    expect(today.filters.until).toBe(new Date(2026, 9, 3, 0, 0, 0, 0).toISOString());
    const week = queryFromContext('range=week&sort=bad sort', now);
    expect(week.filters.since).toBe(new Date(2026, 8, 25, 15, 30).toISOString());
    expect(week.filters.until).toBeUndefined();
    expect(week.sort).toBe('time-desc');
    const fromOnly = queryFromContext('range=custom&from=2026-09-01', now);
    expect(fromOnly.filters.since).toBe(new Date(2026, 8, 1).toISOString());
    expect(fromOnly.filters.until).toBeUndefined();
    const toOnly = queryFromContext('range=custom&to=2026-09-30', now);
    expect(toOnly.filters.until).toBe(new Date(2026, 9, 1).toISOString());
    expect(toOnly.filters.since).toBeUndefined();
    expect(queryFromContext('', now)).toEqual({
      filters: { tasks: [], models: [], datasets: [], statuses: [], versions: [], users: [] },
      sort: 'time-desc',
    });
  });
  it('carries the origin toggle', () => {
    expect(contextFromParams({ origin: 'official', task: ['t'], sort: 'run-asc' })).toBe(
      'task=t&origin=official&sort=run-asc',
    );
    expect(normalizeContext('origin=local&origin=official&page=2')).toBe('origin=local');
    expect(queryFromContext('origin=official').filters.origins).toEqual(['official']);
    expect(queryFromContext('origin=all').filters.origins).toBeUndefined();
  });
  it('collates text sorts like the list', () => {
    expect(
      collation('model-asc', [
        'qwen/zeta|||plain',
        'alpha|||reasoning',
        'openai/alpha|||plain',
        'Beta|||plain',
      ]),
    ).toEqual(['openai/alpha|||plain', 'alpha|||reasoning', 'Beta|||plain', 'qwen/zeta|||plain']);
    expect(collation('dataset-desc', ['b', 'A', 'a', 'c'])).toEqual(['a', 'A', 'b', 'c']);
    expect(collation('owner-asc', ['Zed', 'amy'])).toEqual(['amy', 'Zed']);
    expect(collation('time-desc', ['x'])).toBeNull();
    expect(collation('metric-accuracy-asc', ['x'])).toBeNull();
    expect(collatedColumn('version-asc')).toBe('git_commits');
    expect(collatedColumn('constructor-asc')).toBeNull();
  });
  it('collates ties the same whatever their order', () => {
    const models = ['openai/gpt-4o|||plain', 'azure/gpt-4o|||plain', 'acme/alpha|||plain'];
    const sorted = ['acme/alpha|||plain', 'azure/gpt-4o|||plain', 'openai/gpt-4o|||plain'];
    expect(collation('model-asc', models)).toEqual(sorted);
    expect(collation('model-desc', [...models].reverse())).toEqual(sorted);
  });
});
