import type { ReactNode } from 'react';
import type { LiveTurnDetail } from '@/api/live';
import {
  Card,
  CopyButton,
  Disclosure,
  InlineNotice,
  JsonTree,
  KeyValueGrid,
  EmptyState,
  StateTag,
} from '@/ui';
import { evalMetaOf, judgeOf, recordOf, stringOf, numberOf } from '../../lib/summary';
import { evaluationProblems } from '../../lib/evaluatorRecord';
import { EvidenceCard, Facts } from './Evidence';
import { EvaluationScores } from './EvaluationScores';
import { EvaluationTimings } from './EvaluationTimings';
import { liveTime, statusWord } from './presentation';
import styles from './EvaluatorTab.module.css';

export function EvaluatorTab({
  data,
}: {
  data: LiveTurnDetail;
  zone?: string;
  modelIndex?: Record<string, number> | null;
}) {
  const meta = evalMetaOf(data.summary);
  const raw = recordOf(data.summary.eval_meta) ?? {};
  const consumed = new Set<string>();
  const read = (key: string) => {
    consumed.add(key);
    return stringOf(raw[key]);
  };
  const models = recordOf(raw.models);
  const facts: { key: string; label: string; value: ReactNode; mono: boolean }[] = [];
  const fact = (label: string, value: ReactNode, mono = true) => {
    if (value !== null && value !== undefined && value !== '') facts.push({ key: label, label, value, mono });
  };
  fact('Judge A model', read('judge_a_model') ?? stringOf(models?.a) ?? judgeOf(data.summary, 'a')?.model);
  fact('Judge B model', read('judge_b_model') ?? stringOf(models?.b) ?? judgeOf(data.summary, 'b')?.model);
  fact('Vision model', read('vision_judge_model') ?? stringOf(models?.vision));
  fact('Extractor model', read('vision_extractor_model') ?? stringOf(models?.extractor));
  fact('Design model', read('design_judge_model') ?? stringOf(models?.design));
  fact(
    'Intent classifier',
    stringOf(recordOf(recordOf(recordOf(data.summary.services)?.router)?.signals)?.classifier_used),
  );
  fact('Rules version', read('rules_version') ?? stringOf(data.summary.rules_version));
  fact('Chart design rules', read('design_rules_version'));
  const attempt = numberOf(raw.attempt);
  if (attempt !== null)
    fact('Attempt', `${attempt}${meta?.maxAttempts != null ? ` of ${meta.maxAttempts}` : ''}`);
  fact('Worker version', read('worker_version'));
  fact('Suite', read('eval_suite'));
  fact('Code version', read('eval_code_version'));
  const manifest = stringOf(data.summary.manifest_hash);
  fact(
    'Manifest',
    manifest ? (
      <span className={styles.inline}>
        <span>{manifest}</span>
        <CopyButton text={manifest} label="Copy manifest hash" />
      </span>
    ) : null,
  );
  fact('Mode', read('mode') ?? data.turn.mode);
  fact(
    'Status',
    <StateTag
      tone={
        data.turn.status === 'failed' ? 'danger' : data.turn.status === 'completed' ? 'success' : 'neutral'
      }
    >
      {statusWord(data.turn.status)}
    </StateTag>,
    false,
  );
  fact('Outcome', data.turn.outcome);
  for (const [label, value] of [
    ['Turn asked at', data.turn.turn_at],
    ['Evaluated at', data.turn.evaluated_at],
    ['Received at', data.turn.received_at],
    ['Replaced at', stringOf(data.summary.replaced_at)],
  ] as const)
    fact(label, value ? liveTime(value) : null);
  fact(
    'Backfill job',
    read('backfill_job_id') ?? stringOf(recordOf(data.summary.provenance)?.backfill_job_id),
  );
  fact('Re-evaluated from', read('reevaluated_from'));
  const problems = evaluationProblems(data);
  for (const key of [
    'attempt',
    'max_attempts',
    'error_type',
    'enrichment_failed',
    'enrichment_errors',
    'viz_rows_dropped',
  ])
    consumed.add(key);
  // Preserve producer extensions after displaying known models and timings.
  const other = Object.fromEntries(Object.entries(raw).filter(([key]) => !consumed.has(key)));
  for (const [key, known] of Object.entries({
    models: ['a', 'b', 'vision', 'extractor', 'design'],
    durations: ['evaluation_ms'],
    durations_s: ['enrichment', 'metrics', 'manifest', 'judges', 'replay', 'other', 'total'],
    stage_durations_s: ['enrichment', 'metrics', 'manifest', 'judges', 'replay', 'other', 'total'],
  })) {
    const extra = Object.fromEntries(
      Object.entries(recordOf(raw[key]) ?? {}).filter(([name]) => !known.includes(name)),
    );
    if (Object.keys(extra).length) other[key] = extra;
    else delete other[key];
  }
  return (
    <div className={styles.stack}>
      <EvidenceCard title="How this turn was evaluated" block="evaluator-method">
        <div className={styles.metadata}>
          <KeyValueGrid columns={3} items={facts} />
          <EvaluationTimings data={data} />
        </div>
      </EvidenceCard>
      <EvaluationScores data={data} />
      <EvidenceCard title="Problems during evaluation" block="evaluator-problems">
        {problems.length ? (
          <div className={styles.stack}>
            {problems.map((problem) => (
              <InlineNotice key={problem.text} tone={problem.tone}>
                {problem.text}
              </InlineNotice>
            ))}
          </div>
        ) : (
          <EmptyState compact title="No problems during evaluation" />
        )}
      </EvidenceCard>
      {Object.keys(other).length ? (
        <EvidenceCard title="Other evaluator keys" block="evaluator-other">
          <Facts value={other} label="Other evaluator keys" />
        </EvidenceCard>
      ) : null}
      <Card data-live-card="evaluator-raw">
        <Disclosure
          title="Raw evaluation detail"
          className={styles.raw}
          summary={data.detail ? 'JSON' : 'Not available'}
        >
          {data.detail ? (
            <JsonTree data={data.detail} label="Raw evaluation detail" />
          ) : (
            <EmptyState compact title="No raw detail for this turn" />
          )}
        </Disclosure>
      </Card>
    </div>
  );
}
