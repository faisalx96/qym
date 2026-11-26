import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { _resetBootstrap } from '@/lib/runtime';
import { downloadPerformanceFile, performanceKeys, performanceLogQueryOptions } from '../performance';
import {
  isPlatformTarget,
  mixedPerformanceHomeQueryOptions,
  mixedPerformanceRunQueryOptions,
  mixedPerformanceRunsQueryOptions,
  mixedPerformanceSetupQueryOptions,
  mixedPerformanceTargetsQueryOptions,
  platformCanonicalId,
  platformDashboardsQueryOptions,
  platformDiscoveryQueryOptions,
  platformPerformanceKeys,
  platformStepsCsvUrl,
  platformStepsQueryOptions,
  useHandOffPlatformSessionCookie,
  useMixedPerformanceRun,
  useSavePlatformSessionCookie,
} from '../performancePlatform';

const clients: QueryClient[] = [];
function client() {
  const result = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(result);
  return result;
}
function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
afterEach(() => {
  clients.splice(0).forEach((entry) => entry.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetBootstrap();
});

describe('platform read representation', () => {
  it('sends the opt-in on mixed, platform, and shared log reads', async () => {
    const fetcher = vi.fn(async () => response({}));
    vi.stubGlobal('fetch', fetcher);
    const queryClient = client();
    await queryClient.fetchQuery(mixedPerformanceHomeQueryOptions('a/b'));
    await queryClient.fetchQuery(mixedPerformanceSetupQueryOptions('a/b'));
    await queryClient.fetchQuery(mixedPerformanceTargetsQueryOptions('a/b'));
    await queryClient.fetchQuery(
      mixedPerformanceRunsQueryOptions('a/b', { target_kind: 'estishraf_platform' }),
    );
    await queryClient.fetchQuery(mixedPerformanceRunQueryOptions('a/b', 'r/1'));
    await queryClient.fetchQuery(platformDiscoveryQueryOptions('a/b', 'r/1'));
    await queryClient.fetchQuery(platformDashboardsQueryOptions('a/b', 'r/1'));
    await queryClient.fetchQuery(platformStepsQueryOptions('a/b', 'r/1'));
    await queryClient.fetchQuery(performanceLogQueryOptions('a/b', 'r/1'));
    expect(fetcher).toHaveBeenCalledTimes(9);
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(new Headers(call[1]?.headers).get('X-Qym-Performance-Platform')).toBe('1');
      expect(String(call[0])).toContain('/api/projects/a%2Fb/performance');
    }
    expect(String(vi.mocked(fetch).mock.calls[3]![0])).toContain('target_kind=estishraf_platform');
  });
  it('keeps chat and mixed caches distinct and accepts absent kind as chat', () => {
    expect(platformPerformanceKeys.home('p')).not.toEqual(performanceKeys.home('p'));
    expect(isPlatformTarget({ id: 'legacy' })).toBe(false);
    expect(isPlatformTarget({ kind: 'estishraf_platform' })).toBe(true);
  });
  it('keeps numeric, string, and canonical object dashboard filters distinct', async () => {
    const fetcher = vi.fn(async () => response({ rows: [] }));
    vi.stubGlobal('fetch', fetcher);
    const filters = {
      dashboard: [1, '1', { z: [2, { b: 1, a: 2 }], a: 'x' }],
      after_seq: 0,
      has_errors: false,
    };
    await client().fetchQuery(platformStepsQueryOptions('p', 'r', filters));
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]), 'https://example.test');
    expect(url.searchParams.getAll('dashboard')).toEqual(
      expect.arrayContaining(['1', '"1"', '{"a":"x","z":[2,{"a":2,"b":1}]}']),
    );
    expect(url.searchParams.get('after_seq')).toBe('0');
    expect(url.searchParams.get('has_errors')).toBe('false');
    expect(url.searchParams.get('sort')).toBe('seq');
    expect(platformCanonicalId({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(platformPerformanceKeys.steps('p', 'r', { level: [2, 1] })).toEqual(
      platformPerformanceKeys.steps('p', 'r', { level: [1, 2] }),
    );
  });
  it('exports every matching CSV row without page limits and keeps the narrowing filters', () => {
    const url = new URL(
      platformStepsCsvUrl('p', 'r', {
        page: 4,
        page_size: 5,
        type: ['error'],
        dashboard: ['1'],
        has_errors: false,
      }),
      'https://example.test',
    );
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('page_size')).toBe(false);
    expect(url.searchParams.get('dashboard')).toBe('"1"');
    expect(url.searchParams.get('type')).toBe('error');
    expect(url.searchParams.get('has_errors')).toBe('false');
  });
  it('downloads a blob with the opt-in header and server attachment filename', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('csv', {
            headers: { 'Content-Disposition': 'attachment; filename="performance-run-1-steps.csv"' },
          }),
      ),
    );
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('performance-run-1-steps.csv');
    });
    await downloadPerformanceFile('/api/projects/p/performance/runs/r/steps.csv');
    expect(new Headers(vi.mocked(fetch).mock.calls[0]![1]?.headers).get('X-Qym-Performance-Platform')).toBe(
      '1',
    );
    expect(click).toHaveBeenCalledOnce();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:test'));
  });
});

describe('session cookie mutation memory', () => {
  it.each([200, 422])('scrubs saved cookie mutation variables after status %s', async (status) => {
    const secret = 'session=fictional-private; refresh=fictional-private';
    const fetcher = vi.fn(async () =>
      response(
        status === 200
          ? { name: 'session_cookie', version: 1 }
          : { detail: 'Paste the whole Cookie header value as name=value pairs.' },
        status,
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const queryClient = client();
    const { result } = renderHook(() => useSavePlatformSessionCookie('p'), { wrapper: wrapper(queryClient) });
    await act(async () => {
      await result.current
        .mutateAsync({ targetId: 't/1', body: { token: secret, expires_at: null } })
        .catch(() => undefined);
    });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain('/targets/t%2F1/tokens/session_cookie');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)).token).toBe(secret);
    await waitFor(() => expect(result.current.variables?.body.token).toBe(''));
    expect(
      JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((entry) => entry.state),
      ),
    ).not.toContain(secret);
  });
  it('uses session_cookie for handoff and removes it from held mutation variables', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ name: 'session_cookie', hint: '1 cookies, saved now', version: 2 })),
    );
    const { result } = renderHook(() => useHandOffPlatformSessionCookie('p', 'r'), {
      wrapper: wrapper(client()),
    });
    await act(async () => {
      await result.current.mutateAsync({
        name: 'session_cookie',
        token: 'session=fictional-secret',
        expires_at: null,
      });
    });
    await waitFor(() =>
      expect(result.current.variables).toEqual({ name: 'session_cookie', token: '', expires_at: null }),
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)).name).toBe('session_cookie');
  });
});

it('refreshes platform detail pages when late steps arrive after a run ends', async () => {
  const run = {
    run: { target_kind: 'estishraf_platform' },
    effective_status: 'finished',
    server_time: '2026-11-25T16:00:00Z',
    late_results_until: null,
    progress: null,
    summary: null,
    report: null,
    discovery: null,
    counts: { steps_received: 1, steps_stored: 1 },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response(run)),
  );
  const queryClient = client();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const { result } = renderHook(() => useMixedPerformanceRun('p', 'r'), { wrapper: wrapper(queryClient) });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  await act(async () => {
    queryClient.setQueryData(platformPerformanceKeys.run('p', 'r'), {
      ...run,
      counts: { steps_received: 2, steps_stored: 2 },
    });
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
  expect(invalidate.mock.calls.at(-1)![0]?.queryKey).toEqual(performanceKeys.all('p'));
});

it.each(['save', 'handoff'] as const)(
  'scrubs an echoed cookie from %s errors while mounted',
  async (kind) => {
    const secret = 'session=fictional-echo-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          {
            detail: secret,
            error: { code: 'session_cookie_invalid', message: secret, details: { input: secret } },
          },
          422,
        ),
      ),
    );
    const queryClient = client();
    const { result } = renderHook(
      () => ({
        save: useSavePlatformSessionCookie('p'),
        handoff: useHandOffPlatformSessionCookie('p', 'r'),
      }),
      { wrapper: wrapper(queryClient) },
    );
    await act(async () => {
      await (
        kind === 'save'
          ? result.current.save.mutateAsync({ targetId: 't', body: { token: secret, expires_at: null } })
          : result.current.handoff.mutateAsync({ name: 'session_cookie', token: secret, expires_at: null })
      ).catch(() => undefined);
    });
    await waitFor(() => expect(result.current[kind].isError).toBe(true));
    expect(result.current[kind].error).toMatchObject({ status: 422, code: 'session_cookie_invalid' });
    expect(result.current[kind].error?.message).not.toContain(secret);
    expect(
      JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((entry) => entry.state),
      ),
    ).not.toContain(secret);
  },
);

it('retains the legacy run prefix for mixed run and detail invalidation', () => {
  const prefix = performanceKeys.run('p', 'r');
  for (const key of [platformPerformanceKeys.run('p', 'r'), platformPerformanceKeys.steps('p', 'r', {})]) {
    expect(key.slice(0, prefix.length)).toEqual(prefix);
    expect(key[prefix.length]).toBe('platform');
  }
});
