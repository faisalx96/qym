import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { DayNumbers } from '../components/DayNumbers';
import { DaySwitcher } from '../components/DaySwitcher';
import { DiagnosisMix } from '../components/DiagnosisMix';
import { MetricMeans } from '../components/MetricMeans';
import { StatusLine } from '../components/StatusLine';

const metric = (values: Partial<LiveMetricSpec>): LiveMetricSpec => ({
  metric_name: 'quality',
  label: 'Quality',
  group: 'quality',
  score_type: 'percentage',
  direction: 'maximize',
  pass_threshold: 0.8,
  unit: null,
  precision: null,
  is_primary: false,
  position: 0,
  description: null,
  values: null,
  ...values,
});
const specs = [
  metric({ is_primary: true }),
  metric({
    metric_name: 'category',
    label: 'Diagnosis',
    group: 'diagnosis',
    score_type: 'categorical',
    values: [
      { value: 'minor', label: 'Minor issue', tone: 'warning' },
      { value: 'major', label: 'Major issue', tone: 'danger' },
      { value: 'watch', label: 'Watch', tone: 'warning' },
      { value: 'unknown', label: 'Unknown', tone: 'neutral' },
    ],
  }),
  metric({ metric_name: 'skipped', label: 'Skipped metric', group: 'charts', position: 3 }),
  metric({ metric_name: 'duration', label: 'Duration', score_type: 'duration', position: 1 }),
  metric({ metric_name: 'numeric', label: 'Numeric', score_type: 'numeric', position: 2 }),
];
const overview: LiveOverview = {
  status: {
    id: 'source',
    key: 'worker',
    name: 'Worker',
    environment: 'test',
    product: null,
    stale: false,
    seconds_since_heartbeat: 42,
    last_heartbeat_at: '2026-11-01T09:00:00Z',
    last_turn_at: null,
    worker: { judges: { a: 'Judge A', b: 'Judge B' }, eval_code_version: 'v1', manifest_hash: 'hash1' },
  },
  day: {
    row: {
      id: 'day',
      source_id: 'source',
      day: '2026-11-01',
      run_ref: null,
      status: 'running',
      turns_seen: 14,
      evaluated: 8,
      failed: 2,
      incomplete: 2,
      excluded: 0,
      first_poll_at: null,
      last_poll_at: null,
      closed_at: null,
      polls: 1,
      max_poll_gap_s: 0,
      parameters: {},
    },
    in_qym: 12,
    not_in_qym: 2,
    label_mix: { minor: 1, major: 4, watch: 2, unknown: 5 },
    metric_means: [
      { metric_name: 'quality', mean: 0.71, n: 8, spec: specs[0]! },
      { metric_name: 'skipped', mean: null, n: 0, spec: specs[2]! },
      { metric_name: 'duration', mean: 6500, n: 8, spec: specs[3]! },
      { metric_name: 'numeric', mean: 1.234, n: 8, spec: specs[4]! },
    ],
    services: [],
    latency: { median_ms: 6500, p90_ms: 12000, over_5min: 0 },
    worker_gap_s: 0,
  },
  specs,
  primary_metric: 'quality',
  canaries: [],
  trend: [],
  days: { rows: [], total: 0, page: 1, page_size: 30 },
};
const linkTo = (filters: Record<string, string> = {}) =>
  `/projects/demo/live/turns?${new URLSearchParams({ day: '2026-11-01', source: 'worker', ...filters })}`;

afterEach(() => vi.useRealTimers());

describe('overview blocks', () => {
  it('links all six numbers and selects the largest problem labels using the spec tones', () => {
    const { container } = render(
      <MemoryRouter>
        <DayNumbers overview={overview} linkTo={linkTo} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(container.querySelector('[data-live-stat="major"] a')).toHaveAttribute(
      'href',
      linkTo({ label: 'major' }),
    );
    expect(container.querySelector('[data-live-stat="watch"]')).toHaveTextContent('2');
    expect(container.querySelector('[data-live-stat="unknown"]')).toBeNull();
    expect(container.querySelector('[data-live-stat="turns"]')).toHaveTextContent('14');
    expect(container.querySelector('[data-live-stat="evaluated"] a')).toHaveAttribute(
      'href',
      linkTo({ status: 'completed' }),
    );
    expect(container.querySelector('[data-live-stat="primary"]')).toHaveTextContent('71%');
    expect(container.querySelector('[data-live-stat="latency"]')).toHaveTextContent('6.5s');
  });

  it('keeps an all-skipped metric as a dash, formats types, and orders rows by the spec', () => {
    const { container } = render(<MetricMeans overview={overview} />);
    expect(
      [...container.querySelectorAll('[data-live-metric]')].map((el) => el.getAttribute('data-live-metric')),
    ).toEqual(['quality', 'duration', 'numeric', 'skipped']);
    expect(container.querySelector('[data-live-metric="duration"]')).toHaveTextContent('6.5s');
    expect(container.querySelector('[data-live-metric="numeric"]')).toHaveTextContent('1.23');
    const skipped = container.querySelector('[data-live-metric="skipped"]')!;
    expect(skipped).toHaveTextContent('Skipped metric—');
    expect(skipped.querySelector('[data-band]')).toBeNull();
    fireEvent.focus(skipped.querySelector('[data-mark]')!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('0 non-skipped scores');
  });

  it('links each diagnosis segment and reports the gap between worker counters and received rows', () => {
    const { container } = render(
      <MemoryRouter>
        <DiagnosisMix overview={overview} linkTo={linkTo} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Major issue: 4 turns' })).toHaveAttribute(
      'href',
      linkTo({ label: 'major' }),
    );
    expect(container.querySelector('[data-live-note="not-in-qym"]')).toHaveTextContent(
      '2 turns not yet in qym',
    );
  });

  it('distinguishes a measured zero duration from an absent mean', () => {
    const { container } = render(
      <MetricMeans
        overview={{
          ...overview,
          day: {
            ...overview.day,
            metric_means: overview.day.metric_means.map((row) =>
              row.metric_name === 'duration' ? { ...row, mean: 0 } : row,
            ),
          },
        }}
      />,
    );
    expect(container.querySelector('[data-live-metric="duration"]')).toHaveTextContent('0ms');
  });

  it('refreshes worker age every ten seconds, renders metadata and marks stale status', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T09:00:42Z'));
    const { container, rerender, unmount } = render(<StatusLine status={overview.status} />);
    expect(screen.getByText('last poll 42 s ago')).toBeVisible();
    expect(screen.getByText('Judge A')).toBeVisible();
    expect(screen.getByText('hash1')).toBeVisible();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('last poll 52 s ago')).toBeVisible();
    rerender(<StatusLine status={{ ...overview.status, stale: true }} />);
    expect(container.querySelector('[data-live-block="status"]')).toHaveAttribute('data-live-stale', 'true');
    expect(screen.getByText('Worker not heard from since 09:00 UTC')).toBeVisible();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('moves by UTC days while preserving source and disables next on today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T23:00:00Z'));
    function Switcher() {
      const location = useLocation();
      const params = new URLSearchParams(location.search);
      return (
        <>
          <DaySwitcher day={params.get('day')!} />
          <output aria-label="URL">{location.search}</output>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/live?day=2026-11-01&source=worker']}>
        <Switcher />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByLabelText('URL')).toHaveTextContent('day=2026-10-31&source=worker');
    expect(screen.getByRole('button', { name: 'Sat 31 Oct 2026' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Today · 1 Nov 2026' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Choose day' })).getByRole('group', { name: 'Day (UTC)' }),
    ).toBeInTheDocument();
  });
});
