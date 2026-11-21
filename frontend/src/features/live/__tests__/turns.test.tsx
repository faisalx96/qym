import { formatTableDate } from '@/lib/dates';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLiveFilters, type LiveMetricSpec, type LiveTurnRow } from '@/api/live';
import { TurnFilters } from '../components/TurnFilters';
import { TurnsTable } from '../components/TurnsTable';
import { TurnHeader } from '../components/turn/TurnHeader';
import { LiveTurnPage } from '../LiveTurnPage';
import { LiveTurnsPage } from '../LiveTurnsPage';
import { liveOverview, liveTurnDetail } from '@/features/dev/liveFixtures';

vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
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
    metric_name: 'service.viz_agent',
    group: 'service',
    label: 'Visualization',
    is_primary: false,
  },
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
  services: { 'service-a': 1, viz_agent: 2 },
  users: [],
};
const initial = '/projects/demo/live/turns?day=2026-11-01&label=agent_problem&source=worker&page=3';

function Harness({
  rows = [row],
  total = 120,
  filtersOnly = false,
  days,
}: {
  rows?: LiveTurnRow[];
  total?: number;
  filtersOnly?: boolean;
  days?: { day: string; in_qym: number }[];
}) {
  const location = useLocation();
  const filters = parseLiveFilters(new URLSearchParams(location.search));
  return (
    <>
      <TurnFilters filters={filters} facets={facets} specs={specs} days={days} />
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
  it.each([false, true])('groups secondary filters behind More filters (selected: %s)', async (selected) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TurnFilters
          filters={
            selected
              ? {
                  labels: ['agent_problem'],
                  modes: ['chat'],
                  statuses: ['completed'],
                  outcomes: ['ok'],
                  metric: 'quality',
                  min: 0.5,
                  service: 'service-a',
                  service_status: 'not_ok',
                  charts: 'failed',
                }
              : {}
          }
          facets={facets}
          specs={specs}
        />
      </MemoryRouter>,
    );
    const bar = within(screen.getByRole('group', { name: 'Turn filters' }));
    expect(bar.getByRole('searchbox')).toBeVisible();
    const day = bar.getByRole('button', { name: /^(Day: .*|All days) filter/ });
    expect(day).toBeVisible();
    expect(day).toHaveAttribute('data-selection', 'neutral');
    const moreButton = bar.getByRole('button', { name: /^More filters/ });
    expect(day.compareDocumentPosition(moreButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      moreButton.compareDocumentPosition(bar.getByRole('button', { name: 'All' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(bar.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', String(!selected));
    expect(bar.getByRole('button', { name: 'Agent problem 2' })).toHaveAttribute(
      'aria-pressed',
      String(selected),
    );
    for (const name of ['All', 'Agent problem 2']) {
      expect(bar.getByRole('button', { name })).toHaveAttribute('data-selection', 'neutral');
    }
    expect(bar.getByRole('button', { name: 'All' }).querySelector('[data-chip-mark]')).toBeNull();
    expect(
      bar.getByRole('button', { name: 'Agent problem 2' }).querySelector('[data-chip-mark]'),
    ).toHaveAttribute('data-tone', 'danger');
    expect(bar.queryByRole('button', { name: /^Diagnosis filter/ })).toBeNull();
    expect(bar.queryByRole('button', { name: /^Mode/ })).toBeNull();
    await user.click(bar.getByRole('button', { name: /^More filters/ }));
    const more = within(screen.getByRole('dialog', { name: 'More filters' }));
    for (const name of [/^Mode/, /^Status/, /^Outcome/, /Metric$/, /Service$/, /Charts/]) {
      expect(more.getByRole('button', { name })).toBeVisible();
    }
    await user.keyboard('{Escape}');
    if (selected) {
      expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent('quality ≥ 0.5');
      expect(screen.getByRole('button', { name: 'Clear 7 filters' })).toBeVisible();
    } else expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('clears the diagnosis filter, preserves source/day and resets the page', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(currentUrl().searchParams.get('day')).toBe('2026-11-01');
    expect(currentUrl().searchParams.get('source')).toBe('worker');
    expect(currentUrl().searchParams.has('label')).toBe(false);
    expect(currentUrl().searchParams.has('page')).toBe(false);
  });

  it.each([
    [{}, 'All days'],
    [{ day: '2026-11-16' }, 'Day: Nov 16'],
    [{ from: '2026-11-01', to: '2026-11-16' }, 'Day: Nov 1, 2026 – Nov 16, 2026'],
    [{ from: '2026-11-01' }, 'Day: From Nov 1, 2026'],
    [{ to: '2026-11-16' }, 'Day: Until Nov 16, 2026'],
  ])('shows the date selection in the Day trigger (%j)', (filters, label) => {
    render(
      <MemoryRouter>
        <TurnFilters filters={filters} facets={facets} specs={specs} />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: new RegExp(`^${label} filter`) });
    expect(button).toHaveTextContent(label);
  });

  it('keeps Clear available without repeating the day, diagnosis or search as removable chips', () => {
    render(
      <MemoryRouter initialEntries={[`${initial}&q=question`]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    expect(
      within(screen.getByRole('group', { name: 'Active filters' })).queryByRole('button', {
        name: /^Remove /,
      }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear 3 filters' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Day: Nov 1 filter, 1 selected' })).toHaveAttribute(
      'data-active',
    );
  });

  it('shows removable secondary filters and keeps Clear as a reset of the whole filter bar', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          `${initial}&q=question&mode=chat&status=completed&outcome=ok&metric=quality&min=0.5&service=service-a&charts=failed&conversation=conv-1&user=user-1`,
        ]}
      >
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    const active = within(screen.getByRole('group', { name: 'Active filters' }));
    for (const label of [
      'Mode: chat',
      'Status: Completed',
      'Outcome: Ok',
      'quality ≥ 0.5',
      'service-a',
      'Charts: failed',
      'Conversation: conv-1',
      'User: user-1',
    ]) {
      expect(active.getByRole('button', { name: `Remove ${label}` })).toBeVisible();
    }
    expect(active.getAllByRole('button', { name: /^Remove / })).toHaveLength(8);
    await user.click(active.getByRole('button', { name: 'Remove Conversation: conv-1' }));
    expect(currentUrl().searchParams.has('conversation')).toBe(false);
    expect(currentUrl().searchParams.get('day')).toBe('2026-11-01');
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
    expect(currentUrl().searchParams.get('user')).toBe('user-1');
    await user.click(screen.getByTestId('filters-clear'));
    expect([...currentUrl().searchParams.keys()]).toEqual(['source']);
    expect(screen.queryByRole('group', { name: 'Active filters' })).toBeNull();
  });

  it.each([
    ['user=user-1', 'User: user-1'],
    ['min=0', 'Minimum: 0'],
    ['max=0.5', 'Maximum: 0.5'],
    ['service_status=not_ok', 'Service status: not ok'],
  ])('shows and removes a lone URL filter (%s)', async (query, label) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`?source=worker&sort=-latency_ms&page_size=100&page=3&${query}`]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Clear 1 filter' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: `Remove ${label}` }));
    expect(Object.fromEntries(currentUrl().searchParams)).toEqual({
      source: 'worker',
      sort: '-latency_ms',
      page_size: '100',
    });
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it.each([
    'day=2026-11-01',
    'from=2026-10-30&to=2026-11-01',
    'label=agent_problem',
    'q=question',
    'user=user-1',
  ])('clears a lone filter group (%s)', async (query) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`?source=worker&${query}`]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Clear 1 filter' }));
    expect(Object.fromEntries(currentUrl().searchParams)).toEqual({ source: 'worker' });
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('unticks the day without writing default pagination or sort to the URL', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`${initial}&page_size=50&sort=-turn_at`]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Day: Nov 1 filter, 1 selected' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Day: Nov 1 options' })).getByRole('checkbox'),
    );
    for (const key of ['day', 'page', 'page_size', 'sort']) {
      expect(currentUrl().searchParams.has(key)).toBe(false);
    }
    expect(currentUrl().searchParams.get('source')).toBe('worker');
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
  });

  it('selects one available day and clears range bounds without changing the other filters', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`${initial}&from=2026-10-01&to=2026-11-01`]}>
        <Harness filtersOnly days={[{ day: '2026-11-02', in_qym: 7 }]} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Day: Nov 1 filter, 1 selected' }));
    await user.click(screen.getByRole('checkbox', { name: /Nov 2, 2026/ }));
    expect(currentUrl().searchParams.get('day')).toBe('2026-11-02');
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
    expect(currentUrl().searchParams.get('source')).toBe('worker');
    for (const key of ['from', 'to', 'page']) expect(currentUrl().searchParams.has(key)).toBe(false);
    expect(screen.getByRole('checkbox', { name: /Nov 2, 2026/ })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Nov 1, 2026/ })).toBeNull();
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
    await user.click(screen.getByRole('button', { name: /^More filters/ }));
    await user.click(screen.getByRole('button', { name: /^Status/ }));
    await user.click(screen.getByRole('button', { name: 'Only Failed' }));
    expect(currentUrl().searchParams.getAll('status')).toEqual(['failed']);
    expect(currentUrl().searchParams.has('page')).toBe(false);
    await user.keyboard('{Escape}');
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
    fireEvent.click(screen.getByRole('button', { name: /^More filters/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Status/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Only Failed' }));
    expect(currentUrl().searchParams.get('status')).toBe('failed');
    act(() => vi.advanceTimersByTime(300));
    expect(currentUrl().searchParams.get('q')).toBe('إجمالي');
    expect(currentUrl().searchParams.get('status')).toBe('failed');
  });

  it('uses status/outcome facet options and counts, retaining selected values at zero', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TurnFilters
          filters={{ statuses: ['incomplete_ingest'], outcomes: ['absent'] }}
          facets={{ ...facets, statuses: { failed: 3 }, outcomes: { custom_result: 4 } }}
          specs={specs}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^More filters/ }));
    await user.click(screen.getByRole('button', { name: /^Status/ }));
    const status = within(screen.getByRole('group', { name: 'Status options' }));
    expect(status.getByRole('checkbox', { name: /^Failed\s*3$/ })).not.toBeChecked();
    expect(status.getByRole('checkbox', { name: /^Incomplete ingest\s*0$/ })).toBeChecked();
    expect(status.queryByRole('checkbox', { name: /Completed/ })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /^Outcome/ }));
    const outcome = within(screen.getByRole('group', { name: 'Outcome options' }));
    expect(outcome.getByRole('checkbox', { name: /^custom result\s*4$/ })).not.toBeChecked();
    expect(outcome.getByRole('checkbox', { name: /^absent\s*0$/ })).toBeChecked();
    expect(outcome.queryByRole('checkbox', { name: /cancelled/ })).toBeNull();
  });

  it('ticking every mode clears the mode filter', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`${initial}&mode=chat`]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^More filters/ }));
    await user.click(screen.getByRole('button', { name: /^Mode/ }));
    const mode = within(screen.getByRole('group', { name: 'Mode options' }));
    expect(mode.getByRole('checkbox', { name: /^chat\s*2$/ })).toBeChecked();
    await user.click(mode.getByRole('checkbox', { name: /^report\s*3$/ }));
    expect(currentUrl().searchParams.has('mode')).toBe(false);
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
    expect(currentUrl().searchParams.has('page')).toBe(false);
  });

  it('toggles diagnoses directly without a duplicate removable chip', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Agent problem 2' }));
    expect(currentUrl().searchParams.has('label')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Agent problem 2' }));
    expect(currentUrl().searchParams.getAll('label')).toEqual(['agent_problem']);
    expect(screen.queryByRole('button', { name: 'Remove Diagnosis: Agent problem' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Agent problem 2' }));
    expect(currentUrl().searchParams.has('label')).toBe(false);
    expect(currentUrl().searchParams.has('page')).toBe(false);
  });

  it('adds a diagnosis without replacing selected unknown or zero-count diagnoses', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`${initial}&label=custom`]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'custom 0' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Agent problem 2' }));
    expect(currentUrl().searchParams.getAll('label')).toEqual(['custom']);
    await user.click(screen.getByRole('button', { name: 'Agent problem 2' }));
    expect(currentUrl().searchParams.getAll('label')).toEqual(['custom', 'agent_problem']);
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(currentUrl().searchParams.has('label')).toBe(false);
  });

  it('uses the same list when a facet has more than five values', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TurnFilters
          filters={{ modes: ['mode-6'] }}
          specs={specs}
          facets={{
            ...facets,
            modes: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`mode-${i + 1}`, i + 1])),
          }}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^More filters/ }));
    await user.click(screen.getByRole('button', { name: /^Mode/ }));
    const mode = within(screen.getByRole('group', { name: 'Mode options' }));
    expect(mode.getAllByRole('checkbox')).toHaveLength(6);
    expect(mode.getByRole('checkbox', { name: /^mode-1\s*1$/ })).toBeVisible();
  });

  it('updates metric bounds in the field row and clears them together', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^More filters/ }));
    await user.click(screen.getByRole('button', { name: /Any metric.*Metric/ }));
    await user.click(screen.getByRole('option', { name: 'Quality' }));
    const min = screen.getByRole('textbox', { name: 'Minimum' });
    await user.type(min, '0.5');
    await user.tab();
    expect(currentUrl().searchParams.get('metric')).toBe('quality');
    expect(currentUrl().searchParams.get('min')).toBe('0.5');
    expect(currentUrl().searchParams.has('page')).toBe(false);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /^More filters/ })).toHaveTextContent('1');
    expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent('quality ≥ 0.5');
    await user.click(screen.getByRole('button', { name: /^More filters/ }));
    await user.click(screen.getByRole('button', { name: /Quality.*Metric/ }));
    await user.click(screen.getByRole('option', { name: 'Any metric' }));
    expect(currentUrl().searchParams.has('metric')).toBe(false);
    expect(currentUrl().searchParams.has('min')).toBe(false);
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
  });

  it('combines service and status in one trigger and keeps charts in the URL', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^More filters/ }));
    await user.click(screen.getByRole('button', { name: /Any service.*Service/ }));
    await user.click(screen.getByRole('option', { name: 'service-a 1' }));
    await user.click(screen.getByRole('button', { name: /Any status.*Service status/ }));
    await user.click(screen.getByRole('option', { name: 'Not OK' }));
    expect(currentUrl().searchParams.get('service')).toBe('service-a');
    expect(currentUrl().searchParams.get('service_status')).toBe('not_ok');
    expect(screen.getByRole('button', { name: /service-a.*Service$/ })).toHaveTextContent('service-a');
    await user.click(screen.getByRole('button', { name: /Charts/ }));
    await user.click(screen.getByRole('option', { name: 'Failed charts' }));
    expect(currentUrl().searchParams.get('charts')).toBe('failed');
    await user.click(screen.getByRole('button', { name: /service-a.*Service$/ }));
    await user.click(screen.getByRole('option', { name: 'Any service' }));
    expect(currentUrl().searchParams.has('service')).toBe(false);
    expect(currentUrl().searchParams.has('service_status')).toBe(false);
    expect(currentUrl().searchParams.get('charts')).toBe('failed');
    expect(currentUrl().searchParams.has('page')).toBe(false);
  });

  it('shows service spec labels and not-ok counts in options and the selected trigger', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness filtersOnly />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^More filters/ }));
    await user.click(screen.getByRole('button', { name: /Any service.*Service/ }));
    expect(screen.getByRole('option', { name: 'service-a 1' })).toBeVisible();
    await user.click(screen.getByRole('option', { name: 'Visualization 2' }));
    expect(currentUrl().searchParams.get('service')).toBe('viz_agent');
    expect(screen.getByRole('button', { name: /Visualization.*Service$/ })).toHaveTextContent(
      'Visualization',
    );
  });

  it('keeps the full long question in its title and visible text', () => {
    const question = Array.from({ length: 20 }, () => 'ما إجمالي الطلبات؟').join(' ');
    const { container } = render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness rows={[{ ...row, question }]} />
      </MemoryRouter>,
    );
    const cell = container.querySelector('[data-live-question]')!;
    expect(cell).toHaveAttribute('title', question);
    expect(cell).toHaveTextContent(question);
    expect(cell).toHaveAttribute('dir', 'rtl');
    expect(cell).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole('treegrid', { name: 'Live turns' })).toHaveAttribute(
      'data-cell-align',
      'first-line',
    );
  });

  it('labels not-ok services from the spec and preserves unknown names and faults', () => {
    const { container } = render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness
          rows={[
            { ...row, services_not_ok: [{ name: 'viz_agent', fault: 'agent' }, ...row.services_not_ok] },
          ]}
        />
      </MemoryRouter>,
    );
    const cell = container.querySelector('[data-live-turn-row] [data-col="problems"]')!;
    expect(cell).toHaveTextContent('Visualization · agent');
    expect(cell).toHaveTextContent('service-a · agent');
    expect(cell).not.toHaveTextContent('viz_agent');
  });

  it('expands metadata without navigating and shows full user, conversation and reason', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>,
    );
    const before = currentUrl().href;
    await user.click(screen.getByRole('button', { name: 'Expand row' }));
    expect(currentUrl().href).toBe(before);
    expect(screen.getByText(row.user_ref!)).toBeVisible();
    expect(screen.getByRole('link', { name: row.conversation_id! })).toBeVisible();
    expect(screen.getByText('Why this diagnosis')).toBeVisible();
    expect(screen.getByText('Charts')).toBeVisible();
    expect(screen.getAllByText(row.label_reason!)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Collapse row' }));
    expect(screen.queryByText(row.user_ref!)).toBeNull();
  });

  it('limits six problems to two tags and a count with all problems in its title', () => {
    const services = Array.from({ length: 5 }, (_, i) => ({ name: `service-${i}`, fault: 'agent' }));
    const { container } = render(
      <MemoryRouter>
        <Harness rows={[{ ...row, services_not_ok: services }]} />
      </MemoryRouter>,
    );
    const cell = container.querySelector('[data-col="problems"][role="gridcell"]')!;
    expect(cell.querySelectorAll('[data-tone]')).toHaveLength(2);
    const more = within(cell as HTMLElement).getByText('+4 more');
    expect(more.previousElementSibling).toHaveAttribute('data-live-problem-tag');
    for (const service of services) expect(more.getAttribute('title')).toContain(`${service.name} · agent`);
    expect(more.getAttribute('title')).toContain('1 chart failed');
    expect(cell).not.toHaveTextContent('service-4');
  });

  it('keeps Arabic direction and language on the reason, problems and full metadata values', async () => {
    const user = userEvent.setup();
    const values = {
      label_reason: 'لم يتم العثور على نتيجة مناسبة',
      mode: 'محادثة',
      user_ref: 'مستخدم الاختبار',
      conversation_id: 'معرف المحادثة الكامل',
      services_not_ok: [{ name: 'خدمة البحث', fault: 'عطل' }],
    };
    render(
      <MemoryRouter>
        <Harness rows={[{ ...row, ...values }]} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Expand row' }));
    for (const text of [
      values.label_reason,
      values.mode,
      values.user_ref,
      values.conversation_id,
      'خدمة البحث · عطل',
    ]) {
      for (const block of screen.getAllByText(text, { exact: true })) {
        expect(block).toHaveAttribute('dir', 'rtl');
        expect(block).toHaveAttribute('lang', 'ar');
      }
    }
  });

  it('uses short score headers and puts only returned additional metrics in details', async () => {
    const user = userEvent.setup();
    const metrics = [
      primary,
      ...['compliance_a', 'compliance_b', 'error_detection', 'not_returned'].map((name, i) => ({
        ...primary,
        metric_name: name,
        label: name === 'error_detection' ? 'Error detection' : `Full ${name}`,
        is_primary: false,
        position: i + 1,
      })),
    ];
    const { container } = render(
      <MemoryRouter>
        <TurnsTable
          slug="demo"
          source="worker"
          filters={{}}
          specs={metrics}
          data={{
            rows: [
              {
                ...row,
                scores: {
                  ...row.scores,
                  error_detection: { score_numeric: 0.9, skipped: false, label: null },
                },
              },
            ],
            total: 1,
            facets,
          }}
        />
      </MemoryRouter>,
    );
    for (const [label, short] of [
      ['Quality', 'Success'],
      ['Full compliance_a', 'Judge A'],
      ['Full compliance_b', 'Judge B'],
    ]) {
      expect(screen.getByRole('columnheader', { name: label })).toHaveTextContent(short!);
      expect(screen.getByTitle(label!)).toBeVisible();
    }
    expect(container.querySelectorAll('thead th')).toHaveLength(10);
    expect(container.querySelector('[data-col="metric:error_detection"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Expand row' }));
    expect(screen.getByText('Error detection')).toBeVisible();
    expect(screen.getByText('90.0%')).toBeVisible();
    expect(screen.queryByText('Full not_returned')).toBeNull();
  });

  it('a mouse row click opens the turn instead of expanding it', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>,
    );
    await user.click(container.querySelector('[data-live-question]')!);
    await screen.findByText(
      (_, element) =>
        element?.tagName === 'OUTPUT' &&
        element.textContent?.includes(encodeURIComponent(row.turn_id)) === true,
    );
    expect(currentUrl().pathname).toBe(`/projects/demo/live/turns/${encodeURIComponent(row.turn_id)}`);
    expect(screen.queryByText('Why this diagnosis')).toBeNull();
  });

  it('renders the full user reference in the turn header', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ sources: [] }))),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TurnHeader
            data={{ ...liveTurnDetail, turn: { ...liveTurnDetail.turn, user_ref: row.user_ref } }}
            slug="demo"
            source="worker"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(row.user_ref!)).toBeVisible();
  });

  it('uses the spec tone, keeps question text and skips scores without showing a value', () => {
    const { container } = render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>,
    );
    const question = container.querySelector('[data-live-question]')!;
    expect(question).toHaveAttribute('dir', 'rtl');
    expect(question).toHaveAttribute('title', row.question);
    expect(question).toHaveTextContent(row.question);
    const turn = container.querySelector('[data-live-turn-row]')!;
    expect(turn.querySelector('[data-col="turn_at"]')).toHaveAttribute('data-pin', 'start');
    expect(turn.querySelector('[data-col="label"] [data-tone]')).toHaveAttribute('data-tone', 'danger');
    expect(turn.querySelector('[data-col="metric:quality"]')).toHaveTextContent('50.0%');
    expect(turn.querySelector('[data-col="metric:compliance"]')).toHaveTextContent('—');
    expect(turn.querySelector('[data-col="problems"]')).toHaveTextContent('1 chart failed');
    expect(turn.querySelector('[data-col="problems"] [data-tone]')).toHaveAttribute('data-tone', 'danger');
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
    await user.click(screen.getByRole('button', { name: 'Success' }));
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

  it('conversation links clear all date bounds, preserve other filters and do not open the turn', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`${initial}&from=2026-10-01&to=2026-11-01&mode=chat&sort=latency_ms`]}>
        <Harness />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('link', { name: 'Conversation conversation/123 · turn 1' }));
    expect(currentUrl().pathname).toBe('/projects/demo/live/turns');
    expect(currentUrl().searchParams.get('conversation')).toBe(row.conversation_id);
    expect(currentUrl().searchParams.get('label')).toBe('agent_problem');
    expect(currentUrl().searchParams.get('source')).toBe('worker');
    expect(currentUrl().searchParams.get('mode')).toBe('chat');
    expect(currentUrl().searchParams.get('sort')).toBe('latency_ms');
    for (const key of ['day', 'from', 'to', 'page']) {
      expect(currentUrl().searchParams.has(key)).toBe(false);
    }
  });

  it('omits the turn index from a conversation link when it is unknown', () => {
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Harness rows={[{ ...row, conversation_id: 'conversation-c76', turn_index: null }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Conversation conversation-c76' })).toBeVisible();
    expect(screen.queryByText(/turn —/)).toBeNull();
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
    expect(await screen.findByText('2 turns on Nov 1, 2026')).toBeVisible();
    expect(document.title).toBe('Turns · Live · Demo project · قيِّم');
    expect(screen.getByText(liveOverview.status.name)).toBeVisible();
    // cv5 M2: the environment is a state tag in sentence case (preprod -> Preprod, a pre-production tone)
    expect(screen.getByTestId('live-environment')).toHaveTextContent(/^preprod$/i);
    expect(screen.getByTestId('live-environment')).toHaveAttribute('data-tone', 'info');
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

it.each([['Asia/Riyadh'], ['UTC'], [undefined], ['Invalid/Zone']])(
  'renders viewer clock times with source calendar day filters (%s)',
  async (zone) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: string) =>
          new Response(
            JSON.stringify(
              input.includes('/overview')
                ? { ...liveOverview, specs, status: { ...liveOverview.status, day_key_timezone: zone } }
                : { rows: [{ ...row, turn_at: '2026-11-01T09:00:00' }], total: 1, facets },
            ),
          ),
      ),
    );
    renderPage();
    expect(await screen.findByText(row.question)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Time' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Day: .* filter/ })).toBeVisible();
    expect(document.querySelector('[data-live-turn-row] [data-col="turn_at"]')).toHaveTextContent(
      formatTableDate('2026-11-01T09:00:00'),
    );
  },
);

it.each([['Asia/Riyadh'], ['UTC']])(
  'uses the viewer clock for turn detail and conversation regardless of source zone (%s)',
  async (zone) => {
    const detail = {
      ...liveTurnDetail,
      turn: { ...liveTurnDetail.turn, turn_at: '2026-11-09T22:30:00' },
      conversation: [{ ...liveTurnDetail.conversation[0]!, turn_at: '2026-11-09T22:30:00' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: string) =>
          new Response(
            JSON.stringify(
              new URL(input, 'http://localhost').pathname.endsWith('/live')
                ? {
                    sources: [{ ...liveOverview.status, key: 'worker', day_key_timezone: zone }],
                    default_source: 'worker',
                  }
                : detail,
            ),
          ),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['?tab=conversation']}>
          <LiveTurnPage slug="demo" source="worker" turnId={detail.turn.turn_id} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findAllByText(formatTableDate('2026-11-09T22:30:00'))).toHaveLength(2);
  },
);
