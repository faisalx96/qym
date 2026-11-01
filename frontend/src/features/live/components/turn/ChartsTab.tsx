import type { LiveMetricSpec, LiveTurnDetail } from '@/api/live';
import { Text, TextBlock } from '@/ui';
import { chartsOf, type ChartEvidence } from '../../lib/summary';
import { EvidenceCard, MetricValue } from './Evidence';
import styles from '../../turn.module.css';

export function ChartEvidenceBody({
  chart,
  specs,
  reading = true,
}: {
  chart: ChartEvidence;
  specs: LiveMetricSpec[];
  reading?: boolean;
}) {
  return (
    <>
      <div className={styles.chartPlaceholder}>Chart screenshots arrive in a later release</div>
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
        <Text tone="muted">No chart issues reported.</Text>
      )}
      {reading && chart.reading ? <TextBlock text={chart.reading} dir="auto" mode="rendered" /> : null}
    </>
  );
}

export function ChartsTab({ data }: { data: LiveTurnDetail }) {
  const charts = chartsOf(data.summary);
  if (!charts.length) return <Text tone="muted">No charts available for this turn.</Text>;
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
