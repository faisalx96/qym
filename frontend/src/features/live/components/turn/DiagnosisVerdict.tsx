import type { LiveTurnDetail } from '@/api/live';
import { splitBilingual } from '@/lib/text';
import { Card, Eyebrow, KeyValueGrid, Tag, Text } from '@/ui';
import {
  comparisonRows,
  numberOf,
  recordOf,
  rulesAppliedOf,
  rulesVersionOf,
  verdictOf,
} from '../../lib/summary';
import { Bilingual, DiagnosisLabel, EvidenceCard, RulesApplied } from './Evidence';
import styles from './DiagnosisVerdict.module.css';

const basisWords = {
  rule: 'an Insightor rule',
  judges: 'the two judges',
  outcome: 'how the turn ended',
  skipped: 'not evaluated',
};
const kindWords = { rule: 'Rule', fact: 'Fact', judge: 'Judge', replay: 'Replay', service: 'Service' };

export function DiagnosisVerdict({ data }: { data: LiveTurnDetail }) {
  const verdict = verdictOf(data.summary);
  const score = data.scores.find((item) => item.metric_name === 'manifest_eval');
  const oldReason = splitBilingual(data.turn.label_reason ?? '');
  const explanation = score?.explanation;
  const prefix = [data.turn.label, score?.label]
    .filter(Boolean)
    .map((label) => `${label} — `)
    .find((label) => explanation?.startsWith(label));
  const en = verdict?.reasonEn || (prefix ? explanation?.slice(prefix.length) : explanation) || oldReason.en;
  const ar = verdict?.reasonAr || oldReason.ar;
  const confidence = verdict?.confidence ?? numberOf(recordOf(score?.meta)?.confidence);
  const steps = verdict?.steps.filter((step) => step.textEn || step.textAr || step.source) ?? [];
  return (
    <EvidenceCard title="Verdict" block="why">
      <div className={styles.stack}>
        <DiagnosisLabel value={verdict?.label ?? data.turn.label} specs={data.specs} />
        {verdict?.basis || confidence !== null ? (
          <KeyValueGrid
            columns={2}
            dense
            items={[
              ...(verdict?.basis
                ? [{ key: 'basis', label: 'Decided by', value: basisWords[verdict.basis] }]
                : []),
              ...(confidence !== null
                ? [{ key: 'confidence', label: 'Confidence', value: confidence, mono: true }]
                : []),
            ]}
          />
        ) : null}
        {en || ar ? (
          <Bilingual en={en || null} ar={ar || null} />
        ) : (
          <Text tone="muted">No diagnosis explanation available for this turn.</Text>
        )}
        <Text as="h3" variant="md" weight={600}>
          How we got here
        </Text>
        {steps.length ? (
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={index}>
                <div className={styles.stack}>
                  {step.kind ? <Eyebrow>{kindWords[step.kind]}</Eyebrow> : null}
                  <Bilingual en={step.textEn || null} ar={step.textAr || null} />
                  {step.source ? (
                    <Text as="span" mono dir="ltr">
                      {step.source}
                    </Text>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <KeyValueGrid
            columns={1}
            dense
            items={comparisonRows(data.summary).map((row) => ({
              ...row,
              mono: row.key === 'coverage' || row.key === 'tools',
            }))}
          />
        )}
      </div>
    </EvidenceCard>
  );
}

export function DiagnosisRules({ summary }: { summary: Record<string, unknown> }) {
  const rules = rulesAppliedOf(summary).filter(
    (rule) =>
      rule.id || rule.titleEn || rule.titleAr || rule.verdictEn || rule.verdictAr || rule.sources.length,
  );
  if (!rules.length) return null;
  const version = rulesVersionOf(summary);
  const decided = rules.filter((rule) => rule.role !== 'told_to_judges');
  const given = rules.filter((rule) => rule.role === 'told_to_judges');
  return (
    <Card
      data-live-block="rules"
      header={
        <div className={styles.heading}>
          <Text as="h2" variant="md" weight={600}>
            Insightor rules behind this verdict
          </Text>
          {version ? (
            <aside>
              <Tag kind="version">{version}</Tag>
            </aside>
          ) : null}
        </div>
      }
    >
      <div className={styles.stack}>
        <RulesApplied rules={decided} />
        {given.length ? (
          <>
            <Text tone="muted">Also given to the judges</Text>
            <RulesApplied rules={given} />
          </>
        ) : null}
      </div>
    </Card>
  );
}
