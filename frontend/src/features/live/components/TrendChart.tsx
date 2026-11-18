import type { CSSProperties, ReactNode } from 'react';
import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { ChartCard } from '@/features/run-detail/components/charts/ChartCard';
import { useMeasuredWidth } from '@/features/run-detail/components/charts/Charts';
import { formatDayKey, formatShortDayKey } from '@/lib/dates';
import { textDirAttrs } from '@/lib/text';
import { useSearchParamsState } from '@/lib/url-state';
import { SegmentedControl, Text, type CardTone } from '@/ui';
import { ChartTooltipHost, Mark, TipBody } from '@/ui/Chart';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import { formatPrimaryMean, trendAxisLabels, trendColumns, turnScale } from '../lib/trend';
import styles from '../live.module.css';

function stackedFill(stacks: ReturnType<typeof trendColumns>[number]['stacks'], total: number): string {
  if (!total) return 'var(--text-muted)';
  let start = 0;
  const visible = stacks.filter((stack) => stack.n > 0);
  const stops = visible.map((stack, index) => {
    const end = start + (stack.n / total) * 100;
    const from = index === 0 ? `${start}%` : `calc(${start}% + 1px)`;
    const to = index === visible.length - 1 ? `${end}%` : `calc(${end}% - 1px)`;
    const stop = `${stack.color} ${from} ${to}${index < visible.length - 1 ? `, var(--bg-surface) ${to} calc(${end}% + 1px)` : ''}`;
    start = end;
    return stop;
  });
  return `linear-gradient(to top, ${stops.join(', ')})`;
}

/** One labelled y-axis and hairline grid for one scale. */
function Scale({ ticks, max, percent = false }: { ticks: number[]; max: number; percent?: boolean }) {
  return (
    <>
      <div className={styles.trendYAxis} data-live-axis={percent ? 'rate' : 'turns'} aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ bottom: `${(tick / max) * 100}%` }}>
            {tick}
            {percent ? '%' : ''}
          </span>
        ))}
      </div>
      <div className={styles.trendGrid} aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ bottom: `${(tick / max) * 100}%` }} />
        ))}
      </div>
    </>
  );
}

export function TrendChart({
  trend,
  specs,
  primaryMetric,
  days,
  onDays,
}: {
  zone?: string;
  trend: LiveOverview['trend'];
  specs: LiveMetricSpec[];
  primaryMetric: string | null;
  days: number;
  onDays: (days: number) => void;
}) {
  const { replaceUrlQuery } = useSearchParamsState();
  const [plotRef, width] = useMeasuredWidth<HTMLDivElement>(280);
  const columns = trendColumns(trend, specs);
  const scale = turnScale(Math.max(0, ...columns.map((column) => column.total)));
  const counts: Record<string, number> = {};
  for (const column of columns) {
    for (const stack of column.stacks) {
      if (stack.value !== null) counts[stack.value] = (counts[stack.value] ?? 0) + stack.n;
    }
  }
  const spec = diagnosisSpec(specs);
  const legendCounts = { ...counts };
  for (const item of spec?.values ?? []) {
    if (typeof item.value === 'string') legendCounts[item.value] = legendCounts[item.value] || 1;
  }
  const labels: { value: string | null; label: string; tone: CardTone; dark: boolean; color: string }[] =
    mixSegments(legendCounts, spec);
  // A missing diagnosis is not evidence of a pending evaluation. The trend API has no evaluated count.
  if (columns.some((column) => column.stacks.some((stack) => stack.value === null))) {
    labels.push({
      value: null,
      label: 'Undiagnosed',
      tone: 'neutral',
      dark: false,
      color: 'var(--text-muted)',
    });
  }
  const primary =
    specs.find((item) => item.is_primary) ?? specs.find((item) => item.metric_name === primaryMetric);
  const primaryLabel = primary?.label ?? 'Primary mean';
  const showRate = primary?.score_type === 'percentage' || primary?.score_type === 'boolean';
  const axisLabels = trendAxisLabels(
    columns.map((column) => column.day),
    width,
  );
  const points = columns.map((column, index) => ({
    index,
    rate: column.gap ? null : column.rate,
    x: ((index + 0.5) / columns.length) * 100,
  }));
  const lines: { x: number; y: number }[][] = [];
  let line: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point.rate === null) {
      if (line.length) lines.push(line);
      line = [];
    } else line.push({ x: point.x, y: 100 - Math.max(0, Math.min(1, point.rate)) * 100 });
  }
  if (line.length) lines.push(line);
  const measured = points.filter((point) => point.rate !== null);
  const lowest = measured.reduce<(typeof points)[number] | undefined>(
    (low, point) => (low === undefined || point.rate! < low.rate! ? point : low),
    undefined,
  );
  const tip = (column: (typeof columns)[number]) => (
    <TipBody
      title={formatDayKey(column.day)}
      rows={[
        ...labels.map((label): [ReactNode, ReactNode] => [
          <span {...textDirAttrs(label.label)}>{label.label}</span>,
          column.stacks.find((stack) => stack.value === label.value)?.n ?? 0,
        ]),
        ['Total', column.total],
        [
          <span {...textDirAttrs(primaryLabel)}>{primaryLabel}</span>,
          formatPrimaryMean(column.rate, primary),
        ],
      ]}
      hint={column.gap ? 'Worker gap · Select to open this day' : 'Select to open this day'}
    />
  );
  const name = (column: (typeof columns)[number]) =>
    `${formatDayKey(column.day)}: ${column.total} turns${column.gap ? ', worker gap' : ''}; ${primaryLabel} ${formatPrimaryMean(column.rate, primary)}`;
  return (
    <div data-live-block="trend">
      <ChartCard
        title="Turns over time"
        headingAs="h2"
        slot={false}
        titleMeta={
          columns.length
            ? `${formatShortDayKey(columns[0]!.day)} – ${formatShortDayKey(columns.at(-1)!.day)}`
            : undefined
        }
        controls={
          <SegmentedControl
            label="Trend period"
            value={String(days)}
            onChange={(value) => onDays(Number(value))}
            options={[14, 30, 90].map((value) => ({ value: String(value), label: `${value}d` }))}
          />
        }
      >
        <div className={styles.trendContent}>
          <div className={styles.inline} aria-label="Diagnoses">
            {labels.map((label) => (
              <span
                key={label.value ?? '__undiagnosed'}
                className={styles.legendItem}
                data-tone={label.tone}
                data-dark={label.dark ? '' : undefined}
              >
                <span className={styles.swatch} style={{ background: label.color }} aria-hidden="true" />
                <span {...textDirAttrs(label.label)}>{label.label}</span>
              </span>
            ))}
          </div>
          <ChartTooltipHost
            className={styles.trendPlot}
            data-live-block="trend-plot"
            data-dense={width / Math.max(1, columns.length) < 7 ? 'true' : 'false'}
            style={{ '--live-day-count': Math.max(1, columns.length) } as CSSProperties}
          >
            <Text as="h3" variant="sm" weight={600} className={styles.trendTitle}>
              Turns per day, by diagnosis
            </Text>
            <div
              className={styles.trendPanel}
              data-live-panel="turns"
              role="group"
              aria-label="Turns per day, by diagnosis"
            >
              <Scale ticks={scale.ticks} max={scale.max} />
              <div className={styles.trendArea} ref={plotRef}>
                <div className={styles.trendColumns}>
                  {columns.map((column, index) => (
                    <Mark
                      key={column.day}
                      as="button"
                      className={styles.trendDay}
                      tip={tip(column)}
                      aria-label={name(column)}
                      onPick={() => replaceUrlQuery({ day: column.day })}
                      data-live-trend-day={column.day}
                      data-live-gap={String(column.gap)}
                    >
                      <span
                        className={styles.trendBar}
                        data-part="bar"
                        style={{
                          blockSize: `${column.gap ? 100 : (column.total / scale.max) * 100}%`,
                          background: column.gap
                            ? 'repeating-linear-gradient(135deg, var(--border-strong) 0 var(--space-xs), var(--bg-elevated) var(--space-xs) var(--space-sm))'
                            : stackedFill(column.stacks, column.total),
                        }}
                      >
                        {index === columns.length - 1 && !column.gap ? (
                          <span className={styles.trendCount} data-part="count" aria-hidden="true">
                            {column.total}
                          </span>
                        ) : null}
                      </span>
                    </Mark>
                  ))}
                </div>
              </div>
            </div>
            {showRate ? (
              <>
                <Text as="h3" variant="sm" weight={600} className={styles.trendTitle}>
                  <span {...textDirAttrs(primaryLabel)}>{primaryLabel} per day</span>
                </Text>
                <div
                  className={styles.trendPanel}
                  data-live-panel="rate"
                  role="group"
                  aria-label={`${primaryLabel} per day`}
                >
                  <Scale ticks={[0, 50, 100]} max={100} percent />
                  <div className={styles.trendArea}>
                    <svg
                      className={styles.rateLine}
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {lines
                        .filter((run) => run.length > 1)
                        .map((run, index) => (
                          <polyline
                            key={index}
                            points={run.map((point) => `${point.x},${point.y}`).join(' ')}
                          />
                        ))}
                    </svg>
                    <div className={styles.trendColumns}>
                      {columns.map((column, index) => {
                        const point = points[index]!;
                        const labelled =
                          point.rate !== null && (index === columns.length - 1 || index === lowest?.index);
                        const endpoint =
                          point.rate !== null &&
                          (index === 0 ||
                            index === columns.length - 1 ||
                            points[index - 1]?.rate === null ||
                            points[index + 1]?.rate === null);
                        return (
                          <Mark
                            key={column.day}
                            as="span"
                            className={styles.trendDay}
                            pointerOnly
                            aria-hidden="true"
                            tip={tip(column)}
                            aria-label={name(column)}
                            onPick={() => replaceUrlQuery({ day: column.day })}
                            data-live-rate-day={column.day}
                          >
                            {point.rate !== null ? (
                              <span
                                className={styles.ratePosition}
                                style={{ bottom: `${Math.max(0, Math.min(1, point.rate)) * 100}%` }}
                              >
                                {endpoint || labelled ? (
                                  <span
                                    className={styles.rateDot}
                                    data-live-rate-point={column.day}
                                    aria-hidden="true"
                                  />
                                ) : null}
                                {labelled ? (
                                  <span
                                    className={styles.rateValue}
                                    style={{
                                      insetInlineStart: `${Math.max(0, Math.min(width - 52, (point.x / 100) * width - 26)) - (point.x / 100) * width}px`,
                                    }}
                                    data-live-rate-label={column.day}
                                    data-last={index === columns.length - 1 ? '' : undefined}
                                    data-low={index === lowest?.index ? '' : undefined}
                                    aria-hidden="true"
                                  >
                                    {formatPrimaryMean(point.rate, primary)}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </Mark>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
            <div className={styles.trendXAxis} aria-hidden="true">
              {axisLabels
                .filter((label) => label.visible)
                .map((label) => (
                  <span
                    key={label.index}
                    data-part="axis"
                    style={{ insetInlineStart: `${(label.x / width) * 100}%` }}
                  >
                    {label.label}
                  </span>
                ))}
            </div>
          </ChartTooltipHost>
        </div>
      </ChartCard>
    </div>
  );
}
