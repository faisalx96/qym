import { modelSeriesOf } from '@/features/runs-list/model';
import type { ReactNode } from 'react';
import type { LiveTurnDetail } from '@/api/live';
import {
  CopyButton,
  Disclosure,
  InlineNotice,
  JsonTree,
  KeyValueGrid,
  EmptyState,
  StateTag,
  Subsection,
  ModelTag,
  Tag,
  Text,
} from '@/ui';
import { evalMetaOf, recordOf, stringOf, numberOf } from '../../lib/summary';
import { evaluationProblems } from '../../lib/evaluatorRecord';
import { Facts } from './Evidence';
import { EvaluationScores } from './EvaluationScores';
import { EvaluationTimings } from './EvaluationTimings';
import { liveTime, statusWord } from './presentation';
import styles from './EvaluatorTab.module.css';

export function EvaluatorTab({
  data,
  modelIndex = null,
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
  const suite = read('eval_suite');
  const code = read('eval_code_version');
  const rules = read('rules_version') ?? stringOf(data.summary.rules_version);
  const mode = read('mode');
  const backfill = read('backfill_job_id') ?? stringOf(recordOf(data.summary.provenance)?.backfill_job_id);
  const reevaluated = read('reevaluated_from');
  const manifest = stringOf(data.summary.manifest_hash);
  const facts: { label: string; value: ReactNode; mono?: boolean }[] = [];
  const fact = (label: string, value: ReactNode, mono = false) => {
    if (value !== null && value !== undefined && value !== '') facts.push({ label, value, mono });
  };
  fact(
    'Status',
    <StateTag
      tone={
        data.turn.status === 'failed' ? 'danger' : data.turn.status === 'completed' ? 'success' : 'neutral'
      }
    >
      {statusWord(data.turn.status)}
    </StateTag>,
  );
  fact('Outcome', data.turn.outcome);
  fact('Suite', suite);
  fact('Code version', code ? <Tag kind="version">{code}</Tag> : null);
  fact('Rules version', rules ? <Tag kind="version">{rules}</Tag> : null);
  fact(
    'Manifest',
    manifest ? (
      <span className={styles.inline}>
        <span>{manifest}</span>
        <CopyButton text={manifest} label="Copy manifest hash" />
      </span>
    ) : null,
    true,
  );
  fact('Mode', mode ?? data.turn.mode);
  for (const [label, value] of [
    ['Turn asked at', data.turn.turn_at],
    ['Evaluated at', data.turn.evaluated_at],
    ['Received at', data.turn.received_at],
    ['Replaced at', stringOf(data.summary.replaced_at)],
  ] as const) {
    fact(label, value ? liveTime(value) : null);
  }
  fact('Backfill job', backfill, true);
  fact('Re-evaluated from', reevaluated, true);
  const models = recordOf(raw.models);
  const modelRows = [
    ['Judge A', read('judge_a_model') ?? stringOf(models?.a)],
    ['Judge B', read('judge_b_model') ?? stringOf(models?.b)],
    ['Vision judge', read('vision_judge_model') ?? stringOf(models?.vision)],
    ['Chart design judge', read('design_judge_model') ?? stringOf(models?.design)],
    [
      'Intent classifier',
      stringOf(recordOf(recordOf(recordOf(data.summary.services)?.router)?.signals)?.classifier_used),
    ],
  ];
  const designRules = read('design_rules_version');
  const attempt = numberOf(raw.attempt);
  const maxAttempts = meta?.maxAttempts;
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
  // Keep unrecognized nested keys too: normalized models and timings must not erase producer extensions.
  const other = Object.fromEntries(Object.entries(raw).filter(([key]) => !consumed.has(key)));
  for (const [key, known] of Object.entries({
    models: ['a', 'b', 'vision', 'design'],
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
      <Subsection title="What ran">
        <KeyValueGrid
          columns={3}
          dense
          items={facts.map(({ label, value, mono }) => ({ key: label, label, value, mono }))}
        />
      </Subsection>
      {modelRows.some(([, value]) => value) || designRules ? (
        <Subsection title="Models">
          <div className={styles.models}>
            {modelRows.map(([label, value]) =>
              value ? (
                <div key={label} className={styles.inline}>
                  <Text weight={600}>{label}</Text>
                  <ModelTag name={value} series={modelSeriesOf(modelIndex, value, false)} />
                  {label === 'Chart design judge' && designRules ? (
                    <>
                      <Text tone="muted">Rules</Text>
                      <Tag kind="version">{designRules}</Tag>
                    </>
                  ) : null}
                </div>
              ) : null,
            )}
            {designRules && !modelRows[3]?.[1] ? (
              <div className={styles.inline}>
                <Text>Chart design rules</Text>
                <Tag kind="version">{designRules}</Tag>
              </div>
            ) : null}
          </div>
        </Subsection>
      ) : null}
      <EvaluationTimings data={data} />
      {attempt !== null ? (
        <Subsection title="Attempts">
          <Text>
            Attempt <span className={styles.mono}>{attempt}</span>
            {maxAttempts !== null && maxAttempts !== undefined ? (
              <>
                {' '}
                of <span className={styles.mono}>{maxAttempts}</span>
              </>
            ) : null}
          </Text>
        </Subsection>
      ) : null}
      {problems.length ? (
        <Subsection title="Problems during evaluation">
          <div className={styles.stack}>
            {problems.map((problem) => (
              <InlineNotice key={problem.text} tone={problem.tone}>
                {problem.text}
              </InlineNotice>
            ))}
          </div>
        </Subsection>
      ) : (
        <Text tone="muted">No problems during evaluation</Text>
      )}
      <EvaluationScores data={data} />
      {Object.keys(other).length ? (
        <Subsection title="Other evaluator keys">
          <Facts value={other} label="Other evaluator keys" />
        </Subsection>
      ) : null}
      <Disclosure title="Raw evaluation detail" summary={data.detail ? 'JSON' : 'Not available'}>
        {data.detail ? (
          <JsonTree data={data.detail} label="Raw evaluation detail" />
        ) : (
          <EmptyState compact title="No raw detail for this turn" />
        )}
      </Disclosure>
    </div>
  );
}
