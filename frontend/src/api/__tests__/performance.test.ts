import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/http';
import { _resetBootstrap } from '@/lib/runtime';
import {
  PERFORMANCE_ACTIVE_STATUSES,
  isPerformanceRunActive,
  isPerformanceSwitchedOff,
  performanceApiPath,
  performanceDatasetTiersQueryOptions,
  performanceDatasetsQueryOptions,
  performanceDownloadUrl,
  performanceError,
  performanceHomeQueryOptions,
  performanceKeys,
  performanceLogQueryOptions,
  performanceLogTextUrl,
  performanceQuestionsCsvUrl,
  performanceQuestionsQueryOptions,
  performanceReportUrl,
  performanceRunEventsQueryOptions,
  performanceRunQueryOptions,
  performanceRunsQueryOptions,
  performanceSetupQueryOptions,
  performanceTargetsQueryOptions,
  useArchivePerformanceTarget,
  useDeletePerformanceTargetToken,
  useHandOffPerformanceToken,
  usePerformanceDatasets,
  usePerformanceHome,
  usePerformanceQuestions,
  usePerformanceRun,
  usePerformanceRunEvents,
  usePerformanceRuns,
  usePerformanceTargets,
  useRestorePerformanceTarget,
  useSavePerformanceTarget,
  useSavePerformanceTargetToken,
  useStartPerformanceRun,
  useStopPerformanceRun,
  type PerformanceActiveRun,
  type PerformanceDataset,
  type PerformancePlanLimits,
  type PerformanceReadError,
  type PerformanceQuestionFilters,
  type PerformanceRunRead,
  type PerformanceRunStatus,
  type RestoreTargetError,
  type SaveTargetError,
  type SaveTargetTokenError,
  type SetRunnerKeyError,
  type SaveTargetRequest,
  type StartRunError,
  type StartRunRequest,
  type StopRunError,
  type TokenHandoffError,
} from '../performance';
import {
  performanceRunnerEventsQueryOptions,
  performanceRunnerQueryOptions,
  useSetPerformanceRunnerKey,
} from '../performanceRunner';

const B = '/api/projects/demo/performance';
const ENDED: PerformanceRunStatus[] = ['finished', 'stopped', 'failed', 'interrupted', 'expired'];

interface Call {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
}

const clients: QueryClient[] = [];

function newClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return client;
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

/** Replaces fetch; `answer` returns the body (or a whole Response) for each request. Returns the requests made. */
function stubFetch(answer: (call: Call) => unknown = () => ({})): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const call: Call = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        search: url.searchParams,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const result = answer(call);
      return result instanceof Response ? result : json(result);
    }),
  );
  return calls;
}

const reads = (calls: Call[], path: string) => calls.filter((c) => c.method === 'GET' && c.path === path);

/** Waits until the newest client has no request out. (A hook result is not asked: it only follows the fields already read.) */
const idle = () => waitFor(() => expect(clients.at(-1)!.isFetching()).toBe(0));

/** The interval a query would use with `data` in the cache. */
function intervalWith(
  options: { queryKey: readonly unknown[]; refetchInterval?: unknown },
  data: unknown,
): unknown {
  const client = newClient();
  const query = client.getQueryCache().build(client, { queryKey: options.queryKey });
  if (data !== undefined) client.setQueryData(options.queryKey, data);
  return typeof options.refetchInterval === 'function'
    ? (options.refetchInterval as (query: unknown) => unknown)(query)
    : options.refetchInterval;
}

/** What a query shows while its request is out, given the previous query's key and data. */
function placeholderFrom(options: { placeholderData?: unknown }, previousKey: readonly unknown[]): unknown {
  return (options.placeholderData as (data: unknown, query: unknown) => unknown)('previous rows', {
    queryKey: previousKey,
  });
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__QYM_APP__;
  _resetBootstrap();
});

describe('Performance request paths', () => {
  it('repeats arrays, keeps zero and false, and leaves out what is absent or empty', () => {
    const url = new URL(
      performanceApiPath('a b', '/runs/r 1/questions', {
        status: ['ok', 'error'],
        level: [10, 20],
        after_seq: 0,
        followup: false,
        no_data: true,
        q: '',
        sort: undefined,
        page: null,
        tier: [],
      }),
      'http://localhost',
    );
    expect(url.pathname).toBe('/api/projects/a%20b/performance/runs/r%201/questions');
    expect([...url.searchParams]).toEqual([
      ['status', 'ok'],
      ['status', 'error'],
      ['level', '10'],
      ['level', '20'],
      ['after_seq', '0'],
      ['followup', 'false'],
      ['no_data', 'true'],
    ]);
    expect(performanceApiPath('demo')).toBe(B);
  });

  it('builds the file links through the platform root path, without the page or the live tail', () => {
    window.__QYM_APP__ = { rootPath: '/qym' };
    _resetBootstrap();
    const csv = new URL(
      performanceQuestionsCsvUrl('demo', 'run/1', {
        status: ['error'],
        tier: ['complex'],
        q: 'مرحبا',
        page: 3,
        page_size: 50,
        after_seq: 120,
      }),
      'https://example.test',
    );
    expect(csv.pathname).toBe('/qym/api/projects/demo/performance/runs/run%2F1/questions.csv');
    expect(Object.fromEntries(csv.searchParams)).toEqual({ status: 'error', tier: 'complex', q: 'مرحبا' });
    expect(performanceLogTextUrl('demo', 'r1')).toBe('/qym/api/projects/demo/performance/runs/r1/log.txt');
    expect(performanceReportUrl('demo', 'r1')).toBe('/qym/api/projects/demo/performance/runs/r1/report');
  });

  it('puts a path the API gave behind the platform root path, for a download link', () => {
    // `report.url` as the API sends it: without the root prefix.
    const url = '/api/projects/demo/performance/runs/r1/report';
    expect(performanceDownloadUrl(url)).toBe(url);
    window.__QYM_APP__ = { rootPath: '/qym' };
    _resetBootstrap();
    expect(performanceDownloadUrl(url)).toBe(`/qym${url}`);
    expect(performanceDownloadUrl(url)).toBe(performanceReportUrl('demo', 'r1'));
    expect(performanceDownloadUrl('https://files.example.test/report.html')).toBe(
      'https://files.example.test/report.html',
    );
  });

  it('keeps every key under the area key, and a run’s rows under the run key', () => {
    const all = performanceKeys.all('demo');
    const run = performanceKeys.run('demo', 'r1');
    for (const key of [
      performanceKeys.home('demo'),
      performanceKeys.runs('demo', { page: 2 }),
      performanceKeys.setup('demo'),
      performanceKeys.datasets('demo'),
      performanceKeys.datasetTiers('demo', 'v1'),
      run,
      performanceKeys.targets('demo'),
      performanceKeys.runner('demo'),
      performanceKeys.runnerEvents('demo'),
    ])
      expect(key.slice(0, all.length)).toEqual([...all]);
    for (const key of [
      performanceKeys.runQuestions('demo', 'r1'),
      performanceKeys.runLog('demo', 'r1'),
      performanceKeys.runEvents('demo', 'r1'),
    ])
      expect(key.slice(0, run.length)).toEqual([...run]);
    expect(performanceKeys.runnerEvents('demo').slice(0, 4)).toEqual([...performanceKeys.runner('demo')]);
    expect(performanceKeys.runs('demo')).not.toEqual(performanceKeys.runs('other'));
  });

  it('gives one request one key: empty filters are dropped and lists are put in one order', () => {
    const none = performanceKeys.runQuestions('demo', 'r1');
    expect(none[6]).toStrictEqual({});
    for (const filters of [{ q: '' }, { status: [] }, { q: undefined, tier: [], sort: undefined }])
      expect(performanceKeys.runQuestions('demo', 'r1', filters)).toStrictEqual(none);
    expect(performanceKeys.runLog('demo', 'r1', { q: '', level: [] })).toStrictEqual(
      performanceKeys.runLog('demo', 'r1'),
    );
    expect(performanceKeys.runnerEvents('demo', { level: [] })).toStrictEqual(
      performanceKeys.runnerEvents('demo'),
    );
    const given: PerformanceRunStatus[] = ['stopped', 'finished'];
    expect(performanceKeys.runs('demo', { status: given, target: '' })).toStrictEqual(
      performanceKeys.runs('demo', { status: ['finished', 'stopped'] }),
    );
    expect(given).toEqual(['stopped', 'finished']);
    expect(performanceKeys.runQuestions('demo', 'r1', { level: [20, 5, 100] })[6]).toStrictEqual({
      level: [5, 20, 100],
    });
    // What does differ stays apart: zero and false are values; each page and each step of the tail is its own entry.
    expect(performanceKeys.runQuestions('demo', 'r1', { after_seq: 0 })[6]).toStrictEqual({ after_seq: 0 });
    expect(performanceKeys.runQuestions('demo', 'r1', { followup: false })[6]).toStrictEqual({
      followup: false,
    });
    expect(performanceKeys.runQuestions('demo', 'r1', { after_seq: 50 })).not.toEqual(
      performanceKeys.runQuestions('demo', 'r1', { after_seq: 100 }),
    );
    expect(performanceKeys.runs('demo', { page: 1 })).not.toEqual(performanceKeys.runs('demo', { page: 2 }));
  });

  it('does not ask again when a cleared search box leaves the same request', async () => {
    const calls = stubFetch(() => ({ rows: [] }));
    const { result, rerender } = renderHook(
      ({ filters }: { filters: PerformanceQuestionFilters }) =>
        usePerformanceQuestions('demo', 'r1', filters),
      { wrapper: wrapperFor(newClient()), initialProps: { filters: {} } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ filters: { q: '', status: [], tier: ['simple', 'complex'] } });
    await waitFor(() => expect(calls).toHaveLength(2));
    rerender({ filters: { tier: ['complex', 'simple'], q: '' } });
    rerender({ filters: { q: 'refund' } });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.map((c) => c.search.toString())).toEqual(['', 'tier=complex&tier=simple', 'q=refund']);
  });
});

describe('Performance reads', () => {
  it('reads Home every 15 s, every 5 s while a run is active, and stamps the arrival', async () => {
    const options = performanceHomeQueryOptions('demo');
    expect(options.queryKey).toEqual(['project', 'demo', 'performance', 'home']);
    expect(options.refetchIntervalInBackground).toBe(false);
    expect(intervalWith(options, undefined)).toBe(15000);
    expect(intervalWith(options, { active_run: null })).toBe(15000);
    expect(intervalWith(options, { active_run: { id: 'r1' } })).toBe(5000);

    const calls = stubFetch(() => ({ server_time: '2026-11-22T09:00:00Z', active_run: null }));
    vi.spyOn(Date, 'now').mockReturnValue(1_795_000_000_000);
    const data = await newClient().fetchQuery(options);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${B}`]);
    expect(data).toMatchObject({ server_time: '2026-11-22T09:00:00Z', received_at: 1_795_000_000_000 });
  });

  it('reads a run every 5 s only while it is queued, starting, running or stopping', async () => {
    const options = performanceRunQueryOptions('demo', 'run/1');
    expect(options.queryKey).toEqual(['project', 'demo', 'performance', 'run', 'run/1']);
    expect(options.refetchIntervalInBackground).toBe(false);
    expect(PERFORMANCE_ACTIVE_STATUSES).toEqual(['queued', 'starting', 'running', 'stopping']);
    for (const status of PERFORMANCE_ACTIVE_STATUSES) {
      expect(intervalWith(options, { effective_status: status })).toBe(5000);
      expect(isPerformanceRunActive(status)).toBe(true);
    }
    for (const status of ENDED) {
      expect(intervalWith(options, { effective_status: status })).toBe(false);
      expect(isPerformanceRunActive(status)).toBe(false);
    }
    expect(intervalWith(options, undefined)).toBe(false);
    expect(isPerformanceRunActive(null)).toBe(false);
    expect(performanceRunQueryOptions('demo', '').enabled).toBe(false);

    const calls = stubFetch(() => ({ effective_status: 'running' }));
    vi.spyOn(Date, 'now').mockReturnValue(42);
    const data = await newClient().fetchQuery(options);
    expect(calls[0]!.path).toBe(`${B}/runs/run%2F1`);
    expect(data).toMatchObject({ effective_status: 'running', received_at: 42 });
  });

  it('keeps reading an ended run every 15 s until the time for late results has passed', () => {
    const options = performanceRunQueryOptions('demo', 'r1');
    const ended = { effective_status: 'interrupted', server_time: '2026-11-22T09:02:00Z' };
    expect(intervalWith(options, { ...ended, late_results_until: '2026-11-22T09:10:00Z' })).toBe(15000);
    expect(intervalWith(options, { ...ended, late_results_until: '2026-11-22T09:02:01Z' })).toBe(15000);
    expect(intervalWith(options, { ...ended, late_results_until: '2026-11-22T09:02:00Z' })).toBe(false);
    expect(intervalWith(options, { ...ended, late_results_until: '2026-11-22T08:59:00Z' })).toBe(false);
    expect(intervalWith(options, { ...ended, late_results_until: null })).toBe(false);
    expect(
      intervalWith(options, { effective_status: 'finished', late_results_until: '2026-11-22T09:10:00Z' }),
    ).toBe(false);
    // The server's two times decide: the clock of this computer plays no part.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2031-01-01T00:00:00Z'));
    expect(intervalWith(options, { ...ended, late_results_until: '2026-11-22T09:10:00Z' })).toBe(15000);
    // A run that is still going keeps its own interval.
    expect(
      intervalWith(options, {
        effective_status: 'stopping',
        server_time: '2026-11-22T09:02:00Z',
        late_results_until: null,
      }),
    ).toBe(5000);
  });

  it('passes on that the number of starts has no limit', async () => {
    const limits: Pick<PerformancePlanLimits, 'starts_per_hour' | 'starts_left'> = {
      starts_per_hour: 0,
      starts_left: null,
    };
    stubFetch(() => ({ limits }));
    const setup = await newClient().fetchQuery(performanceSetupQueryOptions('demo'));
    expect(setup.limits.starts_left).toBeNull();
    expect(setup.limits.starts_per_hour).toBe(0);
  });

  it('reads the setup and the runner on their own intervals', async () => {
    const setup = performanceSetupQueryOptions('demo');
    expect(setup.refetchInterval).toBe(15000);
    expect(setup.refetchIntervalInBackground).toBe(false);
    const runner = performanceRunnerQueryOptions('demo');
    expect(runner.queryKey).toEqual(['project', 'demo', 'performance', 'runner']);
    expect(runner.refetchIntervalInBackground).toBe(false);
    expect(intervalWith(runner, { active_run: null })).toBe(15000);
    expect(intervalWith(runner, { active_run: { id: 'r1' } })).toBe(5000);
    const events = performanceRunnerEventsQueryOptions('demo', { page: 2, limit: 10, level: ['error'] });
    expect(events.refetchInterval).toBe(15000);
    expect(events.refetchIntervalInBackground).toBe(false);
    // Another page of the same level keeps the rows on screen; another level or project does not.
    const key = (slug: string, level: string[]) => [...performanceKeys.runner(slug), 'events', { level }];
    expect(placeholderFrom(events, key('demo', ['error']))).toBe('previous rows');
    expect(placeholderFrom(events, key('demo', ['warning']))).toBeUndefined();
    expect(placeholderFrom(events, key('other', ['error']))).toBeUndefined();

    const calls = stubFetch();
    vi.spyOn(Date, 'now').mockReturnValue(7);
    const client = newClient();
    expect(await client.fetchQuery(setup)).toMatchObject({ received_at: 7 });
    expect(await client.fetchQuery(runner)).toMatchObject({ received_at: 7 });
    await client.fetchQuery(events);
    await client.fetchQuery(performanceTargetsQueryOptions('demo'));
    expect(calls.map((c) => `${c.path}?${c.search}`)).toEqual([
      `${B}/setup?`,
      `${B}/runner?`,
      `${B}/runner/events?page=2&limit=10&level=error`,
      `${B}/targets?`,
    ]);
    expect(performanceTargetsQueryOptions('demo')).not.toHaveProperty('refetchInterval');
  });

  it('reads the history by page and filters, without polling', async () => {
    const options = performanceRunsQueryOptions('demo', {
      page: 2,
      page_size: 25,
      status: ['finished', 'stopped'],
      verdict: ['breakpoint_found'],
      target: 't1',
      test_type: ['breakpoint'],
    });
    expect(options).not.toHaveProperty('refetchInterval');
    expect(placeholderFrom(options, performanceKeys.runs('demo', { page: 1 }))).toBe('previous rows');
    expect(placeholderFrom(options, performanceKeys.runs('other', { page: 1 }))).toBeUndefined();
    const calls = stubFetch(() => ({ rows: [], total: 0, page: 2, page_size: 25 }));
    await newClient().fetchQuery(options);
    expect(calls[0]!.path).toBe(`${B}/runs`);
    expect([...calls[0]!.search]).toEqual([
      ['page', '2'],
      ['page_size', '25'],
      ['status', 'finished'],
      ['status', 'stopped'],
      ['verdict', 'breakpoint_found'],
      ['target', 't1'],
      ['test_type', 'breakpoint'],
    ]);
  });

  it('reads a run’s questions, log and events, every 5 s only while told the run is active', async () => {
    const questions = performanceQuestionsQueryOptions('demo', 'r1', { after_seq: 0, followup: false });
    const log = performanceLogQueryOptions('demo', 'r1', { after_seq: 500, limit: 1000, level: ['error'] });
    const events = performanceRunEventsQueryOptions('demo', 'r1');
    for (const options of [questions, log, events]) {
      expect(options.refetchInterval).toBe(false);
      expect(options.refetchIntervalInBackground).toBe(false);
      expect(options.enabled).toBe(true);
    }
    const live = { active: true };
    expect(performanceQuestionsQueryOptions('demo', 'r1', {}, live).refetchInterval).toBe(5000);
    expect(performanceLogQueryOptions('demo', 'r1', {}, live).refetchInterval).toBe(5000);
    expect(performanceRunEventsQueryOptions('demo', 'r1', live).refetchInterval).toBe(5000);
    expect(performanceQuestionsQueryOptions('demo', 'r1', {}, { enabled: false }).enabled).toBe(false);
    expect(performanceLogQueryOptions('demo', '', {}).enabled).toBe(false);
    expect(performanceRunEventsQueryOptions('demo', 'r1', { enabled: false }).enabled).toBe(false);
    // Other filters of the same run keep the rows on screen; another run starts empty.
    expect(placeholderFrom(questions, performanceKeys.runQuestions('demo', 'r1', { page: 9 }))).toBe(
      'previous rows',
    );
    expect(placeholderFrom(questions, performanceKeys.runQuestions('demo', 'r2'))).toBeUndefined();
    expect(placeholderFrom(questions, performanceKeys.runQuestions('other', 'r1'))).toBeUndefined();
    expect(placeholderFrom(log, performanceKeys.runLog('demo', 'r1', { after_seq: 9 }))).toBe(
      'previous rows',
    );
    expect(placeholderFrom(log, performanceKeys.runLog('demo', 'r2'))).toBeUndefined();
    expect(placeholderFrom(log, performanceKeys.runLog('other', 'r1'))).toBeUndefined();

    const calls = stubFetch();
    const client = newClient();
    await client.fetchQuery(questions);
    await client.fetchQuery(log);
    await client.fetchQuery(events);
    expect(calls.map((c) => `${c.path}?${c.search}`)).toEqual([
      `${B}/runs/r1/questions?after_seq=0&followup=false`,
      `${B}/runs/r1/log?after_seq=500&limit=1000&level=error`,
      `${B}/runs/r1/events?`,
    ]);
  });

  it('reads the datasets of the New run page once, without polling', async () => {
    const options = performanceDatasetsQueryOptions('demo');
    expect(options.queryKey).toEqual(['project', 'demo', 'performance', 'datasets']);
    expect(options).not.toHaveProperty('refetchInterval');
    const published: PerformanceDataset = {
      id: 'd1',
      name: 'QA - Health questions',
      slug: 'qa-health-questions',
      latest_published_version: { id: 'v3', name: 'v3' },
      item_count: 139,
      tier_counts: { simple: 30, medium: 38, complex: 71 },
      follow_ups: 133,
      single_kind: false,
      updated_by: 'QA - Analyst',
      updated_by_user_id: 'user-qa-analyst',
      updated_at: '2026-11-20T08:00:00Z',
    };
    const draft: PerformanceDataset = {
      ...published,
      id: 'd2',
      name: 'QA - Draft only',
      slug: 'qa-draft-only',
      latest_published_version: null,
      item_count: 12,
      tier_counts: { simple: 0, medium: 0, complex: 0 },
      follow_ups: 0,
      single_kind: true,
      updated_by: null,
      updated_by_user_id: null,
    };
    const calls = stubFetch(() => ({ datasets: [published, draft] }));
    const { result } = renderHook(() => usePerformanceDatasets('demo'), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.map((c) => `${c.method} ${c.path}?${c.search}`)).toEqual([`GET ${B}/datasets?`]);
    expect(result.current.data).toEqual({ datasets: [published, draft] });
    // The id of the published version is what the kinds of that version are asked with.
    expect(
      performanceDatasetTiersQueryOptions(
        'demo',
        result.current.data!.datasets[1]!.latest_published_version?.id ?? null,
      ).enabled,
    ).toBe(false);
    expect(
      performanceDatasetTiersQueryOptions(
        'demo',
        result.current.data!.datasets[0]!.latest_published_version?.id ?? null,
      ).queryKey,
    ).toEqual(performanceKeys.datasetTiers('demo', 'v3'));
  });

  it('gives Home’s run card the plan and the levels in the run read’s own types', async () => {
    // The two lists are the run read's lists: a value of one type is a value of the other.
    const stages: PerformanceRunRead['config']['plan']['stages'] = [
      { role: 'baseline', target_users: 5, start_s: 0, end_s: 60 },
      { role: 'ramp', target_users: 10, start_s: 60, end_s: 90 },
      { role: 'hold', target_users: 10, start_s: 90, end_s: 390 },
    ];
    const levels: NonNullable<PerformanceRunRead['progress']>['levels'] = [];
    const card: Pick<PerformanceActiveRun, 'id' | 'stages' | 'levels'> = { id: 'r1', stages, levels };
    const backToRunRead: PerformanceRunRead['config']['plan']['stages'] = card.stages;
    expect(backToRunRead).toBe(stages);
    stubFetch(() => ({ server_time: '2026-11-22T09:00:00Z', active_run: card }));
    const home = await newClient().fetchQuery(performanceHomeQueryOptions('demo'));
    expect(home.active_run?.stages).toEqual(stages);
    expect(home.active_run?.levels).toEqual([]);
  });

  it('asks for the kinds of a dataset version only once one is chosen', async () => {
    expect(performanceDatasetTiersQueryOptions('demo', null).enabled).toBe(false);
    const options = performanceDatasetTiersQueryOptions('demo', 'v 1');
    expect(options.enabled).toBe(true);
    const calls = stubFetch();
    await newClient().fetchQuery(options);
    expect(`${calls[0]!.path}?${calls[0]!.search}`).toBe(`${B}/dataset-tiers?dataset_version_id=v+1`);
  });
});

describe('Performance writes', () => {
  const start = { target_id: 't1', test_type: 'smoke' } as StartRunRequest;
  const target = { name: 'QA - Playground', is_production: false } as SaveTargetRequest;

  it.each([
    ['starts a run', () => useStartPerformanceRun('demo'), start, 'POST', `${B}/runs`, start],
    [
      'stops without a reason',
      () => useStopPerformanceRun('demo', 'run/1'),
      undefined,
      'POST',
      `${B}/runs/run%2F1/stop`,
      {},
    ],
    [
      'stops with a reason',
      () => useStopPerformanceRun('demo', 'r1'),
      { reason: 'Wrong target' },
      'POST',
      `${B}/runs/r1/stop`,
      { reason: 'Wrong target' },
    ],
    [
      'hands a token to a run',
      () => useHandOffPerformanceToken('demo', 'r1'),
      { name: 'refresh_token', token: 'sample-value' },
      'POST',
      `${B}/runs/r1/tokens`,
      { name: 'refresh_token', token: 'sample-value' },
    ],
    [
      'adds a target',
      () => useSavePerformanceTarget('demo'),
      { body: target },
      'POST',
      `${B}/targets`,
      target,
    ],
    [
      'changes a target',
      () => useSavePerformanceTarget('demo'),
      { id: 't/1', body: target },
      'PUT',
      `${B}/targets/t%2F1`,
      target,
    ],
    [
      'archives a target',
      () => useArchivePerformanceTarget('demo'),
      't1',
      'DELETE',
      `${B}/targets/t1`,
      undefined,
    ],
    [
      'restores an archived target',
      () => useRestorePerformanceTarget('demo'),
      't/1',
      'POST',
      `${B}/targets/t%2F1/restore`,
      undefined,
    ],
    [
      'saves a target’s token',
      () => useSavePerformanceTargetToken('demo'),
      { targetId: 't1', name: 'access_token', body: { token: 'sample-value', expires_at: null } },
      'PUT',
      `${B}/targets/t1/tokens/access_token`,
      { token: 'sample-value', expires_at: null },
    ],
    [
      'removes a target’s token',
      () => useDeletePerformanceTargetToken('demo'),
      { targetId: 't1', name: 'refresh_token' },
      'DELETE',
      `${B}/targets/t1/tokens/refresh_token`,
      undefined,
    ],
    [
      'chooses the runner key',
      () => useSetPerformanceRunnerKey('demo'),
      'key-1',
      'PUT',
      `${B}/runner/key`,
      { api_key_id: 'key-1' },
    ],
    [
      'removes the runner key',
      () => useSetPerformanceRunnerKey('demo'),
      null,
      'PUT',
      `${B}/runner/key`,
      { api_key_id: null },
    ],
  ] as const)('%s', async (_name, useWrite, input, method, path, body) => {
    const calls = stubFetch((call) => (call.method === 'DELETE' ? new Response(null, { status: 204 }) : {}));
    const { result } = renderHook(useWrite as () => { mutateAsync: (input: unknown) => Promise<unknown> }, {
      wrapper: wrapperFor(newClient()),
    });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method, path });
    expect(calls[0]!.search.toString()).toBe('');
    expect(calls[0]!.body).toEqual(body);
  });

  it('reads the area again after a write, and after a refused write', async () => {
    let refuse = false;
    const calls = stubFetch((call) => {
      if (call.method === 'GET') return { targets: [] };
      return refuse
        ? json({ error: { code: 'target_name_taken', message: 'Another target has this name.' } }, 409)
        : {};
    });
    const { result } = renderHook(
      () => ({ targets: usePerformanceTargets('demo'), save: useSavePerformanceTarget('demo') }),
      { wrapper: wrapperFor(newClient()) },
    );
    await waitFor(() => expect(result.current.targets.isSuccess).toBe(true));
    expect(reads(calls, `${B}/targets`)).toHaveLength(1);

    await act(async () => {
      await result.current.save.mutateAsync({ body: target });
    });
    // A write that went through has waited for the new list.
    expect(reads(calls, `${B}/targets`)).toHaveLength(2);

    refuse = true;
    let refused: unknown;
    await act(async () => {
      refused = await result.current.save.mutateAsync({ body: target }).catch((error: unknown) => error);
    });
    expect(performanceError(refused)).toMatchObject({ status: 409, code: 'target_name_taken' });
    await waitFor(() => expect(reads(calls, `${B}/targets`)).toHaveLength(3));

    // A refused restore names the target that holds the address.
    const { result: restore } = renderHook(() => useRestorePerformanceTarget('demo'), {
      wrapper: wrapperFor(newClient()),
    });
    vi.unstubAllGlobals();
    stubFetch(() =>
      json(
        {
          error: {
            code: 'target_address_taken',
            message: 'Another target uses this address.',
            details: { target_id: 't2', name: 'QA - Preprod' },
          },
        },
        409,
      ),
    );
    await act(async () => {
      refused = await restore.current.mutateAsync('t1').catch((error: unknown) => error);
    });
    expect(performanceError<RestoreTargetError>(refused)).toEqual({
      status: 409,
      code: 'target_address_taken',
      message: 'Another target uses this address.',
      details: { target_id: 't2', name: 'QA - Preprod' },
    });
  });

  it('does not keep a typed token once nothing shows the result', async () => {
    stubFetch();
    const client = newClient();
    const sent = () =>
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state.variables),
      );
    const handOff = renderHook(() => useHandOffPerformanceToken('demo', 'r1'), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await handOff.result.current.mutateAsync({ name: 'refresh_token', token: 'sample-value-1' });
    });
    handOff.unmount();
    await waitFor(() => expect(sent()).not.toContain('sample-value-1'));

    const save = renderHook(() => useSavePerformanceTargetToken('demo'), { wrapper: wrapperFor(client) });
    await act(async () => {
      await save.result.current.mutateAsync({
        targetId: 't1',
        name: 'access_token',
        body: { token: 'sample-value-2' },
      });
    });
    save.unmount();
    await waitFor(() => expect(sent()).not.toContain('sample-value-2'));
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
});

describe('Performance writes: a typed token', () => {
  it('is sent, then let go while the hook stays mounted, after a success and after a refusal', async () => {
    let refuse = false;
    const calls = stubFetch(() =>
      refuse ? json({ error: { code: 'run_ended', message: 'The run has ended.' } }, 409) : {},
    );
    const client = newClient();
    const kept = () =>
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      );
    const { result } = renderHook(
      () => ({
        handOff: useHandOffPerformanceToken('demo', 'r1'),
        save: useSavePerformanceTargetToken('demo'),
      }),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await result.current.handOff.mutateAsync({ name: 'refresh_token', token: 'sample-value-1' });
    });
    expect(calls.at(-1)!.body).toEqual({ name: 'refresh_token', token: 'sample-value-1' });
    await waitFor(() => expect(result.current.handOff.isSuccess).toBe(true));
    expect(result.current.handOff.variables).toEqual({ name: 'refresh_token', token: '' });
    expect(kept()).not.toContain('sample-value-1');

    refuse = true;
    let refused: unknown;
    await act(async () => {
      refused = await result.current.handOff
        .mutateAsync({ name: 'access_token', token: 'sample-value-2' })
        .catch((error: unknown) => error);
    });
    expect(calls.at(-1)!.body).toEqual({ name: 'access_token', token: 'sample-value-2' });
    expect(performanceError(refused)).toMatchObject({ status: 409, code: 'run_ended' });
    await waitFor(() => expect(result.current.handOff.isError).toBe(true));
    expect(result.current.handOff.variables).toEqual({ name: 'access_token', token: '' });
    expect(kept()).not.toContain('sample-value-2');

    // The same for a target's token, started with `mutate` and its own callback.
    const done = vi.fn();
    act(() => {
      result.current.save.mutate(
        { targetId: 't1', name: 'access_token', body: { token: 'sample-value-3', expires_at: null } },
        { onError: done },
      );
    });
    await waitFor(() => expect(result.current.save.isError).toBe(true));
    expect(calls.at(-1)).toMatchObject({
      method: 'PUT',
      body: { token: 'sample-value-3', expires_at: null },
    });
    expect(done).toHaveBeenCalledTimes(1);
    expect(result.current.save.variables).toEqual({
      targetId: 't1',
      name: 'access_token',
      body: { token: '', expires_at: null },
    });
    refuse = false;
    await act(async () => {
      await result.current.save.mutateAsync({
        targetId: 't1',
        name: 'refresh_token',
        body: { token: 'sample-value-4' },
      });
    });
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
    expect(calls.at(-1)!.body).toEqual({ token: 'sample-value-4' });
    expect(result.current.save.variables).toEqual({
      targetId: 't1',
      name: 'refresh_token',
      body: { token: '' },
    });
    expect(kept()).not.toContain('sample-value');
  });
});

describe('Performance refusals', () => {
  it('reads the code, the sentence and the details from the error body', () => {
    const refused = new ApiError(409, '{"code":"runner_busy"}', {
      code: 'runner_busy',
      body: {
        error: {
          code: 'runner_busy',
          message: 'The runner is busy with run 24.',
          details: { run_id: 'r24' },
          request_id: 'x',
        },
        detail: { code: 'runner_busy' },
      },
    });
    const error = performanceError<StartRunError>(refused);
    expect(error).toEqual({
      status: 409,
      code: 'runner_busy',
      message: 'The runner is busy with run 24.',
      details: { run_id: 'r24' },
    });
  });

  it('gives a refusal without details an empty object, and a validation answer its list', () => {
    const plain = new ApiError(403, 'Forbidden', {
      body: { error: { code: 'forbidden', message: 'Forbidden', details: [] }, detail: 'Forbidden' },
    });
    expect(performanceError(plain)).toEqual({
      status: 403,
      code: 'forbidden',
      message: 'Forbidden',
      details: {},
    });
    const fields = [{ loc: ['body', 'plan', 'limit_ms'], msg: 'Field required', type: 'missing' }];
    const invalid = new ApiError(422, 'plan.limit_ms: Field required', {
      body: {
        error: { code: 'validation_error', message: 'The request is not valid', details: fields },
        detail: fields,
      },
    });
    expect(performanceError(invalid)).toEqual({
      status: 422,
      code: 'validation',
      message: 'The request is not valid',
      details: fields,
    });
  });

  it('reads the answers as the platform sends them: no access, not found, an empty token', () => {
    /** The body the platform builds for a refusal (`error_body`): `details` is `[]` when there are none. */
    const answer = (status: number, code: string, message: string, details: unknown = []) =>
      new ApiError(status, message, {
        code,
        body: { error: { code, message, details, request_id: 'x' }, detail: message },
      });
    expect(performanceError<PerformanceReadError>(answer(403, 'access_denied', 'Access denied'))).toEqual({
      status: 403,
      code: 'access_denied',
      message: 'Access denied',
      details: {},
    });
    for (const code of ['run_not_found', 'dataset_version_not_found', 'report_not_found'] as const)
      expect(performanceError<PerformanceReadError>(answer(404, code, 'Not found'))).toEqual({
        status: 404,
        code,
        message: 'Not found',
        details: {},
      });
    expect(
      performanceError<TokenHandoffError>(answer(422, 'token_empty', 'Paste the token: the field is empty.')),
    ).toEqual({
      status: 422,
      code: 'token_empty',
      message: 'Paste the token: the field is empty.',
      details: {},
    });
    expect(
      performanceError<SaveTargetTokenError>(
        answer(409, 'target_busy', 'Run 24 is in progress on this target.', { run_id: 'r24' }),
      ),
    ).toEqual({
      status: 409,
      code: 'target_busy',
      message: 'Run 24 is in progress on this target.',
      details: { run_id: 'r24' },
    });

    // The lists of refusals name these codes: a page can tell them apart by `code` (checked by the type check).
    const named = <E extends { code: string }>(...codes: E['code'][]) => codes;
    expect([
      ...named<StartRunError>(
        'access_denied',
        'forbidden',
        'target_archived',
        'target_busy',
        'mix_tier_empty',
      ),
      ...named<StopRunError>('access_denied', 'forbidden'),
      ...named<TokenHandoffError>('access_denied', 'token_empty'),
      ...named<SaveTargetError>('access_denied', 'target_archived', 'target_busy'),
      ...named<RestoreTargetError>('access_denied', 'target_name_taken', 'target_address_taken'),
      ...named<SaveTargetTokenError>('access_denied', 'target_archived', 'target_busy', 'token_empty'),
      ...named<SetRunnerKeyError>('access_denied', 'api_key_not_found'),
    ]).toHaveLength(21);
  });

  it('knows the answer of a switched-off area from every other refusal', async () => {
    const off = { code: 'performance_is_switched_off', message: 'Performance is switched off' };
    const body = { error: { ...off, details: [], request_id: 'x' }, detail: off.message };
    expect(isPerformanceSwitchedOff(new ApiError(404, off.message, { code: off.code, body }))).toBe(true);
    // The sentence alone is enough, with or without its full stop.
    expect(isPerformanceSwitchedOff(new ApiError(404, 'Performance is switched off.'))).toBe(true);
    expect(isPerformanceSwitchedOff(new ApiError(404, 'Run not found', { code: 'run_not_found' }))).toBe(
      false,
    );
    expect(isPerformanceSwitchedOff(new ApiError(404, 'Not found'))).toBe(false);
    expect(isPerformanceSwitchedOff(new ApiError(503, off.message))).toBe(false);
    expect(isPerformanceSwitchedOff(new TypeError('Failed to fetch'))).toBe(false);
    expect(isPerformanceSwitchedOff(null)).toBe(false);

    // A mounted read: the hook's error is that answer, asked for once, and its sentence is the platform's.
    const calls = stubFetch(() => json(body, 404));
    const { result } = renderHook(() => usePerformanceHome('demo'), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toHaveLength(1);
    expect(isPerformanceSwitchedOff(result.current.error)).toBe(true);
    expect(performanceError(result.current.error)).toEqual({ status: 404, ...off, details: {} });
  });

  it('passes on the platform’s sentence for a write in an archived project', () => {
    const sentence = 'Project is archived; unarchive it to make changes';
    const archived = new ApiError(409, sentence, {
      code: 'conflict',
      body: {
        error: { code: 'conflict', message: sentence, details: [], request_id: 'x' },
        detail: sentence,
      },
    });
    expect(performanceError(archived)).toEqual({
      status: 409,
      code: 'conflict',
      message: sentence,
      details: {},
    });
  });

  it('never passes on a text that is not the platform’s own, and is null for an error that is not an API answer', () => {
    const plain = { status: 502, code: '', message: 'The request failed (error 502).', details: {} };
    // A proxy's error page: the client keeps the start of the markup as its detail.
    const page =
      '<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>';
    expect(performanceError(new ApiError(502, page, { body: page }))).toEqual(plain);
    expect(performanceError(new ApiError(502, 'Bad gateway', { body: 'Bad gateway' }))).toEqual(plain);
    expect(performanceError(new ApiError(502, ''))).toEqual(plain);
    // The platform's JSON without the error object still carries its sentence.
    expect(performanceError(new ApiError(404, 'Not found', { body: { detail: 'Not found' } }))).toEqual({
      status: 404,
      code: '',
      message: 'Not found',
      details: {},
    });
    expect(performanceError(new TypeError('Failed to fetch'))).toBeNull();
    expect(performanceError(null)).toBeNull();
  });
});

describe('Performance: when a run ends', () => {
  it('Home reads the history again when the active run is gone, not when one appears', async () => {
    let active: { id: string } | null = null;
    const calls = stubFetch((call) =>
      call.path === B ? { active_run: active } : { rows: [], total: 0, page: 1, page_size: 25 },
    );
    const { result } = renderHook(
      () => ({ home: usePerformanceHome('demo'), runs: usePerformanceRuns('demo') }),
      { wrapper: wrapperFor(newClient()) },
    );
    await waitFor(() => expect(result.current.runs.isSuccess && result.current.home.isSuccess).toBe(true));
    expect(reads(calls, `${B}/runs`)).toHaveLength(1);

    active = { id: 'r1' };
    await act(async () => {
      await result.current.home.refetch();
    });
    await waitFor(() => expect(result.current.home.data?.active_run).toEqual({ id: 'r1' }));
    expect(reads(calls, `${B}/runs`)).toHaveLength(1);

    active = null;
    await act(async () => {
      await result.current.home.refetch();
    });
    await waitFor(() => expect(reads(calls, `${B}/runs`)).toHaveLength(2));

    // One run replaced by another between two reads counts as an end too.
    active = { id: 'r2' };
    await act(async () => {
      await result.current.home.refetch();
    });
    await waitFor(() => expect(result.current.home.data?.active_run).toEqual({ id: 'r2' }));
    await idle();
    const before = reads(calls, `${B}/runs`).length;
    active = { id: 'r3' };
    await act(async () => {
      await result.current.home.refetch();
    });
    await waitFor(() => expect(reads(calls, `${B}/runs`)).toHaveLength(before + 1));
  });

  it('the run page reads the run’s rows again when a result arrives after the end', async () => {
    let late = false;
    const calls = stubFetch((call) =>
      call.path.endsWith('/events')
        ? { events: [] }
        : {
            effective_status: 'interrupted',
            summary: late ? { verdict: 'pass' } : null,
            report: null,
            counts: { questions_received: late ? 12 : 10, log_lines_received: 40, events: 3 },
          },
    );
    const { result } = renderHook(
      () => ({ run: usePerformanceRun('demo', 'r1'), events: usePerformanceRunEvents('demo', 'r1') }),
      { wrapper: wrapperFor(newClient()) },
    );
    await waitFor(() => expect(result.current.run.isSuccess && result.current.events.isSuccess).toBe(true));
    // A read that brings nothing new leaves the rows alone.
    await act(async () => {
      await result.current.run.refetch();
    });
    await idle();
    expect(reads(calls, `${B}/runs/r1/events`)).toHaveLength(1);

    late = true;
    await act(async () => {
      await result.current.run.refetch();
    });
    await waitFor(() => expect(result.current.run.data?.summary).toEqual({ verdict: 'pass' }));
    await waitFor(() => expect(reads(calls, `${B}/runs/r1/events`)).toHaveLength(2));
    await idle();
    // The run itself was not asked for again: the first read and the two above.
    expect(reads(calls, `${B}/runs/r1`)).toHaveLength(3);
  });

  it('the run page reads the run’s events once more when the run ends', async () => {
    let status: PerformanceRunStatus = 'running';
    const calls = stubFetch((call) =>
      call.path.endsWith('/events') ? { events: [] } : { effective_status: status },
    );
    const { result } = renderHook(
      () => ({ run: usePerformanceRun('demo', 'r1'), events: usePerformanceRunEvents('demo', 'r1') }),
      { wrapper: wrapperFor(newClient()) },
    );
    await waitFor(() => expect(result.current.run.isSuccess && result.current.events.isSuccess).toBe(true));
    await act(async () => {
      await result.current.run.refetch();
    });
    expect(reads(calls, `${B}/runs/r1/events`)).toHaveLength(1);

    status = 'finished';
    await act(async () => {
      await result.current.run.refetch();
    });
    await waitFor(() => expect(reads(calls, `${B}/runs/r1/events`)).toHaveLength(2));
    // The run is read once more with the rest, then no further: the picture of an ended run is final.
    await idle();
    const settled = reads(calls, `${B}/runs/r1`).length;
    await act(async () => {
      await result.current.events.refetch();
    });
    expect(reads(calls, `${B}/runs/r1`)).toHaveLength(settled);
  });
});
