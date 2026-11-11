import type { LiveTurnDetail } from '@/api/live';
import { DataTable, Disclosure, JsonTree, Text, type Column } from '@/ui';
import { evalMetaOf } from '../../lib/summary';
import { EvidenceCard, Facts, MetricValue } from './Evidence';
import styles from '../../turn.module.css';

type Score = LiveTurnDetail['scores'][number];
const scoreColumns: Column<Score>[] = [
  {
    id: 'metric',
    header: 'Metric',
    cell: (score) => <span dir="auto">{score.spec?.label ?? score.metric_name}</span>,
  },
  {
    id: 'value',
    header: 'Value',
    mono: true,
    cell: (score) => <MetricValue value={score.skipped ? null : score.score_numeric} spec={score.spec} />,
  },
  { id: 'label', header: 'Label', cell: (score) => <span dir="auto">{score.label ?? '—'}</span> },
  {
    id: 'explanation',
    header: 'Explanation',
    cell: (score) => (
      <span dir="auto" className={styles.tableText}>
        {score.explanation ?? '—'}
      </span>
    ),
  },
  {
    id: 'skip_reason',
    header: 'Skipped reason',
    cell: (score) => (
      <span dir="auto" className={styles.tableText}>
        {score.skip_reason ?? (score.skipped ? 'Skipped' : '—')}
      </span>
    ),
  },
];

export function EvaluatorTab({ data }: { data: LiveTurnDetail }) {
  return (
    <>
      <EvidenceCard title="Evaluator metadata">
        <Facts value={evalMetaOf(data.summary)} label="Evaluator metadata" />
      </EvidenceCard>
      <DataTable
        aria-label="Evaluation scores"
        rows={data.scores}
        columns={scoreColumns}
        rowKey={(score) => score.id}
        responsive="scroll"
        minWidth={900}
        empty={<Text tone="muted">No evaluation scores available for this turn.</Text>}
      />
      <Disclosure title="Raw evaluation detail" summary={data.detail ? 'JSON' : 'Not available'}>
        {data.detail ? (
          <JsonTree data={data.detail} label="Raw evaluation detail" />
        ) : (
          <Text tone="muted">No raw detail available for this turn.</Text>
        )}
      </Disclosure>
    </>
  );
}
