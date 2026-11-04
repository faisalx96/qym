import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import type { CardTone } from '@/ui';
import { formatDurationMs, formatPercentValue } from '@/lib/format';
import { diagnosisSpec, mixSegments } from './mix';

/** Columns include half a gap at each edge, so their centres stay at (i + 0.5) * width / count. */
export function columnPitch(width: number, count: number): { bar: number; gap: number } {
  const gap = count * (3 + 4) > width ? 1 : 4;
  return { bar: count > 0 ? Math.max(gap === 1 ? 2 : 3, width / count - gap) : 0, gap };
}

export function formatPrimaryMean(value: number | null, spec: LiveMetricSpec | undefined): string {
  if (value === null) return '—';
  if (spec?.score_type === 'duration') return formatDurationMs(value);
  if (spec?.score_type === 'percentage' || spec?.score_type === 'boolean') {
    return formatPercentValue(value, 0);
  }
  return value.toFixed(2);
}

export function trendColumns(
  trend: LiveOverview['trend'],
  specs: LiveMetricSpec[],
): {
  day: string;
  stacks: { value: string | null; label: string; tone: CardTone; n: number }[];
  rate: number | null;
  gap: boolean;
  total: number;
}[] {
  const spec = diagnosisSpec(specs);
  return trend.map((entry) => {
    const stacks: { value: string | null; label: string; tone: CardTone; n: number }[] = mixSegments(
      entry.counts_by_label,
      spec,
    ).map(({ value, label, tone, n }) => ({ value, label, tone, n }));
    const undiagnosed = entry.turns - stacks.reduce((sum, stack) => sum + stack.n, 0);
    if (undiagnosed > 0) stacks.push({ value: null, label: 'Undiagnosed', tone: 'neutral', n: undiagnosed });
    return {
      day: entry.day,
      stacks,
      rate: entry.primary_rate,
      gap: entry.worker_gap,
      total: entry.turns,
    };
  });
}
