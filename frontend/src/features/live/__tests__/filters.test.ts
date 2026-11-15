import { describe, expect, it } from 'vitest';
import { liveTurnsQuery, type LiveFilters, type LiveMetricSpec } from '@/api/live';
import { filterChips, listedScoreColumns } from '../lib/filters';

const metric = (name: string, overrides: Partial<LiveMetricSpec> = {}): LiveMetricSpec => ({
  metric_name: name,
  group: 'quality',
  label: name,
  score_type: 'percentage',
  direction: 'maximize',
  pass_threshold: 1,
  unit: null,
  precision: null,
  is_primary: false,
  position: 0,
  description: null,
  values: null,
  ...overrides,
});
const specs = [
  metric('diagnosis', {
    group: 'diagnosis',
    score_type: 'categorical',
    values: [{ value: 'agent_problem', label: 'Agent problem', tone: 'danger' }],
  }),
  metric('compliance_a'),
];

describe('filterChips', () => {
  it('uses the categorical spec label and the metric key for a numeric bound', () => {
    expect(
      filterChips({ labels: ['agent_problem'], metric: 'compliance_a', min: 0.5 }, undefined, specs).map(
        (chip) => chip.label,
      ),
    ).toEqual(['Diagnosis: Agent problem', 'compliance_a ≥ 0.5']);
  });

  it('labels Live days, ranges, service status, searches and zero bounds', () => {
    const filters: LiveFilters = {
      day: '2026-11-01',
      service: 'x',
      service_status: 'not_ok',
      q: 'إجمالي',
      metric: 'compliance_a',
      min: 0,
      max: 0.5,
    };
    expect(filterChips(filters, undefined, specs).map((chip) => chip.label)).toEqual([
      'Nov 1, 2026',
      'compliance_a ≥ 0',
      'compliance_a ≤ 0.5',
      'x not ok',
      'Search: إجمالي',
    ]);
    expect(filterChips({ from: '2026-10-31', to: '2026-11-01' }, undefined, []).map((c) => c.label)).toEqual([
      'Oct 31, 2026 – Nov 1, 2026',
    ]);
  });

  it('removes only the selected value without mutating filters and resets pagination', () => {
    const filters = {
      labels: ['agent_problem', 'new_label'],
      day: '2026-11-01',
      page: 3,
      sort: '-latency_ms',
    };
    const chip = filterChips(filters, undefined, specs).find(
      (item) => item.label === 'Diagnosis: Agent problem',
    )!;
    expect(chip.onRemove(filters)).toEqual({ labels: ['new_label'], day: '2026-11-01', sort: '-latency_ms' });
    expect(filters.labels).toEqual(['agent_problem', 'new_label']);
    expect(filters.page).toBe(3);
    expect(filterChips(filters, undefined, specs).map((item) => item.label)).toContain(
      'Diagnosis: new_label',
    );
  });

  it('removes dependent service and metric fields together when appropriate', () => {
    const service = { service: 'x', service_status: 'not_ok', q: 'query', page: 2 };
    expect(filterChips(service, undefined, specs)[0]!.onRemove(service)).toEqual({ q: 'query' });
    const score = { metric: 'compliance_a', min: 0.5, page: 2 };
    expect(filterChips(score, undefined, specs)[0]!.onRemove(score)).toEqual({});
    const both = { ...score, max: 1 };
    expect(filterChips(both, undefined, specs)[0]!.onRemove(both)).toEqual({
      metric: 'compliance_a',
      max: 1,
    });
  });

  it('omits default page size and sort when removing a chip', () => {
    const filters = { day: '2026-11-01', page: 1, page_size: 50, sort: '-turn_at' };
    const next = filterChips(filters, undefined, specs)[0]!.onRemove(filters);
    expect(next).not.toHaveProperty('page_size');
    expect(next).not.toHaveProperty('page');
    expect(next).not.toHaveProperty('sort');
    expect(liveTurnsQuery(next).toString()).toBe('');
    expect(filters).toEqual({ day: '2026-11-01', page: 1, page_size: 50, sort: '-turn_at' });
  });

  it('preserves non-default page size and sort when removing a chip', () => {
    const filters = { day: '2026-11-01', page: 3, page_size: 100, sort: 'latency_ms' };
    expect(filterChips(filters, undefined, specs)[0]!.onRemove(filters)).toEqual({
      page_size: 100,
      sort: 'latency_ms',
    });
  });

  it('covers all URL filters but does not turn sort or pagination into chips', () => {
    const filters: LiveFilters = {
      statuses: ['incomplete_ingest'],
      outcomes: ['error'],
      modes: ['chat'],
      charts: 'failed',
      user: 'user-1',
      conversation: 'conversation/1',
      sort: '-turn_at',
      page: 2,
      page_size: 50,
    };
    const chips = filterChips(filters, undefined, specs);
    expect(chips.map((chip) => chip.label)).toEqual([
      'Status: Incomplete ingest',
      'Outcome: Error',
      'Mode: chat',
      'Charts: failed',
      'User: user-1',
      'Conversation: conversation/1',
    ]);
    expect(new Set(chips.map((chip) => chip.key)).size).toBe(chips.length);
    expect(filterChips({}, undefined, [])).toEqual([]);
  });
});

describe('listedScoreColumns', () => {
  it('matches the backend: primary first, then three quality/chart specs by position and name', () => {
    const values = [
      metric('z', { position: 2 }),
      metric('service.x', { group: 'service', position: -1 }),
      metric('primary', { is_primary: true, position: 10 }),
      metric('chart', { group: 'charts', position: 1 }),
      metric('a', { position: 2 }),
      metric('extra', { position: 3 }),
      specs[0]!,
    ];
    const original = [...values];
    expect(listedScoreColumns(values).map((spec) => spec.metric_name)).toEqual([
      'primary',
      'chart',
      'a',
      'z',
    ]);
    expect(values).toEqual(original);
  });

  it('supports missing primaries and empty specs', () => {
    expect(listedScoreColumns([metric('a'), specs[0]!]).map((spec) => spec.metric_name)).toEqual(['a']);
    expect(listedScoreColumns([])).toEqual([]);
  });
});
