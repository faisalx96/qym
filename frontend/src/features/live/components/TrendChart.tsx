import type { CSSProperties } from 'react';
import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { ChartCard } from '@/features/run-detail/components/charts/ChartCard';
import { BarColumns, useMeasuredWidth, type BarSpec } from '@/features/run-detail/components/charts/Charts';
import { formatDayKey, formatShortDayKey } from '@/lib/dates';
import { useSearchParamsState } from '@/lib/url-state';
import { SegmentedControl, type CardTone } from '@/ui';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import { columnPitch, formatPrimaryMean, trendColumns } from '../lib/trend';
import styles from '../live.module.css';

const toneFill: Record<CardTone, string> = {
  success: 'var(--success)',
  info: 'var(--accent-secondary)',
  warning: 'var(--warning)',
  danger: 'var(--error)',
  accent: 'var(--accent-primary)',
  meta: 'var(--accent-tertiary)',
  neutral: 'var(--text-muted)',
};

function stackedFill(stacks: ReturnType<typeof trendColumns>[number]['stacks'], total: number): string {
  if (!total) return toneFill.neutral;
  let start = 0;
  const stops = stacks.map((stack) => {
    const end = start + (stack.n / total) * 100;
    const stop = `${stack.dark ? 'var(--text-dim)' : toneFill[stack.tone]} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return `linear-gradient(to top, ${stops.join(', ')})`;
}

export function TrendChart({
  trend,
  specs,
  primaryMetric,
  days,
  onDays,
}: {
  trend: LiveOverview['trend'];
  specs: LiveMetricSpec[];
  primaryMetric: string | null;
  days: number;
  onDays: (days: number) => void;
}) {
  const { replaceUrlQuery } = useSearchParamsState();
  const [plotRef, width] = useMeasuredWidth<HTMLDivElement>(280);
  const columns = trendColumns(trend, specs);
  const pitch = columnPitch(width, columns.length);
  const dense = pitch.gap === 1;
  // At the narrowest shell width, use part of the card padding to retain the two-pixel minimum.
  const overhang = Math.max(0, ((pitch.bar + pitch.gap) * columns.length - width) / 2);
  const counts: Record<string, number> = {};
  for (const column of columns) {
    for (const stack of column.stacks) {
      if (stack.value !== null) counts[stack.value] = (counts[stack.value] ?? 0) + stack.n;
    }
  }
  // Include the spec's labels even when the entire window has no turns.
  const spec = diagnosisSpec(specs);
  const legendCounts = { ...counts };
  for (const item of spec?.values ?? []) {
    if (typeof item.value === 'string') legendCounts[item.value] = legendCounts[item.value] || 1;
  }
  const labels: { value: string | null; label: string; tone: CardTone; dark: boolean }[] = mixSegments(
    legendCounts,
    spec,
  );
  if (columns.some((column) => column.stacks.some((stack) => stack.value === null))) {
    labels.push({ value: null, label: 'Undiagnosed', tone: 'neutral', dark: false });
  }
  const primary =
    specs.find((item) => item.is_primary) ?? specs.find((item) => item.metric_name === primaryMetric);
  const primaryLabel = primary?.label ?? 'Primary mean';
  const showRate = primary?.score_type === 'percentage' || primary?.score_type === 'boolean';
  const bars: BarSpec[] = columns.map((column) => ({
    key: column.day,
    count: column.total,
    label: formatShortDayKey(column.day),
    zero: column.gap ? 'hide' : 'show',
    color: column.gap
      ? 'repeating-linear-gradient(135deg, var(--border-strong) 0 var(--space-xs), var(--bg-elevated) var(--space-xs) var(--space-sm))'
      : stackedFill(column.stacks, column.total),
    name: `${formatDayKey(column.day)}: ${column.total} turns, ${primaryLabel} ${formatPrimaryMean(column.rate, primary)}${column.gap ? ', worker gap' : ''}`,
    tip: (
      <div>
        <strong>{formatDayKey(column.day)}</strong>
        {column.gap ? <p>Worker gap · heartbeat interval exceeded</p> : null}
        <p>
          {column.total} turns · {primaryLabel} {formatPrimaryMean(column.rate, primary)}
        </p>
        {column.stacks.map((stack) => (
          <div key={JSON.stringify(stack.value)} dir="auto">
            {stack.label}: {stack.n}
          </div>
        ))}
      </div>
    ),
    onPick: () => replaceUrlQuery({ day: column.day }),
    data: { 'data-live-trend-day': column.day, 'data-live-gap': String(column.gap) },
  }));
  // Missing scores and worker gaps break the line, rather than implying a measured zero.
  const lines: { day: string; x: number; y: number }[][] = [];
  let points: (typeof lines)[number] = [];
  columns.forEach((column, index) => {
    if (!showRate || column.gap || column.rate === null) {
      points = [];
      return;
    }
    if (!points.length) lines.push(points);
    points.push({ day: column.day, x: ((index + 0.5) / columns.length) * 100, y: 100 - column.rate * 100 });
  });

  return (
    <ChartCard
      title="Turns over time"
      data-live-block="trend"
      titleMeta={
        columns.length
          ? `${formatShortDayKey(columns[0]!.day)} – ${formatShortDayKey(columns.at(-1)!.day)}`
          : undefined
      }
      legend={
        <span className={styles.inline}>
          {labels.map((label) => (
            <span
              key={JSON.stringify(label.value)}
              className={styles.inline}
              data-tone={label.tone}
              data-dark={label.dark ? '' : undefined}
            >
              <span className={styles.swatch} aria-hidden="true" />
              <span dir="auto">{label.label}</span>
            </span>
          ))}
          {showRate ? (
            <span className={styles.inline}>
              <span className={styles.lineKey} aria-hidden="true" />
              {primaryLabel} · 0–100%
            </span>
          ) : null}
        </span>
      }
      controls={
        <SegmentedControl
          label="Trend period"
          options={[
            { value: '14', label: '14d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
          ]}
          value={String(days)}
          onChange={(value) => onDays(Number(value))}
        />
      }
    >
      <div ref={plotRef}>
        <ChartTooltipHost
          className={styles.trendPlot}
          data-live-block="trend-plot"
          data-dense={String(dense)}
          style={{ '--live-trend-overhang': `${overhang}px` } as CSSProperties}
        >
          <BarColumns
            bars={bars}
            name={`Daily turns by diagnosis and ${primaryLabel}`}
            className={styles.trendColumns}
          />
          {showRate ? (
            <>
              <svg
                className={styles.rateLine}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <Mark as="g">
                  {lines
                    .filter((line) => line.length > 1)
                    .map((line) => (
                      <polyline key={line[0]!.day} points={line.map(({ x, y }) => `${x},${y}`).join(' ')} />
                    ))}
                </Mark>
              </svg>
              {/* No viewBox: marker radii stay in CSS pixels while percentage centres follow the same pitch. */}
              <svg className={styles.rateLine} aria-hidden="true">
                <Mark as="g">
                  {lines
                    .filter((line) => line.length === 1)
                    .map(([point]) => (
                      <circle
                        key={point!.day}
                        data-live-rate-point={point!.day}
                        cx={`${point!.x}%`}
                        cy={`${point!.y}%`}
                        r={2.5}
                      />
                    ))}
                </Mark>
              </svg>
            </>
          ) : null}
        </ChartTooltipHost>
      </div>
    </ChartCard>
  );
}
