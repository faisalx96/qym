import { describe, expect, it } from 'vitest';
import { formatCount, formatKpiPercent, kpiEntries, kpiScope } from '@/lib/kpis';
import {
  formatDurationMs,
  formatLatency,
  formatMetricValueSmart,
  formatNumericValue,
  formatRelative,
} from '@/lib/format';

describe('kpis', () => {
  it('formats counts and floors percentages', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(1_250_000)).toBe('1.3M');
    expect(formatKpiPercent(null)).toBe('—');
    expect(formatKpiPercent(1)).toBe('100%');
    expect(formatKpiPercent(0.99999)).toBe('99.9%');
    expect(formatKpiPercent(0.0004)).toBe('<0.1%');
    expect(formatKpiPercent(0)).toBe('0%');
  });
  it('has exactly five entries with the legacy labels', () => {
    const kpis = {
      scope: 'filtered' as const,
      runs: 1,
      models: 2,
      items: 3,
      execution_success: 0.5,
      runs_with_errors: 0,
    };
    const entries = kpiEntries(kpis);
    expect(entries.map((e) => e.name)).toEqual([
      'Runs',
      'Execution success',
      'Runs with errors',
      'Models',
      'Items',
    ]);
    expect(entries[0]!.label).toBe('run');
    expect(entries[2]!.color).toBe('muted');
    expect(kpiScope(kpis).label).toBe('Filtered runs');
    expect(kpiScope(null).label).toBe('All runs');
  });
});

describe('format', () => {
  it('latency and duration', () => {
    expect(formatLatency(null)).toBe('—');
    expect(formatLatency(967)).toBe('967ms');
    expect(formatLatency(1523)).toBe('1.5s');
    expect(formatLatency(65_000)).toBe('1m 5s');
    expect(formatDurationMs(43_343)).toBe('43s');
    expect(formatDurationMs(3_600_000 + 120_000)).toBe('1h 2m');
  });
  it('smart decimals add precision only on collisions', () => {
    expect(formatMetricValueSmart(0.8525, 'score', [0.8525, 0.851])).toBe('85.3%');
    expect(formatMetricValueSmart(0.8525, 'score', [0.8526])).toBe('85.25%');
    expect(formatMetricValueSmart(1.6, 'numeric', [1.6])).toBe('1.6');
    expect(formatMetricValueSmart(null, 'score')).toBe('—');
    expect(formatNumericValue(12_345)).toBe('12.3K');
  });
  it('relative time', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(formatRelative('2026-10-11T11:59:50Z', now)).toBe('just now');
    expect(formatRelative('2026-10-11T11:30:00Z', now)).toBe('30m ago');
    expect(formatRelative('2026-10-06T12:00:00Z', now)).toBe('5d ago');
  });
});
