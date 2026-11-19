import { formatHeaderDate, formatTableDate } from '@/lib/dates';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  fieldStatus,
  failedCheckText,
  useLiveWorker,
  validateDateRange,
  workerDefaults,
  type LiveJob,
} from '@/api/liveWorker';
import {
  liveWorkerRead,
  liveWorkerWaiting,
  liveWorkerPending,
  liveWorkerFailed,
} from '@/features/dev/liveFixtures';
import { clients, setup, writes, openField, source, response } from './workerHarness';

// Live worker page: jobs, errors, polling and the pure helpers.
vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));

it.each([
  ['running', true, 'Cancelling', 'info'],
  ['running', false, 'Running', 'info'],
  ['cancelled', true, 'Cancelled', 'warning'],
] as const)('shows job status %s with cancel_requested=%s', async (status, cancel_requested, label, tone) => {
  setup({
    ...liveWorkerRead,
    jobs: [{ ...liveWorkerRead.jobs[0]!, status, cancel_requested }],
  });
  const table = await screen.findByRole('treegrid', { name: 'Worker jobs' });
  const badge = within(table).getByText(label).closest('[data-shape]');
  expect(badge).toBeVisible();
  expect(badge).toHaveAttribute('data-tone', tone);
  if (status === 'running') {
    const button = within(table).getByRole('button', {
      name: cancel_requested ? 'Cancel requested' : 'Cancel',
    });
    if (cancel_requested) expect(button).toBeDisabled();
    else expect(button).toBeEnabled();
  }
});
it.each([
  ['running', '2026-11-03T12:18:00Z', 'updated 2m ago', 'muted'],
  ['running', '2026-11-03T12:10:00Z', 'updated 10m ago', 'muted'],
  ['running', '2026-11-03T12:09:59Z', 'no update for 10m', 'danger'],
  ['queued', '2026-11-03T12:00:00Z', 'updated 20m ago', 'muted'],
  ['done', '2026-11-03T12:00:00Z', 'updated 20m ago', 'muted'],
  ['failed', '2026-11-03T12:00:00Z', 'updated 20m ago', 'muted'],
  ['cancelled', '2026-11-03T12:00:00Z', 'updated 20m ago', 'muted'],
] as const)('shows job freshness for %s updated at %s', async (status, updated_at, label, tone) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:20:00Z'));
  setup({
    ...liveWorkerRead,
    jobs: [
      {
        ...liveWorkerRead.jobs[0]!,
        status,
        started_at: '2026-11-03T11:20:00Z',
        requested_at: '2026-11-03T11:20:00Z',
        updated_at,
      },
    ],
  });
  const table = await screen.findByRole('treegrid', { name: 'Worker jobs' });
  const requested = within(table).getByText(formatTableDate('2026-11-03T11:20:00Z'));
  const cell = requested.closest('td')!;
  const updated = within(cell).getByText(label);
  expect(updated).toBeVisible();
  expect(updated).toHaveAttribute('data-tone', tone);
  expect(updated).toHaveAttribute('title', updated_at);
  expect(requested.compareDocumentPosition(updated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('confirms cancelling a job and shows cancelling after the worker refresh', async () => {
  const job = liveWorkerRead.jobs[0]!;
  const cancelled = { ...job, cancel_requested: true };
  const view = setup(liveWorkerRead, () => {
    view.setRead({ ...liveWorkerRead, jobs: [cancelled] });
    return response(cancelled);
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  const dialog = screen.getByRole('dialog', { name: 'Cancel job?' });
  expect(writes(view.fetch)).toHaveLength(0);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel job' }));
  expect((await screen.findByText('Cancelling')).closest('[data-shape]')).toHaveAttribute(
    'data-tone',
    'info',
  );
  expect(writes(view.fetch)).toHaveLength(1);
  expect(writes(view.fetch)[0]![0]).toContain(`/jobs/${job.id}/cancel?source=`);
  expect(writes(view.fetch)[0]![1]?.method).toBe('POST');
  expect(screen.getByRole('button', { name: 'Cancel requested' })).toBeDisabled();
});
it('maps a nested 422 to Database host without marking Langfuse host', async () => {
  setup(liveWorkerRead, () =>
    response(
      { detail: [{ loc: ['body', 'values', 'database', 'host'], msg: 'Database host is invalid' }] },
      422,
    ),
  );
  const user = userEvent.setup();
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'new-secret');
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  await waitFor(() => expect(screen.getByLabelText('Database host')).toHaveAttribute('aria-invalid', 'true'));
  const trigger = within(screen.getByRole('region', { name: 'Database' })).getByRole('button', {
    name: /^Database /,
  });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).not.toHaveTextContent('differs from running');
  expect(trigger).not.toHaveTextContent('changed ·');
  expect(screen.getByLabelText('Database host')).toHaveAccessibleDescription('Database host is invalid');
  expect(await openField('Langfuse', 'Langfuse host')).not.toHaveAttribute('aria-invalid', 'true');
});
it.each([
  [403, 'Viewers cannot change this project'],
  [409, 'This project is archived'],
] as const)('shows the server sentence for %s', async (status, message) => {
  setup(liveWorkerRead, () =>
    response(
      { detail: message, error: { code: 'write_refused', message, request_id: 'abc123', details: [] } },
      status,
    ),
  );
  const user = userEvent.setup();
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'new-secret');
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  expect(await screen.findByText(`Couldn’t save the settings. ${message}`)).toBeVisible();
  expect(screen.getAllByText(message).length).toBeGreaterThan(0);
  expect(screen.getByText(/request abc123/)).toBeVisible();
});
it('polls the worker every five seconds while a job runs and every fifteen afterwards', async () => {
  vi.useFakeTimers();
  let read = liveWorkerRead;
  const fetch = vi.fn<(input: string) => Promise<Response>>(async () => response(read));
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const { unmount } = renderHook(() => useLiveWorker('demo', source), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(new URL(fetch.mock.calls[0]![0], 'http://localhost').searchParams.has('jobs_limit')).toBe(false);
  // The fixture has a running job: the page refreshes every five seconds.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4998);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  // No active job: fifteen seconds.
  read = { ...liveWorkerRead, jobs: [] };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(14999);
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fetch).toHaveBeenCalledTimes(4);
  unmount();
});
it('reserves four skeleton frames and shows a failed load with retry', async () => {
  const { fetch, container } = setup();
  expect(container.querySelectorAll('[data-live-loading] [role="status"]')).toHaveLength(4);
  await screen.findByRole('button', { name: 'Save as v4' });
  fetch.mockResolvedValue(response({ detail: 'Worker unavailable' }, 503));
  await act(async () => {
    await clients[0]!.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
  expect(await screen.findByText('Couldn’t refresh the worker')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
});
describe('worker helpers', () => {
  it('returns independent defaults and checks applied settings versions', () => {
    const first = workerDefaults();
    first.database.host = 'edited';
    expect(workerDefaults().database.host).toBe('');
    expect(fieldStatus('database', liveWorkerRead)).toBe('running');
    expect(fieldStatus('database', liveWorkerWaiting)).toBe('waiting');
    expect(fieldStatus('database', liveWorkerPending)).toBe('pending');
    expect(fieldStatus('database', liveWorkerFailed)).toBe('failed');
    expect(failedCheckText('models', liveWorkerFailed)).toBeNull();
    expect(
      fieldStatus('database', {
        ...liveWorkerFailed,
        running: {
          ...liveWorkerFailed.running!,
          verification: { ...liveWorkerFailed.running!.verification!, version: 3 },
        },
      }),
    ).toBe('pending');
  });
  it('reports a failed secret-only version even when the values match the running version', () => {
    const read = {
      ...liveWorkerFailed,
      settings: { ...liveWorkerFailed.settings!, values: liveWorkerRead.settings!.values },
    };
    expect(read.settings.values).toEqual(read.running!.running);
    expect(fieldStatus('database', read)).toBe('failed');
    expect(fieldStatus('evaluation', read)).toBe('pending');
    expect(fieldStatus('models', read)).toBe('pending');
    expect(failedCheckText('database', read)).toContain('could not translate host name');
    expect(failedCheckText('evaluation', read)).toBeNull();
  });
  it('reports a secret-only version as pending while verification is null', () => {
    const read = {
      ...liveWorkerPending,
      settings: { ...liveWorkerPending.settings!, values: liveWorkerRead.settings!.values },
    };
    expect(read.settings.values).toEqual(read.running!.running);
    expect(read.running!.verification).toBeNull();
    expect(fieldStatus('database', read)).toBe('pending');
    expect(fieldStatus('evaluation', read)).toBe('pending');
  });
  it('accepts an inclusive 31-day range and rejects invalid limits', () => {
    expect(validateDateRange('2026-01-01', '2026-01-31', 2000, '2026-11-03')).toBeNull();
    expect(validateDateRange('2026-01-01', '2026-02-01', 1, '2026-11-03')).toBe('At most 31 days per job');
    for (const limit of [0, 2001, NaN, 1.5])
      expect(validateDateRange('2026-01-01', '2026-01-01', limit, '2026-11-03')).toBe(
        'Limit must be 1 to 2,000',
      );
  });
});

it('keeps errors for duplicate host and database field names in their own section', async () => {
  setup(liveWorkerRead, () =>
    response(
      {
        detail: [
          { loc: ['body', 'values', 'langfuse', 'host'], msg: 'Langfuse host is invalid' },
          { loc: ['body', 'values', 'database', 'host'], msg: 'Database host is invalid' },
          { loc: ['body', 'values', 'dataiku', 'database'], msg: 'Dataiku database is invalid' },
        ],
      },
      422,
    ),
  );
  const user = userEvent.setup();
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'new-secret');
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Database host')).toHaveAccessibleDescription('Database host is invalid'),
  );
  expect(
    within(screen.getByRole('region', { name: 'Langfuse' })).getByLabelText('Langfuse host'),
  ).toHaveAccessibleDescription('Langfuse host is invalid');
  expect(screen.getByLabelText('Dataiku database')).toHaveAccessibleDescription(
    'Dataiku database is invalid',
  );
  expect(screen.getByLabelText('Database name')).not.toHaveAttribute('aria-invalid', 'true');
});

it.each([
  [{}, '0 of 0', undefined],
  [
    { evaluated: 4, found: 8, skipped_existing: 0, redone: 0, failed: 0, listed: 0 },
    '4 of 8',
    '0 traces listed',
  ],
  [
    // Redone turns count as finished work in the bar: 4 new + 2 redone.
    { evaluated: 4, found: 10, skipped_existing: 3, redone: 2, failed: 1, listed: 20 },
    '6 of 10',
    '20 traces listed',
  ],
] as const)('explains progress counters for %j', async (progress, label, listed) => {
  setup({ ...liveWorkerRead, jobs: [{ ...liveWorkerRead.jobs[0]!, progress }] });
  const table = await screen.findByRole('treegrid', { name: 'Worker jobs' });
  expect(within(table).getByText(label)).toBeVisible();
  expect(table.querySelector('tbody [data-col="progress"]')).toHaveTextContent(new RegExp(`^${label}$`));
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((node) => node.textContent),
  ).toEqual([
    'Kind',
    'Days',
    'Status',
    'Progress',
    'Evaluated',
    'Failed',
    'Already done',
    'Started by',
    'Started',
    'Actions',
  ]);
  for (const key of ['evaluated', 'failed', 'skipped_existing'] as const) {
    const cell = table.querySelector(`tbody [data-col="${key}"]`)!;
    expect(cell).toHaveAttribute('data-align', 'end');
    const count = key in progress ? (progress[key as keyof typeof progress] as number) : 0;
    // The Evaluated column counts redone turns too.
    const redone = key === 'evaluated' && 'redone' in progress ? (progress.redone as number) : 0;
    expect(cell).toHaveTextContent(String(count + redone));
  }
  if (listed) expect(table.querySelector('tbody [data-col="requested_at"]')).toHaveTextContent(listed);
  else expect(within(table).queryByText(/traces listed/)).toBeNull();
});
it.each([
  [undefined, 200, undefined],
  [['failed'], 200, undefined],
  [['failed', 'inconclusive'], 200, 'redo failed, inconclusive'],
  [['all'], 200, 'redo all'],
  [[], 200, 'redo none'],
  [['failed'], 25, 'Limit 25'],
  [[], 25, 'Limit 25 · redo none'],
] as const)('puts non-default job options %j, %s in the kind title', async (redo, limit, title) => {
  const job = liveWorkerRead.jobs[0]!;
  setup({
    ...liveWorkerRead,
    jobs: [{ ...job, params: { ...job.params, limit, redo: redo ? [...redo] : undefined } }],
  });
  const table = await screen.findByRole('treegrid', { name: 'Worker jobs' });
  const kind = within(table).getByText('Backfill');
  if (title) expect(kind).toHaveAttribute('title', title);
  else expect(kind).not.toHaveAttribute('title');
  expect(table.querySelector('tbody [data-col="kind"]')).toHaveTextContent(/^Backfill$/);
});
it('paginates five jobs and loads older batches through 200', async () => {
  const jobs = Array.from({ length: 200 }, (_, i) => ({
    ...liveWorkerRead.jobs[0]!,
    id: `job-${i}`,
    requested_by: `Owner ${i}`,
    status: i === 0 || i === 199 ? ('failed' as const) : ('done' as const),
    error: i === 0 || i === 199 ? `Job ${i} stopped after an upstream timeout.` : null,
  }));
  const { fetch } = setup({ ...liveWorkerRead, jobs });
  const user = userEvent.setup();
  await screen.findByText('Showing 1 to 5 of at least 20 jobs');
  const pager = within(screen.getByRole('navigation', { name: 'jobs pagination' }));
  for (const [limit, first] of [
    [20, 1],
    [50, 21],
    [100, 51],
    [200, 101],
  ]) {
    await screen.findByText(`Showing ${first} to ${first! + 4} of at least ${limit} jobs`);
    const table = screen.getByRole('treegrid', { name: 'Worker jobs' });
    expect(table.querySelectorAll('[data-row-key]')).toHaveLength(5);
    expect(table.querySelectorAll('[data-detail-row]')).toHaveLength(first === 1 ? 1 : 0);
    expect(
      fetch.mock.calls.some(([input]) => {
        const url = new URL(input, 'http://localhost');
        return url.pathname.endsWith('/worker') && url.searchParams.get('jobs_limit') === String(limit);
      }),
    ).toBe(true);
    if (limit! < 200) await user.click(pager.getByRole('button', { name: 'Last page' }));
  }
  await user.click(pager.getByRole('button', { name: 'Last page' }));
  await screen.findByText('Showing 196 to 200 of at least 200 jobs');
  expect(screen.getByText('Job 199 stopped after an upstream timeout.')).toBeVisible();
  expect(pager.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await user.click(pager.getByRole('button', { name: 'Previous page' }));
  expect(await screen.findByText('Owner 190')).toBeVisible();
  expect(screen.queryByText('Job 199 stopped after an upstream timeout.')).not.toBeInTheDocument();
});
it.each([20, 50])('keeps the page and draft when loading jobs beyond %i fails', async (limit) => {
  const jobs = Array.from({ length: 100 }, (_, i) => ({
    ...liveWorkerRead.jobs[0]!,
    id: `job-${i}`,
    status: 'done' as const,
  }));
  const { fetch, client } = setup({ ...liveWorkerRead, jobs });
  const user = userEvent.setup();
  await screen.findByText('Showing 1 to 5 of at least 20 jobs');
  const pager = within(screen.getByRole('navigation', { name: 'jobs pagination' }));
  if (limit === 50) {
    await user.click(pager.getByRole('button', { name: 'Last page' }));
    await screen.findByText('Showing 21 to 25 of at least 50 jobs');
  }
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Unsaved note');
  const table = screen.getByRole('treegrid', { name: 'Worker jobs' });
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation((input, init) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('/worker') && Number(url.searchParams.get('jobs_limit')) > limit)
      return Promise.resolve(response({ detail: 'Older jobs unavailable' }, 500));
    return original(input, init);
  });
  await user.click(pager.getByRole('button', { name: 'Last page' }));
  expect(await screen.findByText(/Couldn’t load older jobs/)).toBeVisible();
  expect(screen.getByRole('treegrid', { name: 'Worker jobs' })).toBe(table);
  expect(
    screen.getByText(
      limit === 20 ? 'Showing 1 to 5 of at least 20 jobs' : 'Showing 21 to 25 of at least 50 jobs',
    ),
  ).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Unsaved note');
  fetch.mockClear();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
  const requests = fetch.mock.calls.map(([input]) => new URL(input, 'http://localhost'));
  expect(
    requests
      .filter((url) => url.pathname.endsWith('/worker'))
      .map((url) => url.searchParams.get('jobs_limit')),
  ).toEqual([String(limit)]);
});
it('has no jobs pager for an empty list', async () => {
  setup({ ...liveWorkerRead, jobs: [] });
  expect(await screen.findByText('No jobs yet')).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'jobs pagination' })).toBeNull();
});
it.each(['running', 'done'] as const)('explains new backfill outcomes for %s', async (status) => {
  setup({
    ...liveWorkerRead,
    status: { ...liveWorkerRead.status, day_key_timezone: 'Asia/Riyadh' },
    jobs: [
      {
        ...liveWorkerRead.jobs[0]!,
        status,
        progress: {
          found: 30,
          evaluated: 6,
          judged: 3,
          recorded: 2,
          incomplete: 1,
          redone: 2,
          failed: 1,
          skipped_existing: 4,
          resumed: 3,
          fetch_failed: 1,
          limit_reached: true,
          remaining: 14,
          effective_until: '2026-11-03T21:30:00Z',
          listed: 40,
          rejected: {
            other_names: 3,
            excluded_users: 2,
            no_session: 1,
            other_environment: 3,
            bad_timestamp: 1,
          },
        },
      },
    ],
  });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  expect(
    table.getByText(
      '2 redone · 3 from an earlier attempt · 1 could not be fetched, will be retried by the next backfill',
    ),
  ).toBeVisible();
  expect(
    table.getByText(
      'Of the evaluated: 3 judged, 2 recorded without judges (cancelled or failed in Insightor), 1 incomplete',
    ),
  ).toBeVisible();
  expect(
    table.getByText('Stopped at the limit of 200. 14 turns in this range are still not evaluated.'),
  ).toHaveAttribute('data-tone', 'warning');
  expect(
    table.getByText(
      `Covers turns up to ${formatHeaderDate('2026-11-03T21:30:00Z')}; later turns are left to the live loop.`,
    ),
  ).toBeVisible();
  expect(
    table.getByText(
      '40 traces listed: 30 user turns, 3 other traces, 2 from excluded users, 1 without a conversation, 3 from other environments, 1 with an invalid timestamp',
    ),
  ).toHaveAttribute('data-tone', 'muted');
});
it('hides empty breakdowns and zero rejection categories', async () => {
  setup({
    ...liveWorkerRead,
    jobs: [
      {
        ...liveWorkerRead.jobs[0]!,
        progress: {
          evaluated: 4,
          found: 4,
          judged: 4,
          recorded: 0,
          incomplete: 0,
          listed: 6,
          rejected: { other_names: 2, excluded_users: 0, no_session: 0 },
        },
      },
    ],
  });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  expect(table.queryByText(/Of the evaluated/)).toBeNull();
  expect(
    table.queryByText(/Stopped at the limit|earlier attempt|could not be fetched|Covers turns/),
  ).toBeNull();
  expect(table.getByText('6 traces listed: 4 user turns, 2 other traces')).toBeVisible();
});
it('explains why a running job is waiting from progress', async () => {
  setup({
    ...liveWorkerRead,
    jobs: [
      {
        ...liveWorkerRead.jobs[0]!,
        status: 'running',
        updated_at: '2026-01-01T00:00:00Z',
        progress: { waiting: 'worker paused' },
      },
    ],
  });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  expect(table.getByText('Waiting: worker paused')).toBeVisible();
  expect(table.queryByText(/no update for/)).toBeNull();
});
it('shows Queued for an old worker without heartbeat waiting fields', async () => {
  setup({ ...liveWorkerRead, jobs: [{ ...liveWorkerRead.jobs[0]!, status: 'queued', progress: {} }] });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  expect(table.getAllByText('Queued').length).toBeGreaterThan(0);
});
it.each([
  ['failed', 'Dataiku did not answer for 10 minutes; the job stopped after 46 of 91 turns.', false, 'auto'],
  ['cancelled', 'توقف العامل عن الاستجابة وألغيت المهمة.', false, 'rtl'],
  ['failed', 'upstream_error_'.repeat(60), true, 'auto'],
  ['cancelled', 'توقف العامل عن الاستجابة وألغيت المهمة.', true, 'rtl'],
] as const)('shows the job error under its row or card %#', async (status, error, cards, dir) => {
  const matchMedia = window.matchMedia;
  vi.stubGlobal('matchMedia', (query: string) => ({
    ...matchMedia(query),
    matches: cards && query === '(max-width: 639px)',
  }));
  const job = liveWorkerRead.jobs[0]!;
  setup({
    ...liveWorkerRead,
    jobs: [
      { ...job, id: 'job-error', status, error },
      { ...job, id: 'failed-without-error', status: 'failed', error: null },
      { ...job, id: 'cancelled-without-error', status: 'cancelled', error: '' },
      { ...job, id: 'running-with-error', status: 'running', error: 'An earlier error while running' },
      { ...job, id: 'done-with-error', status: 'done', error: 'An earlier error before completion' },
    ],
  });
  const table = await screen.findByRole(cards ? 'list' : 'treegrid', { name: 'Worker jobs' });
  const row = table.querySelector<HTMLElement>('[data-row-key="job-error"]')!;
  const message = within(table).getByText(error);
  expect(message).toBeVisible();
  expect(message).toHaveAttribute('data-tone', 'danger');
  expect(message).toHaveAttribute('dir', dir);
  if (dir === 'rtl') expect(message).toHaveAttribute('lang', 'ar');
  expect(row).not.toContainElement(message);
  expect(row.nextElementSibling).toContainElement(message);
  expect(within(table).queryByRole('button', { name: /Expand row|Collapse row/ })).not.toBeInTheDocument();
  expect(within(table).queryByText('An earlier error while running')).not.toBeInTheDocument();
  expect(within(table).queryByText('An earlier error before completion')).not.toBeInTheDocument();
  if (cards) {
    expect(within(table).getAllByRole('listitem')).toHaveLength(6);
  } else {
    expect(row.querySelector('[data-col="status"]')).toHaveTextContent(
      status === 'failed' ? /^Failed$/ : /^Cancelled$/,
    );
    expect(row.nextElementSibling).toHaveAttribute('data-detail-row');
    expect(row.nextElementSibling?.querySelector('td')).toHaveAttribute('colspan', '10');
    expect(table.querySelectorAll('[data-detail-row]')).toHaveLength(1);
    expect(table.querySelectorAll('[data-row-key]:not([aria-expanded])')).toHaveLength(4);
    act(() => row.focus());
    await userEvent.setup().keyboard('{ArrowLeft}');
    expect(message).toBeVisible();
  }
});
it.each([
  [{ found: 12, skipped_existing: 10 }, '12 turns, 10 already evaluated, 2 to evaluate'],
  [
    {
      found: 50,
      skipped_existing: 10,
      would_evaluate: 20,
      would_redo: 5,
      beyond_limit: 15,
      limit_reached: true,
      remaining: 15,
    },
    '20 to evaluate · 5 to redo · 10 already evaluated · 15 beyond the limit of 25',
  ],
  [
    { found: 10, skipped_existing: 10, would_evaluate: 0, would_redo: 0, beyond_limit: 0 },
    '0 to evaluate · 0 to redo · 10 already evaluated · 0 beyond the limit of 25',
  ],
])('gives preview rows their own summary for %j', async (progress, sentence) => {
  const job = liveWorkerRead.jobs[0]!;
  setup({
    ...liveWorkerRead,
    jobs: [
      {
        ...job,
        kind: 'backfill_preview',
        status: 'done',
        params: { ...job.params, limit: 25, redo: [] },
        progress,
      },
    ],
  });
  const grid = await screen.findByRole('treegrid', { name: 'Worker jobs' });
  const table = within(grid);
  expect(table.getByText(sentence)).toBeVisible();
  expect(grid.querySelector('tbody [data-col="requested_at"]')).toHaveTextContent(sentence);
  expect(grid.querySelector('tbody [data-col="progress"]')).toHaveTextContent(
    `${progress.found} of ${progress.found}`,
  );
  expect(grid.querySelector('tbody [data-col="progress"]')).not.toHaveTextContent(sentence);
  expect(table.getByText('Preview')).toHaveAttribute('title', 'Limit 25 · redo none');
  expect(table.queryByText(/Stopped at the limit/)).toBeNull();
});
it('keeps a zero redone count visible after the job previously reported redos', async () => {
  const job = { ...liveWorkerRead.jobs[0]!, progress: { evaluated: 1, found: 3, redone: 2 } };
  const { client, setRead } = setup({ ...liveWorkerRead, jobs: [job] });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  expect(table.getByText(/2 redone/)).toBeVisible();
  setRead({ ...liveWorkerRead, jobs: [{ ...job, progress: { ...job.progress, redone: 0 } }] });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
  await waitFor(() => expect(table.getByText(/0 redone/)).toBeVisible());
});
it('does not invent a rejection gap when listed equals found', async () => {
  setup({
    ...liveWorkerRead,
    jobs: [
      {
        ...liveWorkerRead.jobs[0]!,
        progress: {
          found: 4,
          listed: 4,
          rejected: { other_names: 0 },
        },
      },
    ],
  });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  expect(table.getByText('4 traces listed')).toBeVisible();
  expect(table.queryByText(/user turns/)).toBeNull();
});
it.each([
  'worker paused',
  'another job is running',
  'waiting for runtime settings',
  "finishing a previous job's report",
])('shows the heartbeat waiting reason only on its queued job: %s', async (reason) => {
  const job = liveWorkerRead.jobs[0]!;
  setup({
    ...liveWorkerRead,
    running: {
      ...liveWorkerRead.running!,
      job: { waiting_reason: reason, blocked_job_id: 'blocked' },
    },
    jobs: [
      { ...job, id: 'blocked', status: 'queued', progress: {} },
      { ...job, id: 'other', status: 'queued', progress: {} },
    ],
  });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  expect(table.getAllByText(`Waiting: ${reason}`)).toHaveLength(1);
  expect(table.getAllByText('Queued')).toHaveLength(3);
});
it.each(['running', 'done', 'failed', 'cancelled'] as const)(
  'ignores a heartbeat queued reason for a %s job',
  async (status) => {
    const job = liveWorkerRead.jobs[0]!;
    setup({
      ...liveWorkerRead,
      running: {
        ...liveWorkerRead.running!,
        job: { waiting_reason: 'worker paused', blocked_job_id: job.id },
      },
      jobs: [{ ...job, status, progress: {} }],
    });
    const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
    expect(table.queryByText('Waiting: worker paused')).toBeNull();
  },
);
it.each([undefined, 0, 3])('shows only positive deferred counts: %s', async (deferred) => {
  setup({
    ...liveWorkerRead,
    jobs: [
      {
        ...liveWorkerRead.jobs[0]!,
        progress: {
          deferred,
          found: 2,
          listed: 9,
          rejected: { other_names: 1, outside_window: 3, duplicate: 2, no_id: 1 },
        },
      },
    ],
  });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  if (deferred) expect(table.getByText('3 left to the live loop (still arriving)')).toBeVisible();
  else expect(table.queryByText(/left to the live loop/)).toBeNull();
  expect(table.getByText('9 traces listed: 2 user turns, 1 other traces')).toBeVisible();
  expect(table.queryByText(/outside_window|duplicate|no_id/)).toBeNull();
});

it.each([false, true])('reports an evaluator trace auth failure when overall verification is %s', (ok) => {
  const read = structuredClone(liveWorkerRead);
  read.running!.verification = {
    ...read.running!.verification!,
    ok,
    checks: {
      'evaluator_traces.auth': { ok: false, latency_ms: null, error: 'Trace authentication failed' },
    },
  };
  expect(fieldStatus('evaluator_traces', read)).toBe('failed');
  expect(failedCheckText('evaluator_traces', read)).toBe('Trace authentication failed');
  expect(fieldStatus('langfuse', read)).toBe('running');
  read.running!.verification.version = 2;
  expect(failedCheckText('evaluator_traces', read)).toBeNull();
});

it('keeps five jobs while an older page loads and handles a short final batch', async () => {
  const jobs = Array.from({ length: 22 }, (_, i) => ({
    ...liveWorkerRead.jobs[0]!,
    id: `job-${i}`,
    requested_by: `Owner ${i}`,
    status: 'done' as const,
  }));
  const { fetch } = setup({ ...liveWorkerRead, jobs });
  const user = userEvent.setup();
  await screen.findByText('Showing 1 to 5 of at least 20 jobs');
  const original = fetch.getMockImplementation()!;
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  fetch.mockImplementation((input, init) => {
    const url = new URL(input, 'http://localhost');
    return url.pathname.endsWith('/worker') && url.searchParams.get('jobs_limit') === '50'
      ? pending
      : original(input, init);
  });
  const pager = within(screen.getByRole('navigation', { name: 'jobs pagination' }));
  await user.click(pager.getByRole('button', { name: 'Last page' }));
  expect(await screen.findByText('Loading older jobs…')).toBeVisible();
  expect(within(screen.getByRole('treegrid', { name: 'Worker jobs' })).getAllByRole('row')).toHaveLength(6);
  expect(screen.getByText('Owner 0')).toBeVisible();
  finish(response({ ...liveWorkerRead, jobs }));
  expect(await screen.findByText('Showing 21 to 22 of 22 jobs')).toBeVisible();
  expect(screen.queryByText('Loading older jobs…')).toBeNull();
  expect(pager.getByRole('button', { name: 'Next page' })).toBeDisabled();
  expect(within(screen.getByRole('treegrid', { name: 'Worker jobs' })).getAllByRole('row')).toHaveLength(3);
  expect(screen.getByText('Owner 21')).toBeVisible();
});
it('shows a re-evaluation as one turn that links to it, and names it as the current job', async () => {
  setup({
    ...liveWorkerRead,
    running: {
      ...liveWorkerRead.running!,
      job: { id: 'job-redo', kind: 'reevaluate', progress: { found: 1, evaluated: 0 } },
    },
    jobs: [
      {
        ...liveWorkerRead.jobs[0]!,
        id: 'job-redo',
        kind: 'reevaluate',
        // A re-evaluation names its turn and has no day range.
        params: { trace_ids: ['turn/2026 0001'], redo: ['all'], limit: 1 } as LiveJob['params'],
        progress: { found: 1, evaluated: 0 },
      },
      liveWorkerRead.jobs[1]!,
    ],
  });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  const kind = table.getByText('Re-evaluation');
  expect(kind).toBeVisible();
  expect(kind).not.toHaveAttribute('title');
  const link = table.getByRole('link', { name: '1 turn' });
  expect(link).toHaveAttribute(
    'href',
    `/projects/demo/live/turns/${encodeURIComponent('turn/2026 0001')}?source=${source}`,
  );
  expect(link).toHaveAttribute('data-link', 'name');
  // The other row keeps its day range.
  expect(table.getByText('Oct 30 – Oct 31')).toBeVisible();
  const strip = within(document.querySelector<HTMLElement>('[data-live-block="worker-status"]')!);
  expect(strip.getByText('Re-evaluation')).toBeVisible();
  expect(strip.queryByText('Backfill')).toBeNull();
});
it('says that more turns exist when the worker stopped listing at the limit', async () => {
  const job = liveWorkerRead.jobs[0]!;
  setup({
    ...liveWorkerRead,
    jobs: [
      {
        ...job,
        status: 'done',
        params: { ...job.params, limit: 20 },
        progress: { found: 20, evaluated: 20, limit_reached: true, listing_stopped_early: true },
      },
    ],
  });
  const table = within(await screen.findByRole('treegrid', { name: 'Worker jobs' }));
  expect(table.getByText('Stopped at the limit of 20. 20 done, more exist.')).toHaveAttribute(
    'data-tone',
    'warning',
  );
  expect(table.queryByText(/still not evaluated/)).toBeNull();
});
