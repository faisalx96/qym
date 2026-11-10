import type { LiveTurnDetail } from '@/api/live';
import { formatDurationMs } from '@/lib/format';
import { Tag, Text, TextBlock } from '@/ui';
import { chartsOf, evalMetaOf, judgeOf, numberOf, recordOf, servicesOf, stringOf } from '../../lib/summary';
import { ChartEvidenceBody } from './ChartsTab';
import { Bilingual, EvidenceCard, MetricValue, ServiceStatus } from './Evidence';
import { DiagnosisRules, DiagnosisVerdict } from './DiagnosisVerdict';
import { deviationEvidence } from './deviationEvidence';
import { JudgeDeviations } from './JudgeDeviations';
import { SqlCompare } from './SqlCompare';
import { TurnFacts } from './TurnFacts';
import styles from '../../turn.module.css';

export function DiagnosisTab({ data }: { data: LiveTurnDetail }) {
  const { turn, summary, specs } = data;
  const judges = { a: judgeOf(summary, 'a'), b: judgeOf(summary, 'b') };
  const deviations = { a: deviationEvidence(summary, 'a'), b: deviationEvidence(summary, 'b') };
  const hasDeviations = deviations.a.length > 0 || deviations.b.length > 0;
  const chart = chartsOf(summary, data.chart_images)[0];
  const services = servicesOf(summary);
  const meta = evalMetaOf(summary);
  const models = recordOf(meta?.models);
  const judgeModels = [judges.a?.model ?? stringOf(models?.a), judges.b?.model ?? stringOf(models?.b)].filter(
    Boolean,
  );
  const codeVersion = stringOf(meta?.eval_code_version);
  const manifest = stringOf(summary.manifest_hash);
  const attempt = numberOf(meta?.attempt);
  const duration = numberOf(recordOf(meta?.durations)?.evaluation_ms);
  const errorDetection = data.scores.find((score) => score.metric_name === 'error_detection');
  return (
    <>
      <DiagnosisVerdict data={data} />
      <DiagnosisRules summary={summary} />
      <TurnFacts summary={summary} />
      <EvidenceCard
        title={hasDeviations ? 'Deviations the judges found' : 'What each judge said'}
        block="deviations"
      >
        {(['a', 'b'] as const).map((key) => {
          const judge = judges[key];
          return (
            <div key={key} className={styles.deviationGroup}>
              <Text as="h3" variant="md" weight={600}>
                Judge {key.toUpperCase()}
              </Text>
              {deviations[key].length ? (
                <JudgeDeviations summary={summary} side={key} />
              ) : judge?.reasoningEn || judge?.reasoningAr ? (
                <Bilingual en={judge.reasoningEn || null} ar={judge.reasoningAr || null} />
              ) : (
                <Text tone="muted">No reasoning available for this judge.</Text>
              )}
            </div>
          );
        })}
      </EvidenceCard>
      <EvidenceCard title="SQL comparison" block="sql-comparison">
        <SqlCompare data={data} compact />
      </EvidenceCard>
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
            <Text tone="muted">No charts available for this turn.</Text>
          )}
        </EvidenceCard>
        <EvidenceCard title="Services on this turn" block="turn-services">
          {services.length ? (
            services.map((service) => (
              <div key={service.name} data-live-turn-service={service.name}>
                <div className={styles.metricRow}>
                  <span dir="auto">
                    {specs.find((spec) => spec.metric_name === `service.${service.name}`)?.label ??
                      service.name}
                  </span>
                  <span className={styles.inline}>
                    <ServiceStatus status={service.status} />
                    {service.fault ? <Tag dir="auto">{service.fault}</Tag> : null}
                  </span>
                </div>
                {(service.status === 'failed' || service.status === 'degraded') && service.reason ? (
                  <TextBlock text={service.reason} dir="auto" code={false} />
                ) : null}
              </div>
            ))
          ) : (
            <Text tone="muted">No services available for this turn.</Text>
          )}
          <div className={styles.evaluator} data-live-block="evaluator-line">
            <span dir="auto">
              {judgeModels.length ? judgeModels.join(' · ') : 'Judge models unavailable'}
            </span>
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
