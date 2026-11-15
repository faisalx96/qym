import type { LiveMetricSpec, LiveTurnDetail } from '@/api/live';
import { EmptyState, TextBlock } from '@/ui';
import { chartsOf, type ChartEvidence } from '../../lib/summary';
import { ChartImage } from './ChartImage';
import { EvidenceCard, MetricValue } from './Evidence';
import styles from '../../turn.module.css';

export function ChartEvidenceBody({
  chart,
  specs,
  reading = true,
  size = 'card',
}: {
  chart: ChartEvidence;
  specs: LiveMetricSpec[];
  reading?: boolean;
  size?: 'card' | 'thumb';
}) {
  return (
    <>
      <ChartImage chart={chart} size={size} />
      {Object.entries(chart.scores).map(([name, value]) => {
        const spec = specs.find((item) => item.metric_name === name);
        return (
          <div key={name} className={styles.metricRow}>
            <span dir="auto">{spec?.label ?? name}</span>
            <MetricValue value={value} spec={spec} />
          </div>
        );
      })}
      {chart.issues.length ? (
        <ul className={styles.issues}>
          {chart.issues.map((issue, index) => (
            <li key={index} dir="auto">
              {issue}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title="No chart issues reported" />
      )}
      {reading && chart.reading ? <TextBlock text={chart.reading} dir="auto" mode="rendered" /> : null}
    </>
  );
}

export function ChartsTab({ data }: { data: LiveTurnDetail }) {
  const charts = chartsOf(data.summary, data.chart_images);
  if (!charts.length) return <EmptyState compact title="No charts for this turn" />;
  return (
    <div className={styles.twoColumns}>
      {charts.map((chart, index) => (
        <EvidenceCard
          key={`${chart.ref ?? 'chart'}-${index}`}
          title={`Chart ${index + 1}${chart.kind ? ` · ${chart.kind}` : ''}`}
        >
          <ChartEvidenceBody chart={chart} specs={data.specs} />
        </EvidenceCard>
      ))}
    </div>
  );
}
