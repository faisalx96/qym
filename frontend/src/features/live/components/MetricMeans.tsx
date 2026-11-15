import type { LiveOverview } from '@/api/live';
import { formatLatency, formatPercentValue } from '@/lib/format';
import { Card, ScoreValue, Text } from '@/ui';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import styles from '../live.module.css';

export function MetricMeans({ overview }: { overview: LiveOverview }) {
  const specs = overview.specs
    .filter((spec) => spec.group === 'quality' || spec.group === 'charts')
    .sort((a, b) => a.position - b.position);
  return (
    <Card
      data-live-block="means"
      header={
        <Text variant="md" weight={600}>
          Metric means
        </Text>
      }
    >
      <ChartTooltipHost className={styles.metricRows}>
        {specs.map((spec) => {
          const metric = overview.day.metric_means.find((row) => row.metric_name === spec.metric_name);
          const mean = metric?.mean ?? null;
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
            <div key={spec.metric_name} className={styles.metricRow} data-live-metric={spec.metric_name}>
              <span dir="auto">{spec.label}</span>
              <Mark tip={`${metric?.n ?? 0} non-skipped scores`}>
                <ScoreValue
                  value={mean}
                  type={numeric ? 'numeric' : spec.score_type}
                  direction={spec.direction}
                  variant="plain"
                  text={text}
                />
              </Mark>
            </div>
          );
        })}
      </ChartTooltipHost>
    </Card>
  );
}
