import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/http';
import { _resetBootstrap } from '@/lib/runtime';
import { liveOverviewQueryOptions, liveTurnsCsvUrl, liveTurnsQuery, parseLiveFilters } from '../live';

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__QYM_APP__;
  _resetBootstrap();
});

describe('Live filters', () => {
  it('round-trips the plan example with repeated labels and numeric bounds', () => {
    const params = new URLSearchParams(
      'label=agent_problem&label=system_problem&min=0.5&metric=compliance_a',
    );
    const filters = parseLiveFilters(params);
    expect(filters).toMatchObject({
      labels: ['agent_problem', 'system_problem'],
      min: 0.5,
      metric: 'compliance_a',
    });
    expect(parseLiveFilters(liveTurnsQuery(filters))).toEqual(filters);
    expect([...liveTurnsQuery(filters)].sort()).toEqual([...params].sort());
  });

  it('preserves every supported filter, repeated selections, zero, and Unicode search', () => {
    const params = new URLSearchParams(
      'day=2026-11-01&from=2026-10-30&to=2026-11-01&label=ok&label=review' +
        '&status=completed&status=failed&outcome=success&outcome=error&mode=chat&mode=report' +
        '&metric=compliance_a&min=0&max=0.75&service=sql_generation&service_status=not_ok' +
        '&charts=failed&user=user%2F1&conversation=abc%2Fdef&q=مرحبا+%26+hello&sort=-metric:compliance_a&page=2&page_size=12',
    );
    const filters = parseLiveFilters(params);
    expect(filters).toMatchObject({
      statuses: ['completed', 'failed'],
      outcomes: ['success', 'error'],
      modes: ['chat', 'report'],
      min: 0,
      max: 0.75,
      page: 2,
      page_size: 12,
      q: 'مرحبا & hello',
    });
    expect([...liveTurnsQuery(filters)].sort()).toEqual([...params].sort());
  });

  it('omits absent and non-finite numbers instead of turning them into zero or NaN', () => {
    const filters = parseLiveFilters(new URLSearchParams('min=&max=NaN&page=Infinity&page_size=oops'));
    expect(filters.min).toBeUndefined();
    expect(filters.max).toBeUndefined();
    expect(filters.page).toBeUndefined();
    expect(filters.page_size).toBeUndefined();
    expect(liveTurnsQuery(filters).toString()).toBe('');
  });

  it('builds a source-scoped CSV link through the platform root path', () => {
    window.__QYM_APP__ = { rootPath: '/qym' };
    _resetBootstrap();
    const filters = parseLiveFilters(new URLSearchParams('label=ok&label=review&min=0&metric=quality'));
    const url = new URL(liveTurnsCsvUrl('a b', filters, 'worker:preprod'), 'https://example.test');
    expect(url.pathname).toBe('/qym/api/projects/a%20b/live/turns.csv');
    expect(url.searchParams.get('source')).toBe('worker:preprod');
    url.searchParams.delete('source');
    expect(parseLiveFilters(url.searchParams)).toEqual(filters);
  });
});

describe('Live overview query', () => {
  it('polls every minute only in the foreground and scopes its cache and request to the view', async () => {
    const options = liveOverviewQueryOptions('a b', {
      source: 'worker:preprod',
      day: '2026-11-01',
      trendDays: 7,
      daysPage: 2,
    });
    expect(options.refetchInterval).toBe(60_000);
    expect(options.refetchIntervalInBackground).toBe(false);
    expect(options.queryKey.slice(0, 3)).toEqual(['project', 'a b', 'live']);
    expect(options.queryKey).not.toEqual(liveOverviewQueryOptions('a b', { source: 'other' }).queryKey);
    const get = vi.spyOn(api, 'get').mockResolvedValue({});
    const client = new QueryClient();
    try {
      await client.fetchQuery(options);
      const url = new URL(get.mock.calls[0]![0], 'https://example.test');
      expect(url.pathname).toBe('/api/projects/a%20b/live/overview');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        source: 'worker:preprod',
        day: '2026-11-01',
        trend_days: '7',
        days_page: '2',
      });
    } finally {
      client.clear();
    }
  });
});
