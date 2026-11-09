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
  liveWorkerPaused,
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
    if (url.pathname.endsWith('/worker'))
      return response({
        ...current,
        jobs: current.jobs.slice(0, Number(url.searchParams.get('jobs_limit') ?? 20)),
      });
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

async function openField(section: string, label: string) {
  const region = await screen.findByRole('region', { name: section });
  const trigger = within(region).getByRole('button', { name: new RegExp(`^${section} `) });
  if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.setup().click(trigger);
  return within(region).getByLabelText(label);
}

it('renders status, problems, jobs and settings in the specified DOM order', async () => {
  const { container } = setup();
  await screen.findByRole('button', { name: 'Save as v4' });
  expect(
    [
      ...container.querySelectorAll('[data-live-block^="worker-"]:not([data-live-block="worker-history"])'),
    ].map((node) => node.getAttribute('data-live-block')),
  ).toEqual(['worker-status', 'worker-problems', 'worker-jobs', 'worker-settings']);
  expect(screen.getByText('Running v3')).toBeVisible();
  expect(await openField('Models', 'Judge A')).toHaveAttribute('list');
});
it('shows waiting state, key warning and waiting section tags', async () => {
  setup(liveWorkerWaiting);
  expect(await screen.findByText('Waiting')).toBeVisible();
  expect(screen.getByText('no settings version')).toBeVisible();
  expect(screen.getAllByText('waiting for version 1')).toHaveLength(5);
  expect(screen.getByText('Choose the worker key before saving settings')).toBeVisible();
});
it('shows the status strip values and matching job update from the fixture', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T14:22:00Z'));
  setup();
  const status = await screen.findByRole('region', { name: 'Worker status' });
  expect(within(status).getByText('Running v3')).toBeVisible();
  expect(within(status).getByText('since 14:20 UTC by Ali')).toBeVisible();
  expect(within(status).getByText('3m ago')).toBeVisible();
  expect(within(status).getByText('every 60 s')).toBeVisible();
  expect(within(status).getByText('14:18 UTC')).toBeVisible();
  expect(within(status).getByText('47 today, 44 evaluated')).toBeVisible();
  const problems = within(status).getByRole('link', { name: '19 problems in the last hour' });
  expect(problems).toHaveAttribute('href', '/projects/demo/live/worker?source=worker#problems');
  expect(within(problems).getByText('19')).toHaveAttribute('data-tone', 'warning');
  expect(within(status).getByText('Backfill · 12 of 22 turns')).toBeVisible();
  expect(within(status).getByText('updated 2m ago')).toBeVisible();
});
it('uses the poll timestamp before the heartbeat and marks a stale worker', async () => {
  setup({
    ...liveWorkerRead,
    stale: true,
    status: { ...liveWorkerRead.status, stale: true, last_poll_at: '2026-11-03T15:19:00+01:00' },
    running: { ...liveWorkerRead.running!, reason: 'verifying version 4', job: null },
  });
  const status = await screen.findByRole('region', { name: 'Worker status' });
  expect(within(status).getByText('not reporting since 14:19 UTC')).toHaveAttribute('data-tone', 'danger');
  expect(within(status).getByText('verifying version 4')).toBeVisible();
  expect(within(status).getByText('none')).toBeVisible();
});
it('falls back to the heartbeat when the worker has no poll timestamp', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T14:22:00Z'));
  setup({ ...liveWorkerRead, status: { ...liveWorkerRead.status, last_poll_at: null } });
  const status = await screen.findByRole('region', { name: 'Worker status' });
  expect(within(status).getByText('2m ago')).toHaveAttribute(
    'title',
    liveWorkerRead.status.last_heartbeat_at,
  );
});
it('resumes a paused worker through the state endpoint', async () => {
  const { fetch } = setup(liveWorkerPaused);
  const user = userEvent.setup();
  expect(await screen.findByText('Paused v3')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Resume evaluation' }));
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(writes(fetch)[0]![0]).toContain('/state?source=');
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({ state: 'running' });
});
it('collapses settings with current summaries and disables Save until values or secrets change', async () => {
  setup();
  const user = userEvent.setup();
  const save = await screen.findByRole('button', { name: 'Save as v4' });
  expect(save).toBeDisabled();
  expect(screen.getByText('No changes since v3', { selector: 'p' })).toBeVisible();
  const evaluation = screen.getByRole('region', { name: 'Evaluation' });
  const trigger = within(evaluation).getByRole('button');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveTextContent(
    'Chart vision on · Dataiku replay on · 3 lanes · poll 60 s · lookback 1 h',
  );
  expect(screen.getByText('gateway listed 5 models at 14:20 UTC')).toBeVisible();
  expect(screen.getByText('v3 · running')).toHaveAttribute('data-tone', 'success');
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'A note alone');
  expect(save).toBeDisabled();
  await user.click(trigger);
  await user.click(within(evaluation).getByRole('switch', { name: 'Chart vision' }));
  expect(trigger).toHaveTextContent('differs from running v3 · Chart vision off');
  expect(save).toBeEnabled();
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await user.click(within(evaluation).getByRole('switch', { name: 'Chart vision' }));
  expect(save).toBeDisabled();
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'replacement');
  expect(save).toBeEnabled();
  expect(within(screen.getByRole('region', { name: 'Langfuse' })).getByRole('button')).not.toHaveTextContent(
    'differs from running',
  );
});
it('keeps a draft matching running collapsed while enabling Save against the latest version', async () => {
  const view = setup();
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Note' }), 'Keep this note');
  await refetchWorker(view, liveWorkerPending);
  const save = await screen.findByRole('button', { name: 'Save as v5' });
  const database = screen.getByRole('region', { name: 'Database' });
  const trigger = within(database).getByRole('button', { name: /^Database / });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).not.toHaveTextContent('differs from running');
  expect(save).toBeEnabled();
});
it('opens a saved section that differs from running while disabling Save for unchanged values', async () => {
  const view = setup(liveWorkerPending);
  const database = await screen.findByRole('region', { name: 'Database' });
  const trigger = within(database).getByRole('button', { name: /^Database / });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).toHaveTextContent('differs from running v3 ·');
  expect(screen.getByRole('button', { name: 'Save as v5' })).toBeDisabled();
  expect(screen.getByText('No changes since v4', { selector: 'p' })).toBeVisible();
  await refetchWorker(view, {
    ...liveWorkerPending,
    running: {
      ...liveWorkerPending.running!,
      settings_version_applied: 4,
      running: liveWorkerPending.settings!.values,
    },
  });
  await waitFor(() => expect(trigger).not.toHaveTextContent('differs from running'));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
it('opens failed verification without a difference prefix when values match running', async () => {
  setup({
    ...liveWorkerRead,
    running: {
      ...liveWorkerRead.running!,
      verification: { ...liveWorkerFailed.running!.verification!, version: 3 },
    },
  });
  const database = await screen.findByRole('region', { name: 'Database' });
  const trigger = within(database).getByRole('button', { name: /^Database / });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).not.toHaveTextContent('differs from running');
  expect(trigger).not.toHaveTextContent('changed ·');
  expect(within(database).getByText(/could not translate host name/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save as v4' })).toBeDisabled();
});
it('has no running difference prefix when the worker has no running settings', async () => {
  setup(liveWorkerWaiting);
  const user = userEvent.setup();
  await user.type(await openField('Database', 'Database host'), 'new.example.com');
  expect(
    within(screen.getByRole('region', { name: 'Database' })).getByRole('button', { name: /^Database / }),
  ).not.toHaveTextContent('differs from running');
  expect(screen.getByRole('button', { name: 'Save as v1' })).toBeEnabled();
});
it('shows plain problem labels and opens the section targeted by a Fix link', async () => {
  const route = '/projects/demo/live/worker?source=worker+%26+prod&view=all';
  const view = setup(liveWorkerRead, undefined, [route]);
  await screen.findByRole('button', { name: 'Save as v4' });
  act(() => {
    view.client.setQueryData(['project', 'demo', 'live', 'worker-events', source, { page: 1, limit: 10 }], {
      events: [
        {
          ...liveWorkerEvents[0]!,
          component: 'control',
          message: '[LIVE] Checks failed',
          details: { checks: { 'gateway.models': { ok: false } } },
        },
      ],
    });
  });
  const problems = document.getElementById('problems')!;
  for (const label of ['All', 'Settings', 'Judges', 'Dataiku', 'Delivery to qym', 'Turns', 'Jobs'])
    expect(within(problems).getByRole('button', { name: label })).toBeVisible();
  expect(await within(problems).findByText('Checks failed')).toBeVisible();
  expect(within(problems).getByText('gateway.models')).toBeVisible();
  const link = within(problems).getByRole('link', { name: 'Fix in Models' });
  expect(link).toHaveAttribute('href', `${route}#settings-models`);
  await userEvent.setup().click(link);
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Models' })).getByRole('button', {
        name: /^Models /,
      }),
    ).toHaveAttribute('aria-expanded', 'true'),
  );
  expect(screen.getByLabelText('Judge A')).toBeVisible();
  expect(screen.getByRole('link', { name: '19 problems in the last hour' })).toHaveAttribute(
    'href',
    `${route}#problems`,
  );
});
it.each([
  ['2026-11-04', '2026-11-04', '4 Nov'],
  ['2026-11-03', '2026-11-04', '3 Nov to 4 Nov'],
])('shows readable job days %s to %s', async (since_day, until_day, label) => {
  const job = liveWorkerRead.jobs[0]!;
  setup({ ...liveWorkerRead, jobs: [{ ...job, params: { ...job.params, since_day, until_day } }] });
  expect(within(await screen.findByRole('grid', { name: 'Worker jobs' })).getByText(label)).toBeVisible();
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
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'new-secret');
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Rotate Langfuse');
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
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
  const host = await openField('Database', 'Database host');
  await user.clear(host);
  await user.type(host, 'draft.example.com');
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'draft-secret');
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
  await user.type(
    await (label === 'Note' ? screen.findByRole('textbox', { name: 'Note' }) : openField('Langfuse', label)),
    'Draft',
  );
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
  await openField('Database', 'Database host');
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
  const host = await openField('Database', 'Database host');
  await user.clear(host);
  await user.type(host, liveWorkerPending.settings!.values.database.host);
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'New host');
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
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
    await screen.findByRole('button', { name: 'Save as v4' });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
    expect(scrollIntoView.mock.contexts).toContain(document.getElementById('problems'));
  } finally {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});
it('keeps the route and query and scrolls when the strip problems link is clicked', async () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  try {
    const route = '/projects/demo/live/worker?source=worker+%26+prod&view=all';
    setup(liveWorkerRead, undefined, [route]);
    const link = await screen.findByRole('link', { name: '19 problems in the last hour' });
    expect(link).toHaveAttribute('href', `${route}#problems`);
    await userEvent.setup().click(link);
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
  await screen.findByRole('button', { name: 'Save as v4' });
  const row = screen.getByText('v2').closest('li')!;
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
  await user.click(await screen.findByRole('button', { name: 'Pause evaluation' }));
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
  await user.click((await screen.findAllByRole('button', { name: 'Backfill a day range' }))[0]!);
  return user;
}
it('opens the same date range dialog from the Jobs block', async () => {
  setup();
  const buttons = await screen.findAllByRole('button', { name: 'Backfill a day range' });
  await userEvent.setup().click(buttons[1]!);
  expect(screen.getByRole('dialog', { name: 'Backfill a day range' })).toBeVisible();
});
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
it.each([undefined, 0, 30])('previews without redo and displays listed=%s after refetch', async (listed) => {
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
  await user.click(screen.getByRole('checkbox', { name: 'Also redo turns labelled Inconclusive' }));
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
    jobs: [{ ...job, status: 'done', progress: { found: 22, skipped_existing: 2, listed } }],
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
  expect(
    await screen.findByText(
      `22 turns, 2 already evaluated, 20 to evaluate${listed === undefined ? '' : ` (${listed} traces listed)`}`,
    ),
  ).toBeVisible();
});
it.each([false, true])('queues a backfill with redo inconclusive=%s, closes and toasts', async (redo) => {
  const { fetch } = setup(liveWorkerRead, () => response(liveWorkerRead.jobs[0], 201));
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  const checkbox = screen.getByRole('checkbox', { name: 'Also redo turns labelled Inconclusive' });
  expect(checkbox).not.toBeChecked();
  if (redo) await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: 'Run' }));
  expect(await screen.findByText('Backfill queued')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({
    kind: 'backfill',
    since_day: '2026-01-01',
    until_day: '2026-01-02',
    limit: 200,
    redo: redo ? ['failed', 'inconclusive'] : ['failed'],
  });
});

it.each([
  [{}, '0 / 0 turns evaluated, 0 failed', undefined],
  [
    { evaluated: 4, found: 8, skipped_existing: 0, redone: 0, failed: 0, listed: 0 },
    '4 / 8 turns evaluated, 0 failed',
    '0 traces listed',
  ],
  [
    { evaluated: 4, found: 8, skipped_existing: 3, redone: 2, failed: 1, listed: 20 },
    '4 / 8 turns evaluated, 3 already evaluated, 2 redone, 1 failed',
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
  else expect(within(table).queryByText(/^redo /)).toBeNull();
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
  expect(new URL(String(fetch.mock.calls[0]?.[0]), 'http://localhost').searchParams.has('jobs_limit')).toBe(
    false,
  );
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

it('uses the worker read zone for status and settings times', async () => {
  setup({
    ...liveWorkerRead,
    stale: true,
    status: { ...liveWorkerRead.status, stale: true, day_key_timezone: 'Asia/Riyadh' },
  });
  const status = await screen.findByRole('region', { name: 'Worker status' });
  expect(within(status).getByText('since 17:20 Riyadh by Ali')).toBeVisible();
  expect(within(status).getByText('not reporting since 17:19 Riyadh')).toBeVisible();
  expect(within(status).getByText('17:18 Riyadh')).toBeVisible();
  expect(screen.getByText('gateway listed 5 models at 17:20 Riyadh')).toBeVisible();
});

it.each([
  ['Asia/Riyadh', true],
  ['UTC', false],
  [undefined, false],
  ['Invalid/Zone', false],
])('validates the range against the worker source today (%s)', async (zone, allowed) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T22:30:00Z'));
  const { fetch } = setup(
    { ...liveWorkerRead, status: { ...liveWorkerRead.status, day_key_timezone: zone } },
    () => response(liveWorkerRead.jobs[0], 201),
  );
  const user = await openRange();
  dates('2026-11-10', '2026-11-10');
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  if (allowed) {
    await waitFor(() => expect(writes(fetch)).toHaveLength(1));
    expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toMatchObject({
      since_day: '2026-11-10',
      until_day: '2026-11-10',
    });
    expect(screen.queryByText('The end day is in the future')).toBeNull();
    dates('2026-11-11', '2026-11-11');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The end day is in the future');
    expect(writes(fetch)).toHaveLength(1);
  } else {
    expect(screen.getByRole('alert')).toHaveTextContent('The end day is in the future');
    expect(writes(fetch)).toHaveLength(0);
  }
});
