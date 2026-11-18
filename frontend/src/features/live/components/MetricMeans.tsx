import type { LiveOverview } from '@/api/live';
import { formatLatency, formatPercentValue } from '@/lib/format';
import { metricBand } from '@/lib/metrics';
import { textDirAttrs } from '@/lib/text';
import { Card, DataTable, ScoreValue, SectionHeader, type Column } from '@/ui';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import styles from '../live.module.css';

export function MetricMeans({ overview, period = 'today' }: { overview: LiveOverview; period?: string }) {
  const specs = overview.specs
    .filter((spec) => spec.group === 'quality' || spec.group === 'charts')
    .sort((a, b) => a.position - b.position);
  const rows = specs.map((spec) => ({
    ...spec,
    metric: overview.day.metric_means.find((row) => row.metric_name === spec.metric_name),
  }));
  const columns: Column<(typeof rows)[number]>[] = [
    {
      id: 'label',
      header: 'Score',
      flex: true,
      minWidth: 100,
      cell: (spec) => (
        <span className={styles.metricLabel} {...textDirAttrs(spec.label)}>
          {spec.label}
        </span>
      ),
    },
    {
      id: 'meter',
      header: 'Score from 0 to 100%',
      hideLabel: true,
      flex: true,
      minWidth: 80,
      cell: (spec) => {
        const mean = spec.metric?.mean;
        if (mean == null || (spec.score_type !== 'percentage' && spec.score_type !== 'boolean')) return null;
        return (
          <span
            className={styles.metricMeter}
            aria-hidden="true"
            data-band={metricBand(mean, spec.score_type, spec.direction) ?? undefined}
          >
            <span style={{ inlineSize: `${Math.min(1, Math.max(0, mean)) * 100}%` }} />
          </span>
        );
      },
    },
    {
      id: 'mean',
      header: 'Average',
      align: 'end',
      width: 90,
      cell: (spec) => {
        const mean = spec.metric?.mean ?? null;
        const numeric = spec.score_type === 'numeric' || spec.score_type === 'duration';
        const text =
          mean === null
            ? '—'
            : spec.score_type === 'duration'
              ? mean === 0
                ? '0ms'
                : formatLatency(mean)
              : numeric
                ? mean.toFixed(2)
                : formatPercentValue(mean, 1);
        return (
          <Mark tip={`${spec.metric?.n ?? 0} non-skipped scores`}>
            <ScoreValue
              value={mean}
              type={numeric ? 'numeric' : spec.score_type}
              direction={spec.direction}
              variant="plain"
              text={text}
            />
          </Mark>
        );
      },
    },
  ];
  return (
    <Card
      data-live-block="means"
      flush
      header={<SectionHeader title={`Average scores ${period}`} level="lg" as="h2" />}
    >
      <ChartTooltipHost>
        <DataTable
          aria-label={`Average scores ${period}`}
          variant="embedded"
          edgePadding="card"
          columns={columns}
          rows={rows}
          rowKey={(spec) => spec.metric_name}
          rowProps={(spec) => ({ 'data-live-metric': spec.metric_name })}
          responsive="scroll"
        />
      </ChartTooltipHost>
    </Card>
  );
}
