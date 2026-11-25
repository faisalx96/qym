import { describe, expect, it } from 'vitest';
import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import {
  columnPitch,
  trendAxisLabels,
  trendColumns,
  trendDayLabel,
  trendLabels,
  turnScale,
} from '../lib/trend';
import { diagnosisSpec, mixSegments } from '../lib/mix';

const diagnosis: LiveMetricSpec = {
  metric_name: 'diagnosis',
  group: 'diagnosis',
  label: 'Diagnosis',
  score_type: 'categorical',
  direction: null,
  pass_threshold: null,
  unit: null,
  precision: null,
  is_primary: true,
  position: 1,
  description: null,
  values: [
    { value: 'ok', label: 'OK', tone: 'accent' },
    { value: 'problem', label: 'Problem', tone: 'danger' },
    { value: 'other', label: 'Other', tone: 'neutral' },
  ],
};
const trend: LiveOverview['trend'] = [
  {
    day: '2026-10-30',
    turns: 8,
    counts_by_label: { new_label: 1, problem: 2, ok: 4 },
    primary_rate: 0.75,
    worker_gap: false,
  },
  { day: '2026-10-31', turns: 0, counts_by_label: {}, primary_rate: null, worker_gap: true },
  { day: '2026-11-01', turns: 0, counts_by_label: {}, primary_rate: null, worker_gap: false },
];

describe('trendColumns', () => {
  it('uses the mix tones for every diagnosis, including inconclusive', () => {
    const spec = {
      ...diagnosis,
      values: [
        { value: 'system_problem', label: 'System problem', tone: 'meta' },
        { value: 'inconclusive', label: 'Inconclusive', tone: 'neutral' },
      ],
    };
    const counts = { inconclusive: 3 };
    expect(trendColumns([{ ...trend[0]!, turns: 4, counts_by_label: counts }], [spec])[0]?.stacks).toEqual([
      ...mixSegments(counts, diagnosisSpec([spec])).map(({ value, label, tone, dark, color, n }) => ({
        value,
        label,
        tone,
        dark,
        color,
        n,
      })),
      { value: null, label: 'Undiagnosed', tone: 'neutral', dark: false, color: 'var(--text-muted)', n: 1 },
    ]);
  });
  it('keeps every day, including zero days, with totals and missing rates intact', () => {
    const columns = trendColumns(trend, [diagnosis]);
    expect(columns.map(({ day, total, rate }) => ({ day, total, rate }))).toEqual([
      { day: '2026-10-30', total: 8, rate: 0.75 },
      { day: '2026-10-31', total: 0, rate: null },
      { day: '2026-11-01', total: 0, rate: null },
    ]);
    expect(trendColumns([], [diagnosis])).toEqual([]);
  });

  it('distinguishes a worker gap from a quiet day', () => {
    expect(trendColumns(trend, [diagnosis]).map((column) => column.gap)).toEqual([false, true, false]);
  });

  it('orders stacks by the primary categorical diagnosis spec and puts unknown labels last', () => {
    const secondary = {
      ...diagnosis,
      is_primary: false,
      position: 0,
      values: [...diagnosis.values!].reverse(),
    };
    expect(trendColumns(trend, [secondary, diagnosis])[0]?.stacks).toMatchObject([
      { value: 'ok', tone: 'success', n: 4 },
      { value: 'problem', tone: 'danger', n: 2 },
      { value: 'other', tone: 'neutral', n: 0 },
      { value: 'new_label', tone: 'neutral', dark: false, n: 1 },
      { value: null, label: 'Undiagnosed', tone: 'neutral', dark: false, n: 1 },
    ]);
    expect(trendColumns(trend, [])[0]?.stacks).toMatchObject([
      { value: 'new_label', tone: 'neutral', dark: false, n: 1 },
      { value: 'problem', tone: 'neutral', n: 2 },
      { value: 'ok', tone: 'neutral', n: 4 },
      { value: null, label: 'Undiagnosed', tone: 'neutral', dark: false, n: 1 },
    ]);
  });

  it('retains undiagnosed turns in the stack denominator', () => {
    const column = trendColumns([{ ...trend[0]!, turns: 8, counts_by_label: { ok: 4 } }], [diagnosis])[0]!;
    expect(column.total).toBe(8);
    expect(column.stacks.at(-1)).toEqual({
      value: null,
      label: 'Undiagnosed',
      tone: 'neutral',
      dark: false,
      color: 'var(--text-muted)',
      n: 4,
    });
    expect(column.stacks.find((stack) => stack.value === 'ok')!.n / column.total).toBe(0.5);
    expect(column.stacks.reduce((sum, stack) => sum + stack.n, 0)).toBe(8);
    expect(trendColumns([trend[2]!], [diagnosis])[0]?.stacks).toEqual([]);
  });
});

describe('trendDayLabel', () => {
  it('keeps the month boundary and demotes a colliding first label only at narrow pitch', () => {
    const days = Array.from({ length: 14 }, (_, index) =>
      new Date(Date.UTC(2026, 9, 31 + index)).toISOString().slice(0, 10),
    );
    expect(trendLabels(days, 20).slice(0, 2)).toEqual([
      { label: '31', labelPriority: false },
      { label: 'Nov 1', labelPriority: true },
    ]);
    expect(trendLabels(days, 60).slice(0, 2)).toEqual([
      { label: 'Oct 31', labelPriority: true },
      { label: 'Nov 1', labelPriority: true },
    ]);
  });

  it('marks the first day and month boundaries in UTC, including across years', () => {
    expect(trendDayLabel('2026-10-26', true)).toBe('Oct 26');
    expect(trendDayLabel('2026-10-31', false)).toBe('31');
    expect(trendDayLabel('2026-11-01', false)).toBe('Nov 1');
    expect(trendDayLabel('2027-01-01', false)).toBe('Jan 1');
    expect(trendDayLabel('2027-01-02', false)).toBe('02');
  });
});

describe('columnPitch', () => {
  it('keeps the normal four-pixel gap when the columns fit', () => {
    const { bar, gap } = columnPitch(358, 14);
    expect(gap).toBe(4);
    expect(bar).toBeGreaterThanOrEqual(3);
    expect((bar + gap) * 14).toBeCloseTo(358);
  });

  it('fits ninety columns in 358 pixels with a one-pixel gap and at least two-pixel bars', () => {
    const { bar, gap } = columnPitch(358, 90);
    expect(gap).toBe(1);
    expect(bar).toBeGreaterThanOrEqual(2);
    expect((bar + gap) * 90).toBeCloseTo(358);
    expect(columnPitch(630, 90).gap).toBe(4);
    expect(columnPitch(629, 90).gap).toBe(1);
    expect(columnPitch(237, 90)).toEqual({ bar: 2, gap: 1 });
    expect(columnPitch(0, 0)).toEqual({ bar: 0, gap: 4 });
  });
});

describe('history axes', () => {
  it.each([
    [0, [0, 1, 2]],
    [1, [0, 1, 2]],
    [8, [0, 5, 10]],
    [37, [0, 20, 40]],
    [1001, [0, 1000, 2000]],
  ])('rounds %s turns up to clean whole-number ticks', (max, ticks) => {
    expect(turnScale(max)).toEqual({ max: ticks.at(-1), ticks });
  });

  it.each([200, 350, 1200])('fits ninety date labels in %s pixels without collisions', (width) => {
    const days = Array.from({ length: 90 }, (_, index) =>
      new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10),
    );
    const shown = trendAxisLabels(days, width).filter((label) => label.visible);
    for (const [index, label] of shown.entries()) {
      expect(label.left).toBeGreaterThanOrEqual(-3);
      expect(label.right).toBeLessThanOrEqual(width + 3);
      if (index) expect(label.left).toBeGreaterThanOrEqual(shown[index - 1]!.right);
    }
    expect(shown.filter((label) => label.labelPriority).map((label) => label.label)).toEqual([
      'Sep 1',
      'Oct 1',
      'Nov 1',
    ]);
  });
});
