import { useId, useRef, useState } from 'react';
import type { LiveTurnDetail } from '@/api/live';
import { isInternalMetaKey } from '@/lib/metrics';
import { splitBilingual } from '@/lib/text';
import { Button, DataTable, EmptyState, Subsection, Text, TextBlock, type Column } from '@/ui';
import { FieldList } from '@/features/run-detail/components/items/pane/values';
import { Bilingual, MetricValue } from './Evidence';
import styles from './EvaluatorTab.module.css';

type Score = LiveTurnDetail['scores'][number];
const hidden = new Set<string>();

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
      cell: (row) => (
        <span className={styles.wrap} dir="auto">
          {row.spec?.label ?? row.metric_name}
        </span>
      ),
    },
    {
      id: 'value',
      header: 'Value',
      cell: (row) =>
        !row.skipped && row.score_numeric === null && (row.label || typeof row.score_raw === 'string') ? (
          <Text dir="auto">{row.label ?? String(row.score_raw)}</Text>
        ) : (
          <MetricValue value={row.skipped ? null : row.score_numeric} spec={row.spec} />
        ),
    },
    {
      id: 'result',
      header: 'Result',
      cell: (row) => (
        <span className={styles.wrap} dir="auto">
          {result(row, data.summary.evaluation_failed === true || data.turn.status === 'failed')}
        </span>
      ),
    },
    {
      id: 'explanation',
      header: 'Explanation',
      flex: true,
      minWidth: 200,
      cell: (row) => (
        <span className={styles.preview} dir="auto">
          {row.explanation?.split('\n')[0] ?? '—'}
        </span>
      ),
    },
  ];
  const close = () => {
    root.current?.querySelector<HTMLElement>(`[data-score-id="${selected}"]`)?.focus();
    setSelected(null);
  };
  const text = splitBilingual(score?.explanation ?? '');
  return (
    <Subsection title="Scores">
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
          aria-label="Evaluation scores"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          density="compact"
          densityLocked
          responsive="scroll"
          groupBy={{ key: (row) => row.spec?.group ?? 'Other', label: (group) => group }}
          onRowOpen={(row) => setSelected(row.id)}
          rowProps={(row) => ({
            'data-score-id': String(row.id),
            'aria-selected': row.id === selected ? 'true' : 'false',
            'aria-controls': row.id === selected ? panelId : undefined,
          })}
          rowClassName={(row) => (row.id === selected ? styles.selected : undefined)}
          empty="No evaluation scores for this turn"
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
            {score.explanation ? (
              text.en && text.ar ? (
                <Bilingual en={text.en} ar={text.ar} />
              ) : (
                <TextBlock text={score.explanation} code={false} />
              )
            ) : null}
            {Object.keys(details).length ? (
              <FieldList data={details} label="Judge metadata" detail />
            ) : (
              <EmptyState compact title="No details were recorded for this metric" />
            )}
          </section>
        ) : null}
      </div>
    </Subsection>
  );
}
