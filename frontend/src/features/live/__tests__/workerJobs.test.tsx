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
  ['running', true, 'Cancelling', 'warning'],
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
    'warning',
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
  const fetch = vi.fn(async () => response(read));
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
  expect(screen.getByLabelText('Langfuse host')).toHaveAccessibleDescription('Langfuse host is invalid');
  expect(screen.getByLabelText('Dataiku database')).toHaveAccessibleDescription(
    'Dataiku database is invalid',
  );
  expect(screen.getByLabelText('Database name')).not.toHaveAttribute('aria-invalid', 'true');
});
