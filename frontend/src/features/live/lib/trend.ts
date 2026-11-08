import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import type { CardTone } from '@/ui';
import { APP_LOCALE } from '@/lib/dates';
import { formatDurationMs, formatPercentValue } from '@/lib/format';
import { CHAR_PX } from '@/features/run-detail/components/charts/chartLabels';
import { diagnosisSpec, mixSegments } from './mix';

const monthFormat = new Intl.DateTimeFormat(APP_LOCALE, { month: 'short', timeZone: 'UTC' });

export function trendDayLabel(day: string, first: boolean): string {
  return first || day.endsWith('-01')
    ? `${Number(day.slice(8))} ${monthFormat.format(new Date(`${day}T00:00:00Z`))}`
    : day.slice(8);
}

/** Month boundaries take precedence when the first date label would overlap them. */
export function trendLabels(days: string[], pitch: number) {
  const labels = days.map((day, index) => ({
    label: trendDayLabel(day, index === 0),
    labelPriority: index === 0 || day.endsWith('-01'),
  }));
  const first = labels[0];
  if (
    first &&
    labels.some(
      (item, index) =>
        index > 0 &&
        item.labelPriority &&
        index * pitch < ((first.label.length + item.label.length) * CHAR_PX) / 2 + 6,
    )
  ) {
    first.label = days[0]!.slice(8);
    first.labelPriority = false;
  }
  return labels;
}

/** Inconclusive is distinct from undiagnosed only in the trend stacks and legend. */
export function trendSegments(counts: Record<string, number>, spec: LiveMetricSpec | null) {
  return mixSegments(counts, spec).map((segment) => ({
    ...segment,
    tone: segment.value === 'inconclusive' ? ('meta' as const) : segment.tone,
  }));
}

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
    const stacks: { value: string | null; label: string; tone: CardTone; n: number }[] = trendSegments(
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
