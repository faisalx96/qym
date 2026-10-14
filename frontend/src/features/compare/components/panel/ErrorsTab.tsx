/** Error distribution per kind and run, with change against the baseline; a card filters the items (brief 05 J5). */
import { useMemo } from 'react';
import { splitErrorLabel, errorBucketKey, type ErrorSlot } from '@/features/run-detail/lib/rowErrors';
import { Card, Tag, Text } from '@/ui';
import { errorDistribution } from '../../lib/breakdown';
import { useCompare } from '../../CompareContext';
import type { ErrorEntry } from '../../lib/breakdown';
import type { MetricColumn } from '../../lib/baseline';
import { columnName } from '../../lib/columnName';
import { ErrorCardRow } from './ErrorCardRow';
import styles from './Panel.module.css';

const SLOT: Record<string, ErrorSlot> = {
  'Task error': 'task',
  'Metric error': 'metric',
  'Trace error': 'trace',
  'Analysis error': 'analysis',
};

export function ErrorsTab() {
  const { model, columns, baseline, items, c } = useCompare();
  const entries = useMemo(() => errorDistribution(model, columns, items), [model, columns, items]);
  const baseIdx = columns.indexOf(baseline);
  const f = c.view.filters;
  if (!entries.length)
    return (
      <Text variant="sm" tone="muted">
        No errors among the {items.length} filtered items.
      </Text>
    );
  const toggle = (kind: string, label: string) => {
    const slot = SLOT[kind] ?? 'trace';
    const cur = f.errors[slot];
    const same = cur && errorBucketKey(cur.kind, cur.label) === errorBucketKey(kind, label);
    const errors = { ...f.errors };
    if (same) delete errors[slot];
    else errors[slot] = { kind, label };
    // A metric-error card also selects that metric so a non-default metric error cannot hide behind a healthy default score.
    const patch =
      !same && kind === 'Metric error' && model.metrics.includes(label.split(':')[0] ?? '')
        ? { metric: label.split(':')[0] }
        : {};
    c.setView({ ...patch, filters: { ...f, errors } });
  };
  const kinds = ['Task error', 'Metric error', 'Trace error', 'Analysis error'];
  return (
    <div className={styles.stack}>
      {kinds.map((kind) => {
        const list = entries.filter((e) => e.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} aria-label={`${kind}s`}>
            <Text variant="md" weight={600}>
              {kind}s <Tag kind="count">{list.reduce((s, e) => s + e.count, 0)}</Tag>
            </Text>
            <ul className={styles.errorCards}>
              {list.map((e) => {
                const slot = SLOT[kind] ?? 'trace';
                const cur = f.errors[slot];
                const on = !!cur && errorBucketKey(cur.kind, cur.label) === errorBucketKey(e.kind, e.label);
                return (
                  <li key={`${kind}|${e.label}`} className={styles.errorItem}>
                    <ErrorCard
                      entry={e}
                      active={on}
                      onPress={() => toggle(kind, e.label)}
                      columns={columns}
                      baseIdx={baseIdx}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Above this many runs, runs with no error of this kind fold into one line. */
const FOLD_FROM = 6;

function ErrorCard({
  entry,
  active,
  onPress,
  columns,
  baseIdx,
}: {
  entry: ErrorEntry;
  active: boolean;
  onPress: () => void;
  columns: MetricColumn[];
  baseIdx: number;
}) {
  const { model } = useCompare();
  const parts = splitErrorLabel(entry.label);
  const fold = columns.length > FOLD_FROM;
  const shown = columns
    .map((col, i) => ({ col, i, count: entry.counts[i] ?? 0 }))
    .filter((x) => !fold || x.i === baseIdx || x.count > 0);
  const hidden = columns.length - shown.length;
  return (
    <Card
      tone={entry.kind === 'Task error' ? 'danger' : 'warning'}
      compact
      onPress={onPress}
      isSelected={active}
      data-testid="error-card"
    >
      <div className={styles.errorHead}>
        <span className={styles.errorTitle}>{parts.title}</span>
        <Tag kind="count">{entry.count}</Tag>
      </div>
      {parts.detail ? <span className={styles.errorDetail}>{parts.detail}</span> : null}
      <ul className={styles.errorRuns}>
        {shown.map(({ col, i, count }) => (
          <ErrorCardRow
            key={col.key}
            index={col.runIdxs[0] ?? 0}
            name={columnName(model, col)}
            title={col.title}
            count={count}
            max={Math.max(...entry.counts, 0)}
            delta={i === baseIdx ? null : count - (entry.counts[baseIdx] ?? 0)}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <span className={styles.errorDetail}>
          {hidden} run{hidden === 1 ? '' : 's'} with none
        </span>
      ) : null}
    </Card>
  );
}
