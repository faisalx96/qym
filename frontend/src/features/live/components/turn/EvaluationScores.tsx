import { useId, useRef, useState } from 'react';
import type { LiveTurnDetail } from '@/api/live';
import { isInternalMetaKey } from '@/lib/metrics';
import { splitBilingual } from '@/lib/text';
import { Button, Card, DataTable, EmptyState, Text, TextBlock, type Column } from '@/ui';
import { FieldList } from '@/features/run-detail/components/items/pane/values';
import { Bilingual, MetricValue, TurnCardTitle } from './Evidence';
import { stringOf } from '../../lib/summary';
import { sentenceLabel } from './presentation';
import styles from './EvaluatorTab.module.css';
import turnStyles from '../../turn.module.css';

type Score = LiveTurnDetail['scores'][number];
const hidden = new Set<string>();

function categoricalLabel(score: Score): string {
  const value = score.label ?? String(score.score_raw);
  const label = score.spec?.values?.find(
    (item) => item.value === score.score_raw || item.value === value,
  )?.label;
  return typeof label === 'string' ? label : value;
}

function result(score: Score, failed: boolean) {
  if (score.skipped) return `Skipped${score.skip_reason ? `: ${score.skip_reason}` : ''}`;
  if (
    score.meta.evaluation_failed === true ||
    score.meta.error ||
    score.meta.error_type ||
    (failed && score.score_numeric === null && score.score_raw == null)
  )
    return 'Evaluation failed';
  return 'Scored';
}

export function EvaluationScores({ data }: { data: LiveTurnDetail }) {
  const [selected, setSelected] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const rows = data.scores.map((score) => ({
    ...score,
    spec: score.spec ?? data.specs.find((spec) => spec.metric_name === score.metric_name) ?? null,
  }));
  const score = rows.find((row) => row.id === selected);
  const details = Object.fromEntries(
    Object.entries(score?.meta ?? {}).filter(
      ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
    ),
  );
  const groups = [...new Set(rows.flatMap((row) => (row.spec ? [row.spec.group] : [])))];
  rows.sort(
    (a, b) =>
      (a.spec ? groups.indexOf(a.spec.group) : groups.length) -
        (b.spec ? groups.indexOf(b.spec.group) : groups.length) ||
      (a.spec?.position ?? Infinity) - (b.spec?.position ?? Infinity),
  );
  const columns: Column<Score>[] = [
    {
      id: 'metric',
      header: 'Metric',
      width: 200,
      cell: (row) => (
        <TextBlock text={row.spec?.label ?? row.metric_name} code={false} className={styles.wrap} />
      ),
    },
    {
      id: 'value',
      header: 'Score',
      align: 'end',
      width: 150,
      cell: (row) => (
        <div className={styles.score}>
          {!row.skipped && row.score_numeric === null && (row.label || typeof row.score_raw === 'string') ? (
            <TextBlock text={categoricalLabel(row)} code={false} />
          ) : (
            <MetricValue value={row.skipped ? null : row.score_numeric} spec={row.spec} />
          )}
          {result(row, data.summary.evaluation_failed === true || data.turn.status === 'failed') !==
          'Scored' ? (
            <Text variant="sm">
              {result(row, data.summary.evaluation_failed === true || data.turn.status === 'failed')}
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      id: 'source',
      header: 'Judge / source',
      width: 140,
      cell: (row) => {
        const judge = /^compliance_([ab])$/.exec(row.metric_name)?.[1];
        const source = judge
          ? `Judge ${judge.toUpperCase()}`
          : (stringOf(row.meta.judge) ?? stringOf(row.meta.source) ?? stringOf(row.meta.model));
        return source ? <TextBlock text={source} code={false} className={styles.wrap} /> : null;
      },
    },
    {
      id: 'explanation',
      header: 'Explanation',
      flex: true,
      minWidth: 200,
      cell: (row) => {
        const text = splitBilingual(row.explanation ?? '');
        return row.explanation ? <Bilingual en={text.en} ar={text.ar} /> : null;
      },
    },
  ];
  const close = () => {
    root.current?.querySelector<HTMLElement>(`[data-score-id="${selected}"]`)?.focus();
    setSelected(null);
  };
  const text = splitBilingual(score?.explanation ?? '');
  return (
    <Card flush data-live-card="evaluator-scores" header={<TurnCardTitle title="Scores" />}>
      <div
        ref={root}
        className={styles.stack}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' && selected !== null) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <DataTable
          className={turnStyles.proseTable}
          aria-label="Evaluation scores"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          fit="declared"
          variant="embedded"
          stickyHeader={false}
          density="comfortable"
          densityLocked
          responsive="scroll"
          groupBy={{ key: (row) => row.spec?.group ?? 'Other', label: sentenceLabel }}
          onRowOpen={(row) => setSelected(row.id)}
          rowProps={(row) => ({
            'data-score-id': String(row.id),
            'aria-selected': row.id === selected ? 'true' : 'false',
            'aria-controls': row.id === selected ? panelId : undefined,
          })}
          rowClassName={(row) => (row.id === selected ? styles.selected : undefined)}
          empty={<EmptyState compact title="No evaluation scores for this turn" />}
        />
        {score ? (
          <section
            id={panelId}
            className={styles.detail}
            aria-label={`Details for ${score.spec?.label ?? score.metric_name}`}
          >
            <div className={styles.inline}>
              <Text weight={600}>{score.spec?.label ?? score.metric_name}</Text>
              <MetricValue value={score.skipped ? null : score.score_numeric} spec={score.spec} />
              <Button variant="neutral" onPress={close}>
                Close
              </Button>
            </div>
            {score.explanation ? <Bilingual en={text.en} ar={text.ar} /> : null}
            {Object.keys(details).length ? (
              <FieldList data={details} label="Judge metadata" detail />
            ) : (
              <EmptyState compact title="No details were recorded for this metric" />
            )}
          </section>
        ) : null}
      </div>
    </Card>
  );
}
