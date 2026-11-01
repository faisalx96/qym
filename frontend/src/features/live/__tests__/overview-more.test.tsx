import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { useSearchParamsState } from '@/lib/url-state';
import { Canaries } from '../components/Canaries';
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
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '80% Search' })).toHaveAttribute(
      'href',
      '/live/turns?day=2026-11-01&source=worker&service=search&service_status=not_ok',
    );
    expect(container.querySelector('[data-live-service="search"] [data-band]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Explain service health' })).toBeInTheDocument();
  });

  it('puts failed canaries first without changing the input, and distinguishes skipped and missing latency', () => {
    const canaries: LiveOverview['canaries'] = [
      { canary: 'search', status: 'ok', latency_ms: 0, checked_at: '', fault: null },
      { canary: 'other', status: 'skipped', latency_ms: null, checked_at: '', fault: null },
      { canary: 'failed', status: 'failed', latency_ms: 120, checked_at: '', fault: 'timeout' },
    ];
    const { container } = render(<Canaries canaries={canaries} specs={specs} />);
    const marks = [...container.querySelectorAll('[data-live-canary]')];
    expect(marks.map((mark) => mark.getAttribute('data-live-canary'))).toEqual(['failed', 'search', 'other']);
    expect(marks[0]).toHaveTextContent('Failed failed120 ms');
    expect(marks[1]).toHaveTextContent('Search ok0 ms');
    expect(marks[2]).toHaveTextContent('Other skipped—');
    expect(marks[2]?.querySelector('[data-shape="pause"][data-tone="neutral"]')).not.toBeNull();
    expect(canaries[0]?.canary).toBe('search');
    expect(screen.queryByText('No canary results for this day')).toBeNull();
  });

  it('explains an empty canary list after the Canaries label', () => {
    const { container } = render(<Canaries canaries={[]} specs={specs} />);
    const block = container.querySelector('[data-live-block="canaries"]')!;
    expect(block).toHaveTextContent('CanariesNo canary results for this day');
    expect(within(block as HTMLElement).getByText('No canary results for this day')).toBeVisible();
    expect(container.querySelectorAll('[data-live-canary]')).toHaveLength(0);
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
    expect(container.querySelector('[data-live-trend-day="2026-10-31"]')).toHaveAttribute(
      'data-live-gap',
      'false',
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
    const points = [...container.querySelectorAll('[data-live-rate-point]')];
    expect(points).toHaveLength(3);
    expect(points[2]).toHaveAttribute('cx', '90%');
    expect(points[2]).toHaveAttribute('cy', '100%');
    expect(points[0]?.closest('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '30' }));
    expect(screen.getByLabelText('URL')).toHaveTextContent('source=worker&days_page=2&trend_days=30');
    fireEvent.click(screen.getByRole('button', { name: /2026-10-28: 4 turns/ }));
    expect(screen.getByLabelText('URL')).toHaveTextContent('trend_days=30&day=2026-10-28');
    expect(screen.getByText('Problem', { exact: true })).toBeVisible();
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
      'var(--accent-primary) 0% 50%',
    );
    expect(container.querySelector('[data-part="bar"]')?.getAttribute('style')).toContain(
      'var(--text-muted) 50% 100%',
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
    expect(container.querySelector('[data-live-rate-point]')).toHaveAttribute('r', '2.5');
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
    expect(container.querySelectorAll('[data-live-rate-point]')).toHaveLength(0);
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
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
    expect(screen.getByRole('tooltip')).toHaveTextContent(`Mean ${text}`);
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('%');
  });

  it('marks the open day stale when the source has no recent heartbeat', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/live?source=worker']}>
        <DaysTable days={days} slug="demo" source="worker" specs={specs} primaryMetric="quality" stale />
      </MemoryRouter>,
    );
    const open = container.querySelector('[data-live-day="2026-10-28"]')!;
    expect(open.querySelector('[data-tone="danger"][data-shape="cross"]')).toHaveAttribute(
      'title',
      'Open day, worker not heard from',
    );
    expect(open).toHaveTextContent('Stale');
    expect(container.querySelector('[data-live-day="2026-10-30"] [data-shape="full"]')).not.toBeNull();
    expect(
      container.querySelector('[data-live-day="2026-10-29"] [data-tone="warning"][data-shape="hourglass"]'),
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
    expect(gap.querySelector('[data-tone="warning"][data-shape="hourglass"]')).toHaveAttribute(
      'title',
      'Worker gap: 7200 s between heartbeats',
    );
    const running = container.querySelector('[data-live-day="2026-10-28"]')!;
    expect(running.querySelector('[data-shape="orbit"]')).not.toBeNull();
    expect(running.querySelector('[data-mark][data-tone="danger"]')).not.toBeNull();
    expect(container.querySelector('[data-live-day="2026-10-30"] [data-shape="full"]')).not.toBeNull();
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
