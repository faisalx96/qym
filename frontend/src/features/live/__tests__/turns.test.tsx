import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLiveFilters, type LiveMetricSpec, type LiveTurnRow } from '@/api/live';
import { TurnFilters } from '../components/TurnFilters';
import { TurnsTable } from '../components/TurnsTable';
import { LiveTurnsPage } from '../LiveTurnsPage';
import { liveOverview } from '@/features/dev/liveFixtures';

vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));

const primary: LiveMetricSpec = {
  metric_name: 'quality',
  group: 'quality',
  label: 'Quality',
  score_type: 'percentage',
  direction: 'maximize',
  pass_threshold: 1,
  unit: null,
  precision: null,
  is_primary: true,
  position: 0,
  description: null,
  values: null,
};
const specs: LiveMetricSpec[] = [
  primary,
  { ...primary, metric_name: 'compliance', label: 'Compliance', is_primary: false, position: 1 },
  {
    ...primary,
    metric_name: 'diagnosis',
    label: 'Diagnosis',
    group: 'diagnosis',
    score_type: 'categorical',
    is_primary: false,
    values: [{ value: 'agent_problem', label: 'Agent problem', tone: 'danger' }],
  },
];
const row: LiveTurnRow = {
  turn_id: 'day/turn ?&1',
  turn_at: '2026-11-01T09:00:00Z',
  day: '2026-11-01',
  question: 'ما إجمالي الطلبات؟',
  mode: 'chat',
  label: 'agent_problem',
  label_reason: 'A detailed reason',
  status: 'completed',
  outcome: 'ok',
  latency_ms: 12000,
  result_rows: 1,
  user_ref: 'long-user-reference-123456',
  conversation_id: 'conversation/123',
  turn_index: 0,
  charts: { count: 2, failed: 1 },
  services_not_ok: [{ name: 'service-a', fault: 'agent' }],
  scores: {
    quality: { score_numeric: 0.5, label: null, skipped: false },
    compliance: { score_numeric: 1, label: null, skipped: true },
  },
};
const facets = {
  labels: { agent_problem: 2 },
  statuses: { completed: 2, failed: 1 },
  outcomes: { ok: 2 },
  modes: { chat: 2, report: 3 },
  services: { 'service-a': 1 },
  users: [],
};
const initial = '/projects/demo/live/turns?day=2026-11-01&label=agent_problem&source=worker&page=3';

function Harness({
  rows = [row],
  total = 120,
  filtersOnly = false,
}: {
  rows?: LiveTurnRow[];
  total?: number;
  filtersOnly?: boolean;
}) {
  const location = useLocation();
  const filters = parseLiveFilters(new URLSearchParams(location.search));
  return (
    <>
      <TurnFilters filters={filters} facets={facets} specs={specs} />
      {!filtersOnly ? (
        <TurnsTable
          slug="demo"
          source="worker"
          filters={filters}
          data={{ rows, total, facets }}
          specs={specs}
        />
      ) : null}
      <output aria-label="URL">
        {location.pathname}
        {location.search}
      </output>
    </>
  );
}
const currentUrl = () => new URL(screen.getByLabelText('URL').textContent!, 'http://localhost');
const clients: QueryClient[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clients.splice(0).forEach((client) => client.clear());
});

describe('Turns filters and table', () => {
  it('removes a label chip, preserves source/day and resets the page', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove Diagnosis: Agent problem' }));
    expect(currentUrl().searchParams.get('day')).toBe('2026-11-01');
    expect(currentUrl().searchParams.get('source')).toBe('worker');
    expect(currentUrl().searchParams.has('label')).toBe(false);
    expect(currentUrl().searchParams.has('page')).toBe(false);
  });

  it('debounces Arabic search for 300 ms and preserves the other filters', () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    const search = screen.getByRole('searchbox', { name: 'Search questions and answers' });
    fireEvent.change(search, { target: { value: 'إجمالي' } });
    act(() => vi.advanceTimersByTime(299));
    expect(currentUrl().searchParams.has('q')).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(currentUrl().searchParams.get('q')).toBe('إجمالي');
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
    expect(currentUrl().searchParams.has('page')).toBe(false);
  });

  it('toggles a facet in the URL and keeps score bounds disabled until a metric is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(
      within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: /^Failed/ }),
    );
    expect(currentUrl().searchParams.getAll('status')).toEqual(['failed']);
    expect(currentUrl().searchParams.has('page')).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Minimum' })).toBeDisabled();
  });

  it('keeps a facet changed while a search debounce is still pending', () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search questions and answers' }), {
      target: { value: 'إجمالي' },
    });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: /^Failed/ }),
    );
    expect(currentUrl().searchParams.get('status')).toBe('failed');
    act(() => vi.advanceTimersByTime(300));
    expect(currentUrl().searchParams.get('q')).toBe('إجمالي');
    expect(currentUrl().searchParams.get('status')).toBe('failed');
  });

  it('keeps an active diagnosis chip in its spec tone when no rows match', () => {
    render(
      <MemoryRouter>
        <TurnFilters
          filters={{ labels: ['agent_problem'] }}
          facets={{ labels: {}, statuses: {}, outcomes: {}, modes: {}, services: {}, users: [] }}
          specs={specs}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Diagnosis: Agent problem' })).toHaveAttribute(
      'data-tone',
      'danger',
    );
  });

  it('uses status/outcome facet options and counts, retaining selected values at zero', () => {
    render(
      <MemoryRouter>
        <TurnFilters
          filters={{ statuses: ['incomplete_ingest'], outcomes: ['absent'] }}
          facets={{ ...facets, statuses: { failed: 3 }, outcomes: { custom_result: 4 } }}
          specs={specs}
        />
      </MemoryRouter>,
    );
    const status = within(screen.getByRole('group', { name: 'Status' }));
    expect(status.getByRole('button', { name: /^Failed\s*3$/ })).toBeVisible();
    expect(status.getByRole('button', { name: /^Incomplete ingest\s*0$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(status.queryByRole('button', { name: /Completed/ })).toBeNull();
    const outcome = within(screen.getByRole('group', { name: 'Outcome' }));
    expect(outcome.getByRole('button', { name: /^custom result\s*4$/ })).toBeVisible();
    expect(outcome.getByRole('button', { name: /^absent\s*0$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(outcome.queryByRole('button', { name: /cancelled/ })).toBeNull();
  });

  it('can add a second mode while the first mode is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`${initial}&mode=chat`]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    const mode = within(screen.getByRole('group', { name: 'Mode' }));
    expect(mode.getByRole('button', { name: /^chat\s*2$/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(mode.getByRole('button', { name: /^report\s*3$/ }));
    expect(currentUrl().searchParams.getAll('mode')).toEqual(['chat', 'report']);
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
    expect(currentUrl().searchParams.has('page')).toBe(false);
  });

  it('uses the spec tone, keeps question text and skips scores without showing a value', () => {
    const { container } = render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>,
    );
    const question = container.querySelector('[data-live-question]')!;
    expect(question).toHaveAttribute('dir', 'auto');
    expect(question).toHaveAttribute('title', row.question);
    expect(question).toHaveTextContent(row.question);
    const turn = container.querySelector('[data-live-turn-row]')!;
    expect(turn.querySelector('[data-col="turn_at"]')).toHaveAttribute('data-pin', 'start');
    expect(turn.querySelector('[data-col="label"] [data-tone]')).toHaveAttribute('data-tone', 'danger');
    expect(turn.querySelector('[data-col="metric:quality"]')).toHaveTextContent('50%');
    expect(turn.querySelector('[data-col="metric:compliance"]')).toHaveTextContent('—');
    expect(turn.querySelector('[data-col="charts"] [data-tone="danger"]')).toHaveTextContent('1 failed');
    expect(turn.querySelector('[data-col="services"] [data-tone]')).toHaveAttribute('data-tone', 'danger');
  });

  it('writes backend metric/latency sort keys and pages in the URL', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Latency' }));
    expect(currentUrl().searchParams.get('sort')).toBe('-latency_ms');
    expect(currentUrl().searchParams.has('page')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Latency' }));
    expect(currentUrl().searchParams.get('sort')).toBe('latency_ms');
    await user.click(screen.getByRole('button', { name: 'Quality' }));
    expect(currentUrl().searchParams.get('sort')).toBe('-metric:quality');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(currentUrl().searchParams.get('page')).toBe('2');
  });

  it('opens an encoded turn on Enter with the complete list query', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>,
    );
    const query = currentUrl().searchParams.toString();
    const turn = container.querySelector<HTMLElement>('[data-live-turn-row]')!;
    act(() => turn.focus());
    await user.keyboard('{Enter}');
    expect(currentUrl().pathname).toBe(`/projects/demo/live/turns/${encodeURIComponent(row.turn_id)}`);
    expect(currentUrl().searchParams.get('source')).toBe('worker');
    expect(currentUrl().searchParams.get('list')).toBe(query);
  });

  it('conversation links filter the list without opening the turn', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('link', { name: 'conversation 123 · turn 1' }));
    expect(currentUrl().pathname).toBe('/projects/demo/live/turns');
    expect(currentUrl().searchParams.get('conversation')).toBe(row.conversation_id);
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
    expect(currentUrl().searchParams.has('page')).toBe(false);
  });

  it('shows an empty result as No turns match', () => {
    render(
      <MemoryRouter>
        <Harness rows={[]} total={0} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'No turns match' })).toBeVisible();
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <LiveTurnsPage slug="demo" source="worker" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LiveTurnsPage', () => {
  it('loads source/specs and counts, sets the document title, and exports the same filters', async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost');
        requests.push(url);
        return new Response(
          JSON.stringify(
            url.pathname.endsWith('/overview')
              ? { ...liveOverview, specs, day: { ...liveOverview.day, in_qym: 12 } }
              : { rows: [row], total: 2, facets },
          ),
          { status: 200 },
        );
      }),
    );
    renderPage();
    expect(await screen.findByText('2 of 12 turns on 1 Nov 2026')).toBeVisible();
    expect(document.title).toBe('Turns · Live · Demo project · قيِّم');
    expect(screen.getByText(liveOverview.status.name)).toBeVisible();
    expect(screen.getByText(liveOverview.status.environment)).toBeVisible();
    const csv = screen.getByRole('link', { name: 'Export CSV' });
    const csvUrl = new URL(csv.getAttribute('href')!, 'http://localhost');
    expect(csv).toHaveAttribute('download');
    expect(csvUrl.pathname).toBe('/api/projects/demo/live/turns.csv');
    for (const [key, value] of [
      ['source', 'worker'],
      ['day', '2026-11-01'],
      ['label', 'agent_problem'],
      ['page_size', '50'],
    ]) {
      expect(csvUrl.searchParams.get(key!)).toBe(value);
      expect(requests.find((url) => url.pathname.endsWith('/turns'))?.searchParams.get(key!)).toBe(value);
    }
  });

  it('renders an error with retry instead of a successful empty state', async () => {
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.includes('/overview')) return new Response(JSON.stringify({ ...liveOverview, specs }));
        return fail
          ? new Response(JSON.stringify({ detail: 'Unavailable' }), { status: 503 })
          : new Response(JSON.stringify({ rows: [row], total: 1, facets }));
      }),
    );
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Couldn’t load live turns' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'No turns match' })).toBeNull();
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(row.question)).toBeVisible();
  });

  it('reserves the table frame and shows a delayed skeleton while requests are pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { container } = renderPage();
    expect(container.querySelector('[data-live-block="turns-table"]')).not.toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading live turns' })).toBeNull();
    expect(await screen.findByRole('status', { name: 'Loading live turns' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'No turns match' })).toBeNull();
  });
});
