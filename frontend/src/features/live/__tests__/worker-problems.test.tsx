import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { problemReport, type LiveWorkerEvent, type WorkerEventsFilters } from '@/api/liveWorker';
import { liveOverview, liveTurnDetail, liveWorkerEvents, liveWorkerRead } from '@/features/dev/liveFixtures';
import { ProblemsBlock } from '../components/worker/ProblemsBlock';
import { StatusLine } from '../components/StatusLine';
import { TurnHeader } from '../components/turn/TurnHeader';

vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  const { container } = render(<Problems />);
  expect(container.querySelectorAll('[data-worker-event]')).toHaveLength(6);
  expect(screen.getByText(/× 14/)).toHaveTextContent('in 12 min');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'gateway' }));
  expect(container.querySelectorAll('[data-worker-event]')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Errors' }));
  expect(container.querySelectorAll('[data-worker-event]')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'gateway' }));
  expect(container.querySelectorAll('[data-worker-event]')).toHaveLength(4);
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByText('No problems reported by the worker')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'All' }));
  expect(container.querySelectorAll('[data-worker-event]')).toHaveLength(4);
  await user.click(screen.getByRole('button', { name: 'Errors' }));
  expect(container.querySelectorAll('[data-worker-event]')).toHaveLength(6);
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
it('always shows Manage and shows the problems badge only above zero with or without control', () => {
  const control = liveWorkerRead.running!;
  const base = { ...liveOverview.status, worker: { ...liveOverview.status.worker, control } };
  const { rerender } = render(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker & prod" status={base} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
    'href',
    '/projects/demo/live/worker?source=worker+%26+prod',
  );
  expect(screen.getByRole('link', { name: '19 problems in the last hour' })).toHaveAttribute(
    'href',
    '/projects/demo/live/worker?source=worker+%26+prod#problems',
  );
  expect(screen.getByText('Worker · running · v3')).toBeVisible();
  rerender(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker" status={{ ...base, errors_last_hour: 0 }} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('link', { name: /problems in the last hour/ })).toBeNull();
  expect(screen.getByRole('link', { name: 'Manage' })).toBeVisible();
  rerender(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker" status={{ ...liveOverview.status, errors_last_hour: 2 }} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
    'href',
    '/projects/demo/live/worker?source=worker',
  );
  expect(screen.queryByText(/Worker ·/)).toBeNull();
  expect(screen.getByRole('link', { name: '2 problems in the last hour' })).toHaveAttribute(
    'href',
    '/projects/demo/live/worker?source=worker#problems',
  );
  rerender(
    <MemoryRouter>
      <StatusLine slug="demo" source="worker" status={liveOverview.status} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Manage' })).toBeVisible();
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
