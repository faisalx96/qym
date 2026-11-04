import type { LiveTurnDetail } from '@/api/live';
import { KeyValueGrid, Text, TextBlock } from '@/ui';
import { comparisonRows, judgeOf, numberOf, recordOf, stringOf } from '../../lib/summary';
import { EvidenceCard, MetricValue, SqlParts } from './Evidence';
import styles from '../../turn.module.css';

export function JudgesTab({ data }: { data: LiveTurnDetail }) {
  return (
    <div className={styles.twoColumns}>
      {(['a', 'b'] as const).map((key) => {
        const judge = judgeOf(data.summary, key);
        const review = recordOf(recordOf(data.summary.cross_review)?.[key === 'a' ? 'a_on_b' : 'b_on_a']);
        const complianceSpec = data.specs.find((spec) => spec.metric_name === `compliance_${key}`);
        const coverage = judge?.vsAgent?.coverage;
        return (
          <EvidenceCard key={key} title={`Judge ${key.toUpperCase()}`} block={`judge-${key}`}>
            {judge ? (
              <div className={styles.stack}>
                {judge.model ? <Text dir="auto">{judge.model}</Text> : null}
                <KeyValueGrid
                  columns={1}
                  aria-label={`Judge ${key.toUpperCase()} compliance`}
                  items={(['sql', 'response', 'overall'] as const).map((axis) => ({
                    key: axis,
                    label:
                      axis === 'sql'
                        ? 'SQL compliance'
                        : axis === 'response'
                          ? 'Response compliance'
                          : 'Overall compliance',
                    value: <MetricValue value={judge.compliance[axis]} spec={complianceSpec} />,
                  }))}
                />
                <TextBlock text={judge.reasoning ?? 'No reasoning available for this judge.'} dir="auto" />
                <SqlParts parts={judge.sqlParts} />
                <KeyValueGrid
                  columns={1}
                  items={[
                    {
                      key: 'comparison',
                      label: 'Own SQL vs agent',
                      value: comparisonRows(data.summary).find((row) => row.key === key)?.value ?? '—',
                    },
                    {
                      key: 'coverage',
                      label: 'Sub-questions covered',
                      value: coverage ? `${coverage.covered ?? '—'} / ${coverage.total ?? '—'}` : '—',
                      mono: true,
                    },
                  ]}
                />
              </div>
            ) : (
              <Text tone="muted">No evidence available for this judge.</Text>
            )}
            <div className={styles.crossReview}>
              <Text variant="md" weight={600}>
                Review of Judge {key === 'a' ? 'B' : 'A'}
              </Text>
              <TextBlock
                text={stringOf(review?.text) ?? 'No cross-review available for this judge.'}
                dir="auto"
              />
              {numberOf(review?.score) !== null ? (
                <div className={styles.metricRow}>
                  <span>Cross-review score</span>
                  <MetricValue value={numberOf(review?.score)} />
                </div>
              ) : null}
            </div>
          </EvidenceCard>
        );
      })}
    </div>
  );
}
