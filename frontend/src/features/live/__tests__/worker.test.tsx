import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fieldStatus,
  failedCheckText,
  useLiveWorker,
  validateDateRange,
  workerDefaults,
  type LiveJob,
  type LiveWorkerRead,
} from '@/api/liveWorker';
import {
  liveOverview,
  liveWorkerRead,
  liveWorkerWaiting,
  liveWorkerPending,
  liveWorkerFailed,
  liveWorkerEvents,
} from '@/features/dev/liveFixtures';
import { ToastProvider } from '@/ui';
import { LiveWorkerPage } from '../LiveWorkerPage';

vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));
const clients: QueryClient[] = [];
const source = liveOverview.status.key;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function setup(
  read = liveWorkerRead,
  write?: (url: URL, body: Record<string, unknown>) => Response | Promise<Response>,
  initialEntries = ['/projects/demo/live/worker?source=worker'],
) {
  let current = structuredClone(read);
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method && init.method !== 'GET') {
      expect(url.searchParams.get('source')).toBe(source);
      return (
        write?.(url, init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}) ??
        response({ version: 4 })
      );
    }
    if (url.pathname.endsWith('/events')) return response({ events: liveWorkerEvents });
    if (url.pathname.endsWith('/worker')) return response(current);
    return response({ sources: [liveOverview.status], default_source: source });
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <ToastProvider>
          <LiveWorkerPage slug="demo" source={source} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    fetch,
    setRead: (value: LiveWorkerRead) => {
      current = value;
    },
  };
}
const writes = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls.filter(([, init]) => init?.method !== 'GET');
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('renders the six blocks in the specified DOM order', async () => {
  const { container } = setup();
  await screen.findByRole('button', { name: 'Save' });
  expect(
    [...container.querySelectorAll('[data-live-block^="worker-"]')].map((node) =>
      node.getAttribute('data-live-block'),
    ),
  ).toEqual([
    'worker-state',
    'worker-settings',
    'worker-history',
    'worker-jobs',
    'worker-problems',
    'worker-models',
  ]);
  expect(screen.getByText('running v3 since 14:20')).toBeVisible();
  expect(screen.getByLabelText('Judge A')).toHaveAttribute('list');
});
it('shows waiting state, key warning and waiting section tags', async () => {
  setup(liveWorkerWaiting);
  expect(await screen.findByText('Waiting: no settings version')).toBeVisible();
  expect(screen.getAllByText('waiting for version 1')).toHaveLength(5);
  expect(screen.getByText('Choose the worker key before saving settings')).toBeVisible();
});
it.each([
  [liveWorkerPending, 'pending'],
  [liveWorkerFailed, 'failed'],
] as const)('shows verification state %#', async (read, status) => {
  setup(read);
  expect((await screen.findAllByText(status)).length).toBeGreaterThan(0);
  if (status === 'failed') expect(screen.getByText(/could not translate host name/)).toBeVisible();
});
it('posts values, only the typed secret and note, then clears secrets and toasts the version', async () => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Langfuse secret key'), 'new-secret');
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Rotate Langfuse');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved as version 4')).toBeVisible();
  const [url, init] = writes(fetch)[0]!;
  expect(new URL(url, 'http://localhost').pathname).toBe('/api/projects/demo/live/worker/settings');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({
    values: liveWorkerRead.settings!.values,
    secrets: { langfuse_secret_key: 'new-secret' },
    note: 'Rotate Langfuse',
  });
  expect(screen.getByLabelText('Langfuse secret key')).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
});
async function refetchWorker(view: ReturnType<typeof setup>, read: LiveWorkerRead) {
  view.setRead(read);
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
}
it('preserves the draft on a new version and loads it only when requested', async () => {
  const view = setup();
  const user = userEvent.setup();
  const host = await screen.findByLabelText('Database host');
  await user.clear(host);
  await user.type(host, 'draft.example.com');
  await user.type(screen.getByLabelText('Langfuse secret key'), 'draft-secret');
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Draft note');
  await refetchWorker(view, liveWorkerPending);
  expect(await screen.findByText('Version 4 was saved by Ali while you were editing')).toBeVisible();
  expect(screen.getByLabelText('Database host')).toHaveValue('draft.example.com');
  expect(screen.getByLabelText('Langfuse secret key')).toHaveValue('draft-secret');
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Draft note');
  await user.click(screen.getByRole('button', { name: 'Load version 4' }));
  expect(screen.getByLabelText('Database host')).toHaveValue(
    liveWorkerPending.settings!.values.database.host,
  );
  expect(screen.getByLabelText('Langfuse secret key')).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
  expect(screen.queryByText(/while you were editing/)).toBeNull();
});
it.each(['Langfuse secret key', 'Note'])('keeps a draft with only %s changed', async (label) => {
  const view = setup();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(label, { selector: 'input' }), 'Draft');
  await refetchWorker(view, liveWorkerPending);
  expect(await screen.findByText('Version 4 was saved by Ali while you were editing')).toBeVisible();
  expect(screen.getByLabelText(label, { selector: 'input' })).toHaveValue('Draft');
  await user.click(screen.getByRole('button', { name: 'Keep my draft' }));
  expect(screen.queryByText(/while you were editing/)).toBeNull();
  await refetchWorker(view, { ...liveWorkerPending, stale: true });
  expect(screen.queryByText(/while you were editing/)).toBeNull();
  expect(screen.getByLabelText(label, { selector: 'input' })).toHaveValue('Draft');
});
it('loads a new version silently when the form is not dirty', async () => {
  const view = setup();
  await screen.findByLabelText('Database host');
  await refetchWorker(view, liveWorkerPending);
  await waitFor(() =>
    expect(screen.getByLabelText('Database host')).toHaveValue(
      liveWorkerPending.settings!.values.database.host,
    ),
  );
  expect(screen.queryByText(/while you were editing/)).toBeNull();
});
it('reinitialises the form after saving so the next version loads silently', async () => {
  const view = setup(liveWorkerRead, () => {
    view.setRead(liveWorkerPending);
    return response({ version: 4 });
  });
  const user = userEvent.setup();
  const host = await screen.findByLabelText('Database host');
  await user.clear(host);
  await user.type(host, liveWorkerPending.settings!.values.database.host);
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'New host');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved as version 4')).toBeVisible();
  expect(screen.queryByText(/while you were editing/)).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
  await refetchWorker(view, {
    ...liveWorkerRead,
    settings: { ...liveWorkerRead.settings!, version: 5 },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Database host')).toHaveValue(liveWorkerRead.settings!.values.database.host),
  );
  expect(screen.queryByText(/while you were editing/)).toBeNull();
});
it('scrolls to problems after the worker data loads for a hash link', async () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  try {
    setup(liveWorkerRead, undefined, ['/projects/demo/live/worker?source=worker#problems']);
    await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
    expect(scrollIntoView.mock.contexts).toContain(document.getElementById('problems'));
  } finally {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});
it('confirms restoring version 2 and posts the restore endpoint', async () => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Save' });
  const row = screen.getByText('v2').closest('tr')!;
  await user.click(within(row).getByRole('button', { name: 'Restore' }));
  expect(screen.getByRole('dialog', { name: 'Restore version 2?' })).toBeVisible();
  expect(writes(fetch)).toHaveLength(0);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(writes(fetch)[0]![0]).toContain('/settings/2/restore?source=');
});
it('confirms pausing, then PUTs paused', async () => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('switch', { name: 'Running' }));
  expect(screen.getByRole('dialog', { name: 'Pause evaluation?' })).toBeVisible();
  expect(writes(fetch)).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(writes(fetch)[0]![1]?.method).toBe('PUT');
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({ state: 'paused' });
});
it('PUTs the selected worker key', async () => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Worker key/ }));
  await user.click(screen.getByRole('option', { name: /Replacement worker/ }));
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(writes(fetch)[0]![0]).toContain('/key?source=');
  expect(writes(fetch)[0]![1]?.method).toBe('PUT');
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({ api_key_id: 'key-next' });
});
async function openRange() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Evaluate a date range' }));
  return user;
}
function dates(since: string, until: string) {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: since } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: until } });
}
it.each([
  ['2026-01-01', '2026-02-02', 'At most 31 days per job'],
  ['2099-01-01', '2099-01-01', 'The end day is in the future'],
  ['2026-01-02', '2026-01-01', 'The end day is before the start day'],
  ['', '', 'Choose both days'],
])('validates dates without requests: %s to %s', async (since, until, message) => {
  const { fetch } = setup();
  const user = await openRange();
  dates(since, until);
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(writes(fetch)).toHaveLength(0);
});
it('validates limit without sending a request', async () => {
  const { fetch } = setup();
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  const limit = screen.getByRole('textbox', { name: 'Limit' });
  await user.clear(limit);
  await user.type(limit, '2001');
  await user.tab();
  await user.click(screen.getByRole('button', { name: 'Run' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Limit must be 1 to 2,000');
  expect(writes(fetch)).toHaveLength(0);
});
it('previews and displays the result when the next refetch completes the job', async () => {
  const job: LiveJob = {
    ...liveWorkerRead.jobs[0]!,
    id: 'preview-new',
    kind: 'backfill_preview',
    status: 'queued',
    params: { ...liveWorkerRead.jobs[0]!.params, since_day: '2026-01-01', until_day: '2026-01-02' },
    progress: {},
  };
  const { fetch, client, setRead } = setup(liveWorkerRead, () => response(job, 201));
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByText('Preview queued')).toBeVisible();
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({
    kind: 'backfill_preview',
    since_day: '2026-01-01',
    until_day: '2026-01-02',
    limit: 200,
  });
  setRead({
    ...liveWorkerRead,
    jobs: [{ ...job, status: 'done', progress: { found: 22, skipped_existing: 2 } }],
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
  expect(await screen.findByText('22 chats, 2 already evaluated, 20 to evaluate')).toBeVisible();
});
it('queues a backfill, closes the dialog and toasts', async () => {
  const { fetch } = setup(liveWorkerRead, () => response(liveWorkerRead.jobs[0], 201));
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  await user.click(screen.getByRole('button', { name: 'Run' }));
  expect(await screen.findByText('Backfill queued')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body)).kind).toBe('backfill');
});
it.each([
  ['running', true, 'cancelling', 'warning'],
  ['running', false, 'running', 'accent'],
  ['cancelled', true, 'cancelled', undefined],
] as const)('shows job status %s with cancel_requested=%s', async (status, cancel_requested, label, tone) => {
  setup({
    ...liveWorkerRead,
    jobs: [{ ...liveWorkerRead.jobs[0]!, status, cancel_requested }],
  });
  const table = await screen.findByRole('grid', { name: 'Worker jobs' });
  const badge = within(table).getByText(label);
  expect(badge).toBeVisible();
  if (tone) expect(badge).toHaveAttribute('data-tone', tone);
  else expect(badge).not.toHaveAttribute('data-tone');
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
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  const dialog = screen.getByRole('dialog', { name: 'Cancel job?' });
  expect(writes(view.fetch)).toHaveLength(0);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel job' }));
  expect(await screen.findByText('cancelling')).toHaveAttribute('data-tone', 'warning');
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
  await user.click(await screen.findByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByLabelText('Database host')).toHaveAttribute('aria-invalid', 'true'));
  expect(screen.getByLabelText('Database host')).toHaveAccessibleDescription('Database host is invalid');
  expect(screen.getByLabelText('Langfuse host')).not.toHaveAttribute('aria-invalid', 'true');
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
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Save' }));
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
it('reserves six skeleton frames and shows a failed load with retry', async () => {
  const { fetch, container } = setup();
  expect(container.querySelectorAll('[data-live-loading] [role="status"]')).toHaveLength(6);
  await screen.findByRole('button', { name: 'Save' });
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
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Database host')).toHaveAccessibleDescription('Database host is invalid'),
  );
  expect(screen.getByLabelText('Langfuse host')).toHaveAccessibleDescription('Langfuse host is invalid');
  expect(screen.getByLabelText('Dataiku database')).toHaveAccessibleDescription(
    'Dataiku database is invalid',
  );
  expect(screen.getByLabelText('Database name')).not.toHaveAttribute('aria-invalid', 'true');
});
