import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { useSearchParamsState } from '@/lib/url-state';
import { CanaryStatus } from '../components/Canaries';
import { DaysTable } from '../components/DaysTable';
import { ServiceHealth } from '../components/ServiceHealth';
import { TrendChart } from '../components/TrendChart';

const primary: LiveMetricSpec = {
  metric_name: 'quality',
  group: 'quality',
  label: 'Quality',
  score_type: 'percentage',
  direction: 'maximize',
  pass_threshold: 0.8,
  unit: null,
  precision: null,
  is_primary: true,
  position: 0,
  description: null,
  values: null,
};
const specs: LiveMetricSpec[] = [
  primary,
  { ...primary, metric_name: 'service.search', group: 'service', label: 'Search', is_primary: false },
  {
    ...primary,
    metric_name: 'diagnosis',
    group: 'diagnosis',
    label: 'Diagnosis',
    score_type: 'categorical',
    values: [
      { value: 'ok', label: 'OK', tone: 'accent' },
      { value: 'problem', label: 'Problem', tone: 'danger' },
    ],
  },
];
const trend: LiveOverview['trend'] = [
  {
    day: '2026-10-28',
    turns: 4,
    counts_by_label: { ok: 3, problem: 1 },
    primary_rate: 0.75,
    worker_gap: false,
  },
  { day: '2026-10-29', turns: 1, counts_by_label: { problem: 1 }, primary_rate: 0.5, worker_gap: true },
  { day: '2026-10-30', turns: 2, counts_by_label: { ok: 2 }, primary_rate: 1, worker_gap: false },
  { day: '2026-10-31', turns: 0, counts_by_label: {}, primary_rate: null, worker_gap: false },
  { day: '2026-11-01', turns: 2, counts_by_label: { problem: 2 }, primary_rate: 0, worker_gap: false },
];
const days: LiveOverview['days'] = {
  total: 61,
  page: 1,
  page_size: 30,
  rows: trend.slice(0, 3).map((row, index) => ({
    day: row.day,
    turns_seen: row.turns,
    evaluated: row.turns,
    failed: 0,
    polls: 10,
    status: index === 0 ? 'running' : 'closed',
    max_poll_gap_s: row.worker_gap ? 7200 : 0,
    in_qym: row.turns,
    primary_rate: row.primary_rate,
    label_mix: row.counts_by_label,
    worker_gap: row.worker_gap,
  })),
};

function Location() {
  const location = useLocation();
  return (
    <output aria-label="URL">
      {location.pathname}
      {location.search}
    </output>
  );
}

describe('overview service and history blocks', () => {
  it('links API service metric names using the service key and displays spec labels and score bands', () => {
    const { container } = render(
      <MemoryRouter>
        <ServiceHealth
          services={[{ name: 'service.search', ok_rate: 0.8, n: 10, fault_breakdown: {} }]}
          specs={specs}
          linkTo={(filters) =>
            `/live/turns?${new URLSearchParams({ day: '2026-11-01', source: 'worker', ...filters })}`
          }
        />
        <Location />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /Services/, level: 2 })).toBeVisible();
    const health = screen.getByRole('link', {
      name: '80.0%: Search: view turns where the service was not OK',
    });
    expect(health).toHaveTextContent('80.0%');
    fireEvent.click(health);
    expect(screen.getByLabelText('URL')).toHaveTextContent(
      '/live/turns?day=2026-11-01&source=worker&service=search&service_status=not_ok',
    );
    expect(container.querySelector('[data-live-service="search"] [data-band]')).not.toBeNull();
    expect(screen.getByTestId('data-table')).toHaveAttribute('data-padding', 'card');
    expect(screen.getByRole('button', { name: 'Explain service health' })).toBeInTheDocument();
  });

  it('matches canaries to service rows, keeps acronym casing and shows missing or skipped checks plainly', () => {
    const canaries: LiveOverview['canaries'] = [
      { canary: 'sql_generation', status: 'ok', latency_ms: 0, checked_at: '', fault: null },
      { canary: 'search', status: 'failed', latency_ms: 120, checked_at: '', fault: 'timeout' },
      { canary: 'api', status: 'skipped', latency_ms: null, checked_at: '', fault: 'disabled' },
    ];
    const { container } = render(
      <MemoryRouter>
        <ServiceHealth
          services={['search', 'sql_generation', 'api', 'other'].map((name) => ({
            name: `service.${name}`,
            ok_rate: 0.8,
            n: 10,
            fault_breakdown: {},
          }))}
          canaries={canaries}
          specs={[
            ...specs,
            { ...primary, metric_name: 'service.sql_generation', label: 'Sql generation' },
            { ...primary, metric_name: 'service.api', label: 'Api / id / url' },
          ]}
          linkTo={() => '/live/turns'}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Service',
      'Health today',
      'Health',
      'Canary',
      'Canary time',
    ]);
    const sql = container.querySelector('[data-live-service="sql_generation"]')!;
    expect(sql).toHaveTextContent('SQL generation');
    expect(sql).toHaveTextContent('OK0ms');
    expect(sql.querySelector('[data-shape="check"]')).toHaveAttribute('data-tone', 'success');
    const failed = container.querySelector('[data-live-canary="search"]')!;
    expect(failed).toHaveAttribute('title', 'timeout');
    expect(failed.querySelector('[data-shape="cross"]')).toHaveTextContent('Failed');
    expect(container.querySelector('[data-live-service="api"]')).toHaveTextContent('API / ID / URL');
    expect(screen.getAllByText('No canary')).toHaveLength(2);
    expect(canaries[0]?.canary).toBe('sql_generation');
  });

  it('keeps canaries without service scores or metric specs as rows with unknown health', () => {
    const canaries: LiveOverview['canaries'] = [
      { canary: 'search', status: 'ok', latency_ms: 0, checked_at: '', fault: null },
      { canary: 'database', status: 'failed', latency_ms: 120, checked_at: '', fault: 'timeout' },
    ];
    const { container, rerender } = render(
      <ServiceHealth services={[]} canaries={canaries} specs={specs} linkTo={() => '/live/turns'} />,
      { wrapper: MemoryRouter },
    );
    const rows = () => [...container.querySelectorAll('[data-live-service]')];
    expect(rows().map((row) => row.getAttribute('data-live-service'))).toEqual(['search', 'database']);
    for (const row of rows()) {
      expect(row.querySelector('[data-col="health"]')).toHaveTextContent('—');
      expect(row.querySelector('[data-band]')).toBeNull();
    }
    expect(rows()[0]).toHaveTextContent('Search');
    expect(rows()[0]).toHaveTextContent('OK0ms');
    expect(rows()[1]).toHaveTextContent('Database');
    expect(rows()[1]).toHaveTextContent('Failed120ms');
    rerender(
      <ServiceHealth
        services={[{ name: 'service.search', ok_rate: 0.8, n: 10, fault_breakdown: {} }]}
        canaries={canaries}
        specs={specs}
        linkTo={() => '/live/turns'}
      />,
    );
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent('80.0%');
    expect(rows()[1]).toHaveTextContent('Failed120ms');
  });

  it('shows no canary when no result is available', () => {
    const { container } = render(<CanaryStatus />);
    expect(screen.getByText('No canary')).toBeVisible();
    expect(container.querySelector('[data-live-canary]')).toBeNull();
  });

  it('renders every trend day, hatches gaps, breaks missing rates and retains a measured zero', () => {
    function Chart() {
      const { get, replaceUrlQuery } = useSearchParamsState();
      return (
        <TrendChart
          trend={trend}
          specs={specs}
          primaryMetric="quality"
          days={Number(get('trend_days', '14'))}
          onDays={(value) => replaceUrlQuery({ trend_days: value })}
        />
      );
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/live?source=worker&days_page=2']}>
        <Chart />
        <Location />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('[data-live-trend-day]')).toHaveLength(5);
    const gap = container.querySelector('[data-live-trend-day="2026-10-29"]')!;
    expect(gap).toHaveAttribute('data-live-gap', 'true');
    expect(gap.querySelector('[data-part="bar"]')?.getAttribute('style')).toContain(
      'repeating-linear-gradient',
    );
    expect(gap.querySelector('[data-part="baseline"]')).toBeNull();
    expect(gap.querySelector('[data-part="count"]')).toBeNull();
    expect(container.querySelectorAll('[data-part="count"]')).toHaveLength(1);
    expect(container.querySelector('[data-part="count"]')).toHaveTextContent('2');
    expect([...container.querySelectorAll('[data-part="axis"]')].map((label) => label.textContent)).toContain(
      'Oct 28',
    );
    expect([...container.querySelectorAll('[data-part="axis"]')].map((label) => label.textContent)).toContain(
      'Nov 1',
    );
    expect(container.querySelectorAll('[data-live-panel]')).toHaveLength(2);
    for (const panel of container.querySelectorAll('[data-live-panel]'))
      expect(panel.querySelectorAll('[data-live-axis]')).toHaveLength(1);
    expect(container.querySelector('[data-live-axis="rate"]')).toHaveTextContent('0%50%100%');
    expect(gap).toHaveAccessibleName(/worker gap/);
    expect(container.querySelector('[data-live-trend-day="2026-10-31"]')).toHaveAttribute(
      'data-live-gap',
      'false',
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
    const points = [...container.querySelectorAll('[data-live-rate-point]')];
    expect(points).toHaveLength(3);
    expect(points[2]).toHaveAttribute('data-live-rate-point', '2026-11-01');
    expect(points[2]?.parentElement).toHaveStyle({ bottom: '0%' });
    expect(points[0]).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '30d' }));
    expect(screen.getByLabelText('URL')).toHaveTextContent('source=worker&days_page=2&trend_days=30');
    fireEvent.click(screen.getByRole('button', { name: /Oct 28, 2026: 4 turns/ }));
    expect(screen.getByLabelText('URL')).toHaveTextContent('trend_days=30&day=2026-10-28');
    expect(screen.getByText('Problem', { exact: true })).toBeVisible();
  });

  it('keeps distinct diagnosis tones in the trend legend and inconclusive stacks neutral', () => {
    const values = [
      { value: 'ok', label: 'OK', tone: 'accent' },
      { value: 'problem', label: 'Problem', tone: 'danger' },
      { value: 'system_problem', label: 'System problem', tone: 'meta' },
      { value: 'inconclusive', label: 'Inconclusive', tone: 'neutral' },
    ];
    const { container } = render(
      <MemoryRouter>
        <TrendChart
          trend={[{ ...trend[0]!, counts_by_label: { inconclusive: 3 } }]}
          specs={[{ ...specs[2]!, values }]}
          primaryMetric="diagnosis"
          days={14}
          onDays={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-part="bar"]')?.getAttribute('style')).toContain(
      'var(--text-muted) 0% calc(75% - 1px)',
    );
    const legendTones = values.map(({ label, tone }) => {
      const entry = screen.getByText(label, { exact: true }).closest('[data-tone]');
      expect(entry).toHaveAttribute(
        'data-tone',
        tone === 'accent' ? 'success' : tone === 'meta' ? 'neutral' : tone,
      );
      if (tone === 'meta') expect(entry).toHaveAttribute('data-dark');
      return `${entry?.getAttribute('data-tone')}:${entry?.hasAttribute('data-dark')}`;
    });
    expect(new Set(legendTones).size).toBe(values.length);
    expect(screen.getByText('Undiagnosed').closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
    expect(container.querySelector('[data-part="baseline"]')).toBeNull();
  });

  it('keeps an empty gap distinct with main hatch styling', () => {
    const { container } = render(
      <MemoryRouter>
        <TrendChart
          trend={[{ ...trend[3]!, worker_gap: true }]}
          specs={specs}
          primaryMetric="quality"
          days={14}
          onDays={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-part="count"]')).toBeNull();
    expect(container.querySelector('[data-part="bar"]')?.getAttribute('style')).toContain(
      'repeating-linear-gradient',
    );
    expect(container.querySelector('[data-part="bar"]')).toHaveStyle({ blockSize: '100%' });
  });

  it('fills half an eight-turn bar with the four diagnosed turns and labels the remainder', () => {
    const { container } = render(
      <MemoryRouter>
        <TrendChart
          trend={[{ ...trend[0]!, turns: 8, counts_by_label: { ok: 4 } }]}
          specs={specs}
          primaryMetric="quality"
          days={14}
          onDays={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-part="bar"]')?.getAttribute('style')).toContain(
      'var(--success) 0% calc(50% - 1px)',
    );
    expect(container.querySelector('[data-part="bar"]')?.getAttribute('style')).toContain(
      'var(--text-muted) calc(50% + 1px) 100%',
    );
    expect(screen.getByText('Undiagnosed', { exact: true })).toBeVisible();
  });

  it('draws one fixed-size marker for an isolated measured day and a polyline for consecutive days', () => {
    const onlyDay = [trend[1]!, trend[2]!, trend[3]!];
    const { container, rerender } = render(
      <MemoryRouter>
        <TrendChart trend={onlyDay} specs={specs} primaryMetric="quality" days={14} onDays={() => {}} />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('[data-live-rate-point]')).toHaveLength(1);
    expect(container.querySelector('[data-live-rate-point]')).toHaveAttribute(
      'data-live-rate-point',
      '2026-10-30',
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
    rerender(
      <MemoryRouter>
        <TrendChart
          trend={[trend[0]!, trend[2]!]}
          specs={specs}
          primaryMetric="quality"
          days={14}
          onDays={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('[data-live-rate-point]')).toHaveLength(2);
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
  });

  it('uses one complete tooltip from either panel and labels only the last and lowest rates', () => {
    const values = [0.8, 0.3, 0.6];
    const data = values.map((rate, index) => ({ ...trend[index]!, primary_rate: rate, worker_gap: false }));
    const { container } = render(
      <MemoryRouter>
        <TrendChart trend={data} specs={specs} primaryMetric="quality" days={14} onDays={() => {}} />
      </MemoryRouter>,
    );
    expect(
      [...container.querySelectorAll('[data-live-rate-label]')].map((point) =>
        point.getAttribute('data-live-rate-label'),
      ),
    ).toEqual(['2026-10-29', '2026-10-30']);
    expect(
      [...container.querySelectorAll('[data-live-rate-label]')].map((point) => point.textContent),
    ).toEqual(['30.0%', '60.0%']);
    fireEvent.focus(container.querySelector('[data-live-trend-day]')!);
    let tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('OK3');
    expect(tooltip).toHaveTextContent('Problem1');
    expect(tooltip).toHaveTextContent('Total4');
    expect(tooltip).toHaveTextContent('Quality80.0%');
    fireEvent.pointerEnter(container.querySelector('[data-live-rate-day="2026-10-30"]')!);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('OK2');
    expect(tooltip).toHaveTextContent('Problem0');
    expect(tooltip).toHaveTextContent('Total2');
    expect(tooltip).toHaveTextContent('Quality60.0%');
  });

  it('shows received-minus-evaluated waiting counts with a zero floor and no layout controls', () => {
    const data = {
      ...days,
      rows: [
        { ...days.rows[0]!, turns_seen: 20, in_qym: 10, evaluated: 7 },
        { ...days.rows[1]!, in_qym: 2, evaluated: 4 },
      ],
    };
    const { container } = render(
      <MemoryRouter>
        <DaysTable days={data} slug="demo" source="worker" specs={specs} primaryMetric="quality" />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Day',
      'Turns',
      'Evaluated',
      'Waiting',
      'Quality',
      'Diagnosis mix',
      'Worker',
    ]);
    expect(
      [...container.querySelectorAll('[data-col="waiting"][role="gridcell"]')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['3', '0']);
    expect(screen.queryByRole('button', { name: /Columns|Density/ })).toBeNull();
    expect(screen.getByText('Click a day to see its turns')).toBeVisible();
    expect(screen.getByTestId('data-table')).toHaveAttribute('data-padding', 'card');
    for (const id of ['turns_seen', 'evaluated', 'waiting', 'primary_rate', 'worker']) {
      for (const cell of container.querySelectorAll(`th[data-col="${id}"], td[data-col="${id}"]`)) {
        expect(cell).toHaveAttribute('data-align', 'end');
      }
    }
    expect(container.querySelector('[data-dt-footer]')).toHaveAttribute('data-layout', 'spread');
  });

  it.each([
    ['duration', 250, '250ms'],
    ['duration', 0, '0ms'],
    ['numeric', 12.5, '12.50'],
  ] as const)('formats a %s primary mean of %s without a rate line', (score_type, value, text) => {
    const primarySpecs: LiveMetricSpec[] = [
      { ...primary, metric_name: 'mean', label: 'Mean', score_type },
      ...specs.slice(1),
    ];
    const { container } = render(
      <MemoryRouter>
        <TrendChart
          trend={[{ ...trend[0]!, primary_rate: value }]}
          specs={primarySpecs}
          primaryMetric="quality"
          days={14}
          onDays={() => {}}
        />
        <DaysTable
          days={{ ...days, rows: [{ ...days.rows[0]!, primary_rate: value }] }}
          slug="demo"
          source="worker"
          specs={primarySpecs}
          primaryMetric="quality"
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-live-day]')).toHaveTextContent(text);
    expect(container.querySelector('[data-live-day]')).not.toHaveTextContent('%');
    expect(container.querySelectorAll('polyline, [data-live-rate-point]')).toHaveLength(0);
    expect(screen.queryByText(/0–100%/)).not.toBeInTheDocument();
    fireEvent.focus(container.querySelector('[data-live-trend-day]')!);
    expect(within(screen.getByRole('tooltip')).getByText('Mean')).toBeVisible();
    expect(within(screen.getByRole('tooltip')).getByText(text)).toBeVisible();
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('%');
  });

  it('marks the open day stale when the source has no recent heartbeat', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/live?source=worker']}>
        <DaysTable days={days} slug="demo" source="worker" specs={specs} primaryMetric="quality" stale />
      </MemoryRouter>,
    );
    const open = container.querySelector('[data-live-day="2026-10-28"]')!;
    expect(open.querySelector('[data-kind="state"][data-tone="danger"]')).toHaveAttribute(
      'title',
      'Open day, worker not heard from',
    );
    expect(open).toHaveTextContent('Stale');
    expect(
      container.querySelector('[data-live-day="2026-10-30"] [data-kind="state"][data-tone="success"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-live-day="2026-10-29"] [data-kind="state"][data-tone="warning"]'),
    ).not.toBeNull();
  });

  it('shows worker states and diagnosis tones, paginates in the URL and opens the selected day', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/live?source=worker&trend_days=30']}>
        <DaysTable days={days} slug="demo" source="worker" specs={specs} primaryMetric="quality" />
        <Location />
      </MemoryRouter>,
    );
    expect(screen.getByRole('columnheader', { name: 'Quality' })).toBeInTheDocument();
    const gap = container.querySelector('[data-live-day="2026-10-29"]')!;
    expect(gap.querySelector('[data-kind="state"][data-tone="warning"]')).toHaveAttribute(
      'title',
      'Worker gap: 7200s between heartbeats',
    );
    const running = container.querySelector('[data-live-day="2026-10-28"]')!;
    expect(running.querySelector('[data-kind="state"][data-tone="info"]')).toHaveTextContent('Running');
    expect(running.querySelector('[data-mark][data-tone="danger"]')).not.toBeNull();
    expect(
      container.querySelector('[data-live-day="2026-10-30"] [data-kind="state"][data-tone="success"]'),
    ).toHaveTextContent('Closed');
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'days pagination' })).getByRole('button', {
        name: 'Next page',
      }),
    );
    expect(screen.getByLabelText('URL')).toHaveTextContent('source=worker&trend_days=30&days_page=2');
    fireEvent.click(running);
    await waitFor(() =>
      expect(screen.getByLabelText('URL')).toHaveTextContent(
        '/projects/demo/live/turns?day=2026-10-28&source=worker',
      ),
    );
  });
});
