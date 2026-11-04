import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { problemReport, type WorkerEventsFilters } from '@/api/liveWorker';
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
function Problems() {
  const [filters, setFilters] = useState<WorkerEventsFilters>({});
  return (
    <ProblemsBlock
      source="worker-prod"
      status={liveOverview.status}
      read={liveWorkerRead}
      events={liveWorkerEvents}
      eventsFilters={filters}
      onEventsFilters={setFilters}
    />
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
});
it('copies the full problem report including code and message', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('isSecureContext', true);
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  render(<Problems />);
  await user.click(screen.getAllByRole('button', { name: 'Copy report' })[0]!);
  const event = liveWorkerEvents[0]!;
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
it('shows a failed events request instead of an empty state', () => {
  render(
    <ProblemsBlock
      source="worker"
      read={liveWorkerRead}
      events={[]}
      eventsFilters={{}}
      onEventsFilters={() => {}}
      eventsError={new Error('Unavailable')}
    />,
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
