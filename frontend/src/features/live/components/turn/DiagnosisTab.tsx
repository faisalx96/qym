import type { LiveTurnDetail } from '@/api/live';
import { formatDurationMs } from '@/lib/format';
import { modelSeriesOf } from '@/features/runs-list/model';
import { Disclosure, EmptyState, Icon, KeyValueGrid, ModelTag, StateTag, Tag, Text, TextBlock } from '@/ui';
import {
  booleanOf,
  chartsOf,
  comparisonRows,
  deviationsOf,
  evalMetaOf,
  judgeOf,
  numberOf,
  recordOf,
  servicesOf,
  sqlPartsOf,
  stringOf,
} from '../../lib/summary';
import { ChartEvidenceBody } from './ChartsTab';
import { EvidenceCard, MetricValue, ServiceStatus, SqlParts } from './Evidence';
import { labelFor } from './presentation';
import styles from '../../turn.module.css';

export function DiagnosisTab({
  data,
  modelIndex,
}: {
  data: LiveTurnDetail;
  modelIndex?: Record<string, number> | null;
}) {
  const { turn, summary, specs } = data;
  const deviations = deviationsOf(summary);
  const judges = { a: judgeOf(summary, 'a'), b: judgeOf(summary, 'b') };
  const groups = [...new Set(deviations.map((item) => item.judge))];
  const notes = recordOf(summary.sql_notes);
  const reused = booleanOf(notes?.reused_by_judges);
  const chart = chartsOf(summary, data.chart_images)[0];
  const services = servicesOf(summary);
  const meta = evalMetaOf(summary);
  const models = recordOf(meta?.models);
  const judgeModels = [judges.a?.model ?? stringOf(models?.a), judges.b?.model ?? stringOf(models?.b)].filter(
    (model): model is string => Boolean(model),
  );
  const codeVersion = stringOf(meta?.eval_code_version);
  const manifest = stringOf(summary.manifest_hash);
  const attempt = numberOf(meta?.attempt);
  const duration = numberOf(recordOf(meta?.durations)?.evaluation_ms);
  const errorDetection = data.scores.find((score) => score.metric_name === 'error_detection');
  return (
    <>
      <div className={styles.twoColumns}>
        <EvidenceCard title={`Why ${labelFor(turn.label, specs).label}`} block="why">
          <p className={styles.copy} dir="auto">
            {turn.label_reason ?? 'No diagnosis explanation available for this turn.'}
          </p>
          <KeyValueGrid
            columns={1}
            dense
            items={comparisonRows(summary).map((row) => ({
              ...row,
              value: (
                <span
                  dir="auto"
                  className={row.key === 'coverage' || row.key === 'tools' ? styles.number : undefined}
                >
                  {row.value}
                </span>
              ),
            }))}
          />
        </EvidenceCard>
        <EvidenceCard
          title={deviations.length ? 'Deviations the judges found' : 'What each judge said'}
          block="deviations"
        >
          {deviations.length
            ? groups.map((judge) => (
                <div key={judge} className={styles.deviationGroup}>
                  <Text variant="md" weight={600} dir="auto">
                    Judge {judge.toUpperCase()}
                  </Text>
                  {deviations
                    .filter((item) => item.judge === judge)
                    .map((item, index) => (
                      <div key={index} className={styles.deviation}>
                        <span className={styles.axis}>
                          {item.axis === 'sql' || item.axis === 'response' ? (
                            <Icon
                              name="warning"
                              size={12}
                              className={item.axis === 'sql' ? styles.sevError : styles.sevWarning}
                              aria-hidden="true"
                            />
                          ) : null}
                          <Tag dir="auto">{item.axis}</Tag>
                        </span>
                        <p className={styles.copy} dir="auto">
                          {item.text}
                        </p>
                      </div>
                    ))}
                </div>
              ))
            : (['a', 'b'] as const).map((key) => (
                <div key={key} className={styles.deviationGroup}>
                  <Text variant="md" weight={600}>
                    Judge {key.toUpperCase()}
                  </Text>
                  <TextBlock
                    text={judges[key]?.reasoning ?? 'No reasoning available for this judge.'}
                    dir="auto"
                  />
                </div>
              ))}
        </EvidenceCard>
      </div>
      <div className={styles.twoColumns}>
        <EvidenceCard title="Agent SQL" block="agent-sql">
          <SqlParts parts={sqlPartsOf(turn.sql)} />
          {notes ? (
            <div className={styles.notes}>
              {reused !== null ? <span>{reused ? 'Reused by judges' : 'Not reused by judges'}</span> : null}
              {(['dialect_ok', 'validator_ok'] as const).map((key) => {
                const ok = booleanOf(notes[key]);
                return ok === null ? null : (
                  <StateTag key={key} tone={ok ? 'success' : 'danger'}>
                    {`${key === 'dialect_ok' ? 'Dialect' : 'Validator'} ${ok ? 'OK' : 'failed'}`}
                  </StateTag>
                );
              })}
            </div>
          ) : null}
        </EvidenceCard>
        <EvidenceCard title="Judge A SQL" block="judge-sql">
          <SqlParts parts={judges.a?.sqlParts ?? []} />
          <div data-live-block="judge-b">
            <Disclosure title="Judge B SQL" summary={`${judges.b?.sqlParts.length ?? 0} statements`}>
              <SqlParts parts={judges.b?.sqlParts ?? []} />
            </Disclosure>
          </div>
        </EvidenceCard>
      </div>
      <div className={styles.threeColumns}>
        <EvidenceCard title="Final answer" block="answer">
          <div data-live-answer dir="auto">
            <TextBlock
              text={turn.answer ?? 'No answer available for this turn.'}
              mode="rendered"
              dir="auto"
              className={styles.answer}
            />
          </div>
          <div className={styles.metricRow}>
            <span>Error detection</span>
            <MetricValue
              value={errorDetection?.skipped ? null : (errorDetection?.score_numeric ?? null)}
              spec={errorDetection?.spec}
            />
          </div>
        </EvidenceCard>
        <EvidenceCard title="Chart" block="chart">
          {chart ? (
            <ChartEvidenceBody chart={chart} specs={specs} reading={false} size="thumb" />
          ) : (
            <EmptyState compact title="No charts for this turn" />
          )}
        </EvidenceCard>
        <EvidenceCard title="Services on this turn" block="turn-services">
          {services.length ? (
            services.map((service) => (
              <div key={service.name} className={styles.metricRow} data-live-turn-service={service.name}>
                <span dir="auto">
                  {specs.find((spec) => spec.metric_name === `service.${service.name}`)?.label ??
                    service.name}
                </span>
                <span className={styles.inline}>
                  <ServiceStatus status={service.status} />
                  {service.fault ? <Tag dir="auto">{service.fault}</Tag> : null}
                </span>
              </div>
            ))
          ) : (
            <EmptyState compact title="No services for this turn" />
          )}
          <div className={styles.evaluator} data-live-block="evaluator-line">
            {judgeModels.length ? (
              judgeModels.map((m) => (
                <ModelTag key={m} name={m} series={modelSeriesOf(modelIndex ?? null, m, false)} />
              ))
            ) : (
              <span>Judge models unavailable</span>
            )}
            {codeVersion ? (
              <Tag kind="version" dir="auto">
                {codeVersion}
              </Tag>
            ) : null}
            {manifest ? (
              <Tag kind="version" dir="auto">
                {manifest}
              </Tag>
            ) : null}
            <span className={styles.number}>
              Attempt {attempt ?? '—'} · {duration === 0 ? '0ms' : formatDurationMs(duration)}
            </span>
          </div>
        </EvidenceCard>
      </div>
    </>
  );
}
