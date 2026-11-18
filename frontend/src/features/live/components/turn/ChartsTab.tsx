import { textDirAttrs } from '@/lib/text';
import type { LiveMetricSpec, LiveTurnDetail } from '@/api/live';
import { EmptyState, FieldRow, StatusMark, Text, TextBlock } from '@/ui';
import { chartsOf, type ChartEvidence } from '../../lib/summary';
import { ChartImage } from './ChartImage';
import { EvidenceCard, MetricValue } from './Evidence';
import styles from './ChartsTab.module.css';

export function ChartEvidenceBody({ chart, specs }: { chart: ChartEvidence; specs: LiveMetricSpec[] }) {
  const scores = Object.entries(chart.scores).sort(([a], [b]) =>
    a === 'chart_fidelity' ? -1 : b === 'chart_fidelity' ? 1 : 0,
  );
  return (
    <div className={styles.stack}>
      <ChartImage chart={chart} />
      <div className={styles.stack}>
        {scores.map(([name, value]) => {
          const spec = specs.find((item) => item.metric_name === name);
          return (
            <FieldRow
              key={name}
              label={spec?.label ?? name.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())}
              labelAnchor="start"
              labelCase="sentence"
            >
              <div className={styles.inline}>
                <MetricValue value={value} spec={spec} />
                {name === 'chart_fidelity' ? (
                  <Text as="span" variant="sm" tone="muted">
                    data against SQL result
                  </Text>
                ) : null}
              </div>
            </FieldRow>
          );
        })}
        <FieldRow label="Issues" labelAnchor="start" labelCase="sentence">
          {chart.issues.length ? (
            <ul className={styles.issues}>
              {chart.issues.map((issue, index) => (
                <li key={index} {...textDirAttrs(issue)}>
                  <StatusMark className={styles.issueMark} tone="warning" shape="dot" label={issue} />
                </li>
              ))}
            </ul>
          ) : (
            <Text as="span">None reported</Text>
          )}
        </FieldRow>
      </div>
      {chart.reading ? (
        <FieldRow label="Chart reading" labelAnchor="start" labelCase="sentence" text={chart.reading}>
          <TextBlock text={chart.reading} code={false} mode="rendered" />
        </FieldRow>
      ) : null}
    </div>
  );
}

export function ChartsTab({ data }: { data: LiveTurnDetail }) {
  const charts = chartsOf(
    data.summary,
    data.chart_images,
    data.chart_images_expired ? (data.chart_image_retention_days ?? null) : null,
  );
  if (!charts.length)
    return (
      <EvidenceCard title="Charts">
        <EmptyState compact title="No charts for this turn" />
      </EvidenceCard>
    );
  return (
    <div className={styles.stack}>
      {charts.map((chart, index) => (
        <EvidenceCard
          key={`${chart.ref ?? 'chart'}-${index}`}
          title={`Chart ${index + 1}${chart.kind ? ` · ${chart.kind}` : ''}`}
          block={`chart-${index + 1}`}
        >
          <ChartEvidenceBody chart={chart} specs={data.specs} />
        </EvidenceCard>
      ))}
    </div>
  );
}
