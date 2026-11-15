import { useState } from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import {
  problemReport,
  useLiveWorkerEvents,
  type LiveWorkerEvent,
  type WorkerEventsFilters,
} from '@/api/liveWorker';
import { liveOverview, liveTurnDetail, liveWorkerEvents, liveWorkerRead } from '@/features/dev/liveFixtures';
import { ProblemsBlock } from '../components/worker/ProblemsBlock';
import { StatusLine } from '../components/StatusLine';
import { TurnHeader } from '../components/turn/TurnHeader';
import { ToastProvider } from '@/ui';
import { LiveWorkerPage } from '../LiveWorkerPage';

vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function paginatedProblems(
  total: number | undefined,
  respond?: (params: URLSearchParams) => unknown | Promise<unknown>,
  staleTime = 0,
) {
  const requests: URLSearchParams[] = [];
  const events = Array.from({ length: total ?? 10 }, (_, i) => ({
    ...liveWorkerEvents[0]!,
    id: i + 1,
    component: 'gateway',
    level: 'error' as const,
    message: `Problem ${i + 1}`,
    last_at: new Date(Date.UTC(2026, 10, 9, 12, 0, 60 - i)).toISOString(),
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname.endsWith('/events')) {
        requests.push(url.searchParams);
        const page = Number(url.searchParams.get('page') ?? 1);
        return new Response(
          JSON.stringify(
            respond
              ? await respond(url.searchParams)
              : {
                  events: events.slice((page - 1) * 10, page * 10),
                  ...(total === undefined ? {} : { total, page, limit: 10 }),
                },
          ),
        );
      }
      return new Response(
        JSON.stringify(
          url.pathname.endsWith('/worker') ? liveWorkerRead : { sources: [liveOverview.status] },
        ),
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime } } });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <LiveWorkerPage slug="demo" source="worker" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, requests, client };
}

it.each([0, 10, 11, undefined])(
  'requests ten problems and only paginates a known total above ten: %s',
  async (total) => {
    const { requests } = paginatedProblems(total);
    await screen.findByRole('heading', { name: 'Problems' });
    if (total === 0) await screen.findByText('No problems reported by the worker');
    else await screen.findByText('Problem 1');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.get('limit')).toBe('10');
    expect(requests[0]!.get('page')).toBe('1');
    if (total !== undefined && total > 10) {
      expect(await screen.findByRole('navigation', { name: 'problems pagination' })).toBeVisible();
      expect(screen.getByText('1–10 of 11 problems')).toBeVisible();
    } else {
      expect(screen.queryByRole('navigation', { name: 'problems pagination' })).toBeNull();
    }
  },
);

it.each(['Gateway', 'Errors'])(
  'requests the next page and resets to page one on the %s filter',
  async (filter) => {
    const { requests } = paginatedProblems(25);
    const user = userEvent.setup();
    await screen.findByText('Problem 1');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Problem 11');
    expect(requests.at(-1)!.get('page')).toBe('2');
    expect(screen.getByText('11–20 of 25 problems')).toBeVisible();
    await user.click(
      screen.getByRole('button', {
        name: `${filter === 'Errors' || filter === 'Warnings' ? 'Level' : 'Component'} filter`,
      }),
    );
    await user.click(screen.getByRole('button', { name: `Only ${filter}` }));
    await user.keyboard('{Escape}');
    await screen.findByText('Problem 1');
    expect(requests.at(-1)!.get('page')).toBe('1');
    expect(requests.at(-1)!.get(filter === 'Gateway' ? 'component' : 'level')).toBe(
      filter === 'Gateway' ? 'gateway' : 'error',
    );
  },
);

it('keeps the previous problems visible while the next page loads', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { requests } = paginatedProblems(20, (params) =>
    params.get('page') === '2' ? pending : { events: liveWorkerEvents, total: 20, page: 1, limit: 10 },
  );
  const user = userEvent.setup();
  await screen.findByRole('navigation', { name: 'problems pagination' });
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(requests.at(-1)!.get('page')).toBe('2');
  expect(document.querySelectorAll('[data-worker-event]')).toHaveLength(liveWorkerEvents.length);
  expect(screen.queryByText('Loading worker problems')).toBeNull();
  finish({ events: [{ ...liveWorkerEvents[0]!, message: 'Older problem' }], total: 20, page: 2, limit: 10 });
  expect(await screen.findByText('Older problem')).toBeVisible();
});

it('sends all selected components before paging and keeps the filtered total', async () => {
  const { requests } = paginatedProblems(25, (params) => {
    const selected = params.getAll('component');
    const page = Number(params.get('page'));
    return {
      events: [
        {
          ...liveWorkerEvents[0]!,
          component: 'gateway',
          message: `Selection ${selected.join(',') || 'all'} page ${page}`,
        },
      ],
      total: selected.length === 2 ? 12 : 25,
      page,
      limit: 10,
    };
  });
  const user = userEvent.setup();
  await screen.findByText('Selection all page 1');
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Selection all page 2');
  await user.click(screen.getByRole('button', { name: 'Component filter' }));
  await user.click(screen.getByRole('button', { name: 'Only Gateway' }));
  await screen.findByText('Selection gateway page 1');
  await user.click(screen.getByRole('checkbox', { name: 'Dataiku' }));
  await user.keyboard('{Escape}');
  await screen.findByText('Selection gateway,dataiku page 1');
  expect(requests.at(-1)!.getAll('component')).toEqual(['gateway', 'dataiku']);
  expect(requests.at(-1)!.get('page')).toBe('1');
  expect(screen.getByText('1–10 of 12 problems')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Selection gateway,dataiku page 2');
  expect(requests.at(-1)!.getAll('component')).toEqual(['gateway', 'dataiku']);
  expect(screen.getByText('11–12 of 12 problems')).toBeVisible();
});

it('serializes multiple levels and components as repeated query parameters', async () => {
  const requests: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(new URL(input, 'http://localhost').searchParams);
      return new Response(JSON.stringify({ events: [], total: 0 }));
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const { result } = renderHook(
    () =>
      useLiveWorkerEvents('demo', 'worker', {
        component: ['gateway', 'dataiku'],
        level: ['error', 'warning'],
        page: 2,
        limit: 10,
      }),
    { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(requests[0]!.getAll('component')).toEqual(['gateway', 'dataiku']);
  expect(requests[0]!.getAll('level')).toEqual(['error', 'warning']);
  expect(requests[0]!.get('page')).toBe('2');
});

it('moves an empty page to the last existing page after problems age out', async () => {
  const { requests } = paginatedProblems(25, (params) => {
    const page = Number(params.get('page'));
    return {
      events: page === 3 ? [] : [{ ...liveWorkerEvents[0]!, message: `Page ${page} problem` }],
      total: page === 1 ? 25 : 12,
      page,
      limit: 10,
    };
  });
  const user = userEvent.setup();
  await screen.findByText('Page 1 problem');
  await user.click(screen.getByRole('button', { name: 'Last page' }));
  expect(await screen.findByText('Page 2 problem')).toBeVisible();
  expect(requests.map((params) => params.get('page'))).toEqual(['1', '3', '2']);
});

it.each([0, Infinity])('can revisit a corrected empty page with staleTime %s', async (staleTime) => {
  let grown = false;
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { client, requests } = paginatedProblems(
    25,
    (params) => {
      const page = Number(params.get('page'));
      if (grown && page === 3) return pending;
      return {
        events: page === 3 ? [] : [{ ...liveWorkerEvents[0]!, message: `Page ${page} problem` }],
        total: grown || page === 1 ? 25 : 12,
        page,
        limit: 10,
      };
    },
    staleTime,
  );
  const user = userEvent.setup();
  await screen.findByText('Page 1 problem');
  await user.click(screen.getByRole('button', { name: 'Last page' }));
  await screen.findByText('Page 2 problem');
  expect(screen.getByText('11–12 of 12 problems')).toBeVisible();
  grown = true;
  await act(() =>
    client.refetchQueries({ queryKey: ['project', 'demo', 'live', 'worker-events'], type: 'active' }),
  );
  expect(await screen.findByText('11–20 of 25 problems')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByText('21–25 of 25 problems')).toBeVisible();
  expect(requests.at(-1)!.get('page')).toBe('3');
  finish({
    events: [{ ...liveWorkerEvents[0]!, message: 'New page 3 problem' }],
    total: 25,
    page: 3,
    limit: 10,
  });
  expect(await screen.findByText('New page 3 problem')).toBeVisible();
  expect(screen.getByText('21–25 of 25 problems')).toBeVisible();
});

it.each(['Warnings', 'Dataiku'])('shows loading while the changed %s filter is pending', async (filter) => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  paginatedProblems(1, (params) =>
    params.has('level') || params.has('component')
      ? pending
      : {
          events: [
            { ...liveWorkerEvents[0]!, level: 'error', component: 'gateway', message: 'Error problem' },
          ],
          total: 1,
          page: 1,
          limit: 10,
        },
  );
  const user = userEvent.setup();
  await screen.findByText('Error problem');
  await user.click(
    screen.getByRole('button', {
      name: `${filter === 'Errors' || filter === 'Warnings' ? 'Level' : 'Component'} filter`,
    }),
  );
  await user.click(screen.getByRole('button', { name: `Only ${filter}` }));
  await user.keyboard('{Escape}');
  expect(screen.queryByText('No problems reported by the worker')).toBeNull();
  expect(await screen.findByLabelText('Loading worker problems')).toBeVisible();
  expect(screen.queryByText('Error problem')).toBeNull();
  finish({
    events: [{ ...liveWorkerEvents[0]!, level: 'warning', component: 'dataiku', message: 'Warning problem' }],
    total: 1,
    page: 1,
    limit: 10,
  });
  expect(await screen.findByText('Warning problem')).toBeVisible();
  expect(screen.queryByLabelText('Loading worker problems')).toBeNull();
});

function Problems({ events = liveWorkerEvents }: { events?: LiveWorkerEvent[] }) {
  const [filters, setFilters] = useState<WorkerEventsFilters>({});
  return (
    <MemoryRouter initialEntries={['/projects/demo/live/worker?source=worker+%26+prod&view=all']}>
      <ProblemsBlock
        source="worker-prod"
        status={liveOverview.status}
        read={liveWorkerRead}
        events={events}
        eventsFilters={filters}
        onEventsFilters={setFilters}
      />
    </MemoryRouter>
  );
}
it('renders grouped counts, filters by component and level, and can clear filters', async () => {
  const { container } = paginatedProblems(6, (params) => {
    const components = params.getAll('component');
    const levels = params.getAll('level');
    const events = liveWorkerEvents.filter(
      (event) =>
        (!components.length || components.includes(event.component)) &&
        (!levels.length || levels.includes(event.level)),
    );
    return { events, total: events.length, page: 1, limit: 10 };
  });
  const rows = () => container.querySelectorAll('[data-worker-event]');
  await waitFor(() => expect(rows()).toHaveLength(6));
  expect(screen.getByText('×14')).toBeVisible();
  expect(screen.getAllByText('in 12 min')[0]).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Component filter' }));
  await user.click(screen.getByRole('button', { name: 'Only Gateway' }));
  await waitFor(() => expect(rows()).toHaveLength(2));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Level filter' }));
  await user.click(screen.getByRole('button', { name: 'Only Errors' }));
  await waitFor(() => expect(rows()).toHaveLength(1));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Clear 2 filters' }));
  await waitFor(() => expect(rows()).toHaveLength(6));
  expect(screen.queryByTestId('filters-clear')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Component filter' }));
  await user.click(screen.getByRole('button', { name: 'Only Settings' }));
  await user.keyboard('{Escape}');
  expect(await screen.findByText('No problems reported by the worker')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear 1 filter' }));
  await waitFor(() => expect(rows()).toHaveLength(6));
});
it('copies the full problem report including code and message', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('isSecureContext', true);
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const event = { ...liveWorkerEvents[0]!, message: '[LIVE] The gateway is unavailable.' };
  render(<Problems events={[event]} />);
  await user.click(screen.getAllByRole('button', { name: 'Copy report' })[0]!);
  expect(screen.getByText('The gateway is unavailable.')).toBeVisible();
  expect(screen.queryByText(event.message)).toBeNull();
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      problemReport({
        source: 'worker-prod',
        environment: liveOverview.status.environment,
        worker_version: String(liveOverview.status.worker.worker_version),
        eval_code_version: String(liveOverview.status.worker.eval_code_version),
        settings_version_applied: 3,
        event,
      }),
    ),
  );
  expect(writeText.mock.calls[0]![0]).toContain(`Code: ${event.code}`);
  expect(writeText.mock.calls[0]![0]).toContain(`Message: ${event.message}`);
});
it.each([
  ['gateway', 'Models', 'models'],
  ['database', 'Database', 'database'],
  ['langfuse', 'Langfuse', 'langfuse'],
  ['dataiku', 'Dataiku', 'dataiku'],
])('links failed %s checks to the settings section', (prefix, title, id) => {
  render(
    <Problems
      events={[
        {
          ...liveWorkerEvents[0]!,
          component: 'control',
          details: {
            checks: {
              'gateway.passed': { ok: true },
              [`${prefix}.connect`]: { ok: false },
              [`${prefix}.auth`]: { ok: false },
              [`${prefix}.ok`]: { ok: true },
            },
          },
        },
      ]}
    />,
  );
  expect(screen.getByText(`${prefix}.connect · ${prefix}.auth`)).toBeVisible();
  expect(screen.getByRole('link', { name: `Fix in ${title}` })).toHaveAttribute(
    'href',
    `/projects/demo/live/worker?source=worker+%26+prod&view=all#settings-${id}`,
  );
});
it('links the first failed section when checks fail across sections', () => {
  render(
    <Problems
      events={[
        {
          ...liveWorkerEvents[0]!,
          component: 'control',
          details: {
            checks: {
              'gateway.models': { ok: true },
              'database.connect': { ok: false },
              'langfuse.auth': { ok: false },
            },
          },
        },
      ]}
    />,
  );
  expect(screen.getByText('database.connect · langfuse.auth')).toBeVisible();
  expect(screen.getAllByRole('link', { name: /^Fix in/ })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Fix in Database' })).toBeVisible();
});
it.each([null, [], {}, 'unavailable', { 'gateway.models': { ok: true } }])(
  'shows no Fix link without failed checks %#',
  (checks) => {
    render(<Problems events={[{ ...liveWorkerEvents[0]!, component: 'control', details: { checks } }]} />);
    expect(screen.queryByRole('link', { name: /^Fix in/ })).toBeNull();
  },
);
it('shows a failed events request instead of an empty state', () => {
  render(
    <MemoryRouter>
      <ProblemsBlock
        source="worker"
        read={liveWorkerRead}
        events={[]}
        eventsFilters={{}}
        onEventsFilters={() => {}}
        eventsError={new Error('Unavailable')}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load worker problems');
  expect(screen.queryByText('No problems reported by the worker')).toBeNull();
});
it('shows no Manage link and shows the problems badge only above zero with or without control', () => {
  const control = liveWorkerRead.running!;
  const base = { ...liveOverview.status, worker: { ...liveOverview.status.worker, control } };
  const { rerender } = render(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker & prod" status={base} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('link', { name: 'Manage' })).toBeNull();
  expect(screen.getByRole('link', { name: '19 problems in the last hour' })).toHaveAttribute(
    'href',
    '/projects/demo/live/worker?source=worker+%26+prod#problems',
  );
  expect(screen.getByText('Worker')).toBeVisible();
  expect(screen.getByText('Running v3').closest('[data-kind="state"]')).toHaveAttribute('data-tone', 'info');
  rerender(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker" status={{ ...base, errors_last_hour: 0 }} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('link', { name: /problems in the last hour/ })).toBeNull();
  rerender(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker" status={{ ...liveOverview.status, errors_last_hour: 2 }} />
    </MemoryRouter>,
  );
  expect(screen.queryByText('Worker')).toBeNull();
  expect(screen.getByRole('link', { name: '2 problems in the last hour' })).toHaveAttribute(
    'href',
    '/projects/demo/live/worker?source=worker#problems',
  );
  rerender(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker" status={{ ...liveOverview.status, errors_last_hour: 1 }} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: '1 problem in the last hour' })).toBeVisible();
  rerender(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker" status={liveOverview.status} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('link', { name: /problems in the last hour/ })).toBeNull();
});
it.each([
  undefined,
  null,
  {},
  { backfill_job_id: '' },
  { backfill_job_id: ' ' },
  { backfill_job_id: 1 },
  { backfill_job_id: 'job-123' },
])('safely narrows backfill provenance %#', (provenance) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['project', 'demo', 'live', 'sources'], { sources: [liveOverview.status] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ sources: [liveOverview.status] }))),
  );
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TurnHeader
          slug="demo"
          source="worker"
          data={{ ...liveTurnDetail, summary: { ...liveTurnDetail.summary, provenance } }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const header = document.querySelector('[data-live-block="turn-header"]') as HTMLElement;
  expect(within(header).queryByText('Backfilled') !== null).toBe(provenance?.backfill_job_id === 'job-123');
  unmount();
  client.clear();
});

it.each(['UTC', undefined, 'Invalid/Zone'])('keeps the original raw UTC report line for %s', (zone) => {
  const report = problemReport({
    source: 'worker',
    day_key_timezone: zone,
    event: { ...liveWorkerEvents[0]!, last_at: '2026-11-09T22:30:12' },
  });
  expect(report.split('\n').filter((line) => line.startsWith('Time ('))).toEqual([
    'Time (UTC): 2026-11-09T22:30:12',
  ]);
});

it('keeps main diagnostic report timestamps unchanged for a source with a different clock', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('isSecureContext', true);
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  render(
    <MemoryRouter>
      <ProblemsBlock
        source="worker"
        read={{ ...liveWorkerRead, status: { ...liveWorkerRead.status, day_key_timezone: 'Asia/Riyadh' } }}
        events={[{ ...liveWorkerEvents[0]!, last_at: '2026-11-09T22:30:12' }]}
        eventsFilters={{}}
        onEventsFilters={() => {}}
      />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Copy report' }));
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Time (UTC): 2026-11-09T22:30:12')),
  );
  expect(writeText.mock.calls[0]![0]).not.toContain('Time (Riyadh)');
});
