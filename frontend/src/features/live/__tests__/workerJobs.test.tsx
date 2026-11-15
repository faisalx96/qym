import { formatHeaderDate } from '@/lib/dates';
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
  const table = await screen.findByRole('grid', { name: 'Worker jobs' });
  const badge = within(table).getByText(label).closest('[data-shape]');
  expect(badge).toBeVisible();
  expect(badge).toHaveAttribute('data-tone', tone);
  if (status === 'running') {
    const button = within(table).getByRole('button', {
      name: cancel_requested ? 'Cancel requested' : 'Cancel job',
    });
    if (cancel_requested) expect(button).toBeDisabled();
    else expect(button).toBeEnabled();
  }
});
it.each([
  ['running', '2026-11-03T12:18:00Z', 'updated 2m ago', 'muted'],
  ['running', '2026-11-03T12:10:00Z', 'updated 10m ago', 'muted'],
  ['running', '2026-11-03T12:09:59Z', 'no update for 10m ago', 'danger'],
  ['queued', '2026-11-03T12:00:00Z', 'updated 20m ago', 'muted'],
  ['done', '2026-11-03T12:00:00Z', 'updated 20m ago', 'muted'],
  ['failed', '2026-11-03T12:00:00Z', 'updated 20m ago', 'muted'],
  ['cancelled', '2026-11-03T12:00:00Z', 'updated 20m ago', 'muted'],
] as const)('shows job freshness for %s updated at %s', async (status, updated_at, label, tone) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:20:00Z'));
  setup({
    ...liveWorkerRead,
    jobs: [{ ...liveWorkerRead.jobs[0]!, status, requested_at: '2026-11-03T11:20:00Z', updated_at }],
  });
  const table = await screen.findByRole('grid', { name: 'Worker jobs' });
  const requested = within(table).getByText('1h ago');
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
  await user.click(await screen.findByRole('button', { name: 'Cancel job' }));
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
  [{}, '0 evaluated · 0 failed · 0 already evaluated · 0 turns in the range', undefined],
  [
    { evaluated: 4, found: 8, skipped_existing: 0, redone: 0, failed: 0, listed: 0 },
    '4 evaluated · 0 failed · 0 already evaluated · 8 turns in the range',
    '0 traces listed',
  ],
  [
    { evaluated: 4, found: 10, skipped_existing: 3, redone: 2, failed: 1, listed: 20 },
    '4 evaluated · 2 redone · 1 failed · 3 already evaluated · 10 turns in the range',
    '20 traces listed',
  ],
] as const)('explains progress counters for %j', async (progress, label, listed) => {
  setup({ ...liveWorkerRead, jobs: [{ ...liveWorkerRead.jobs[0]!, progress }] });
  const table = await screen.findByRole('grid', { name: 'Worker jobs' });
  expect(within(table).getByText(label)).toBeVisible();
  if (listed) expect(within(table).getByText(listed)).toBeVisible();
  else expect(within(table).queryByText(/traces listed/)).toBeNull();
});
it.each([
  [['failed'], null],
  [['failed', 'inconclusive'], 'redo inconclusive'],
  [['all'], 'redo all'],
] as const)('labels redo params %j', async (redo, label) => {
  const job = liveWorkerRead.jobs[0]!;
  setup({ ...liveWorkerRead, jobs: [{ ...job, params: { ...job.params, redo: [...redo] } }] });
  const table = await screen.findByRole('grid', { name: 'Worker jobs' });
  if (label) expect(within(table).getByText(label)).toBeVisible();
  expect(within(table).getByText(`Limit 200 · redo ${redo.join(', ')}`)).toBeVisible();
});
it('requests older jobs at 20, 50, 100 and 200 and stops at the maximum', async () => {
  const jobs = Array.from({ length: 200 }, (_, i) => ({
    ...liveWorkerRead.jobs[0]!,
    id: `job-${i}`,
    status: 'done' as const,
  }));
  const { fetch } = setup({ ...liveWorkerRead, jobs });
  const user = userEvent.setup();
  for (const limit of [20, 50, 100, 200]) {
    expect(await screen.findByText(`Newest ${limit} jobs`)).toBeVisible();
    expect(
      fetch.mock.calls.some(([input]) => {
        const url = new URL(input, 'http://localhost');
        return url.pathname.endsWith('/worker') && url.searchParams.get('jobs_limit') === String(limit);
      }),
    ).toBe(true);
    if (limit < 200) await user.click(screen.getByRole('button', { name: 'Show older jobs' }));
  }
  expect(screen.queryByRole('button', { name: 'Show older jobs' })).toBeNull();
});
it.each([20, 50])('keeps the page and draft when loading jobs beyond %i fails', async (limit) => {
  const jobs = Array.from({ length: 100 }, (_, i) => ({
    ...liveWorkerRead.jobs[0]!,
    id: `job-${i}`,
    status: 'done' as const,
  }));
  const { fetch, client } = setup({ ...liveWorkerRead, jobs });
  const user = userEvent.setup();
  await screen.findByText('Newest 20 jobs');
  if (limit === 50) {
    await user.click(screen.getByRole('button', { name: 'Show older jobs' }));
    await screen.findByText('Newest 50 jobs');
  }
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Unsaved note');
  const table = screen.getByRole('grid', { name: 'Worker jobs' });
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation((input, init) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('/worker') && Number(url.searchParams.get('jobs_limit')) > limit)
      return Promise.resolve(response({ detail: 'Older jobs unavailable' }, 500));
    return original(input, init);
  });
  await user.click(screen.getByRole('button', { name: 'Show older jobs' }));
  expect(await screen.findByText(/Couldn’t load older jobs/)).toBeVisible();
  expect(screen.getByRole('grid', { name: 'Worker jobs' })).toBe(table);
  expect(screen.getByText(`Newest ${limit} jobs`)).toBeVisible();
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
it('hides older jobs when fewer than the current limit are returned', async () => {
  setup({ ...liveWorkerRead, jobs: [] });
  expect(await screen.findByText('No jobs yet')).toBeVisible();
  expect(screen.queryByText(/Newest \d+ jobs/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show older jobs' })).toBeNull();
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
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
  expect(
    table.getByText(
      '6 evaluated · 2 redone · 1 failed · 4 already evaluated · 30 turns in the range · 3 from an earlier attempt · 1 could not be fetched, will be retried by the next backfill',
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
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
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
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
  expect(table.getByText('Waiting: worker paused')).toBeVisible();
  expect(table.queryByText(/no update for/)).toBeNull();
});
it('shows Queued for an old worker without heartbeat waiting fields', async () => {
  setup({ ...liveWorkerRead, jobs: [{ ...liveWorkerRead.jobs[0]!, status: 'queued', progress: {} }] });
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
  expect(table.getAllByText('Queued').length).toBeGreaterThan(0);
});
it('shows the reason for cancelling an unresponsive worker job', async () => {
  setup({
    ...liveWorkerRead,
    jobs: [
      {
        ...liveWorkerRead.jobs[0]!,
        status: 'cancelled',
        error: 'cancelled while the worker was not responding',
      },
    ],
  });
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
  expect(table.getByText('cancelled while the worker was not responding')).toBeVisible();
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
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
  expect(table.getByText(sentence)).toBeVisible();
  expect(table.getByText('Limit 25 · redo none')).toBeVisible();
  expect(table.queryByText(/Stopped at the limit/)).toBeNull();
});
it('keeps a zero redone count visible after the job previously reported redos', async () => {
  const job = { ...liveWorkerRead.jobs[0]!, progress: { evaluated: 1, found: 3, redone: 2 } };
  const { client, setRead } = setup({ ...liveWorkerRead, jobs: [job] });
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
  expect(table.getByText(/1 evaluated · 2 redone/)).toBeVisible();
  setRead({ ...liveWorkerRead, jobs: [{ ...job, progress: { ...job.progress, redone: 0 } }] });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
  await waitFor(() => expect(table.getByText(/1 evaluated · 0 redone/)).toBeVisible());
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
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
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
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
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
    const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
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
  const table = within(await screen.findByRole('grid', { name: 'Worker jobs' }));
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
