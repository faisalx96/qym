import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import type { CardTone } from '@/ui';
import { formatShortDayKey } from '@/lib/dates';
import { formatDurationMs, formatPercentValue } from '@/lib/format';
import { CHAR_PX } from '@/features/run-detail/components/charts/chartLabels';
import { diagnosisSpec, mixSegments } from './mix';

export function trendDayLabel(day: string, first: boolean): string {
  return first || day.endsWith('-01') ? formatShortDayKey(day) : day.slice(8);
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

/** Columns include half a gap at each edge, so their centres stay at (i + 0.5) * width / count. */
export function columnPitch(width: number, count: number): { bar: number; gap: number } {
  const gap = count * (3 + 4) > width ? 1 : 4;
  return { bar: count > 0 ? Math.max(gap === 1 ? 2 : 3, width / count - gap) : 0, gap };
}

export function formatPrimaryMean(value: number | null, spec: LiveMetricSpec | undefined): string {
  if (value === null) return '—';
  if (spec?.score_type === 'duration') return formatDurationMs(value);
  if (spec?.score_type === 'percentage' || spec?.score_type === 'boolean') {
    return formatPercentValue(value, 1);
  }
  return value.toFixed(2);
}

export function trendColumns(
  trend: LiveOverview['trend'],
  specs: LiveMetricSpec[],
): {
  day: string;
  stacks: { value: string | null; label: string; tone: CardTone; dark: boolean; color: string; n: number }[];
  rate: number | null;
  gap: boolean;
  total: number;
}[] {
  const spec = diagnosisSpec(specs);
  return trend.map((entry) => {
    const stacks: {
      value: string | null;
      label: string;
      tone: CardTone;
      dark: boolean;
      color: string;
      n: number;
    }[] = mixSegments(entry.counts_by_label, spec).map(({ value, label, tone, dark, color, n }) => ({
      value,
      label,
      tone,
      dark,
      color,
      n,
    }));
    const undiagnosed = entry.turns - stacks.reduce((sum, stack) => sum + stack.n, 0);
    if (undiagnosed > 0)
      stacks.push({
        value: null,
        label: 'Undiagnosed',
        tone: 'neutral',
        dark: false,
        color: 'var(--text-muted)',
        n: undiagnosed,
      });
    return {
      day: entry.day,
      stacks,
      rate: entry.primary_rate,
      gap: entry.worker_gap,
      total: entry.turns,
    };
  });
}

/** Three whole-number ticks, rounded up to a 1/2/5 step. */
export function turnScale(max: number): { max: number; ticks: number[] } {
  const target = Math.max(1, max / 2);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find((factor) => factor * magnitude >= target)! * magnitude;
  return { max: step * 2, ticks: [0, step, step * 2] };
}

/** Fit the shared date axis, giving month boundaries priority and keeping edge labels inside the plot. */
export function trendAxisLabels(days: string[], width: number) {
  const pitch = width / Math.max(1, days.length);
  const labels = trendLabels(days, pitch).map((item, index) => {
    const half = (item.label.length * CHAR_PX) / 2;
    const x = Math.max(half, Math.min(width - half, (index + 0.5) * pitch));
    return { ...item, index, x, left: x - half - 3, right: x + half + 3, visible: false };
  });
  const shown: typeof labels = [];
  for (const item of [...labels].sort((a, b) => Number(b.labelPriority) - Number(a.labelPriority))) {
    if (shown.every((other) => item.right <= other.left || item.left >= other.right)) {
      item.visible = true;
      shown.push(item);
    }
  }
  return labels;
}
