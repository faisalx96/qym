/** Error distribution per kind and run, with change against the baseline; a card filters the items (brief 05 J5). */
import { useMemo } from 'react';
import { splitErrorLabel, errorBucketKey, type ErrorSlot } from '@/features/run-detail/lib/rowErrors';
import { Icon, Tag, Text } from '@/ui';
import { errorDistribution } from '../../lib/breakdown';
import { useCompare } from '../../CompareContext';
import type { ErrorEntry } from '../../lib/breakdown';
import type { MetricColumn } from '../../lib/baseline';
import { columnName } from '../../lib/columnName';
import { ErrorCardRow } from './ErrorCardRow';
import styles from './Errors.module.css';

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
    <div className={styles.groups}>
      {kinds.map((kind) => {
        const list = entries.filter((e) => e.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} aria-label={`${kind}s`} data-part="error-group">
            <h3 className={styles.h3}>
              <Icon name="warning" size={12} /> {kind}s <Tag kind="count">{list.reduce((s, e) => s + e.count, 0)}</Tag>
            </h3>
            <ul className={styles.grid}>
              {list.map((e) => {
                const slot = SLOT[kind] ?? 'trace';
                const cur = f.errors[slot];
                const on = !!cur && errorBucketKey(cur.kind, cur.label) === errorBucketKey(e.kind, e.label);
                return (
                  <li key={`${kind}|${e.label}`} className={styles.item}>
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
  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      data-kind={entry.kind === 'Task error' ? 'task' : 'metric'}
      data-part="error-card"
      data-testid="error-card"
      onClick={onPress}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPress();
        }
      }}
    >
      <div className={styles.top}>
        <b>{parts.title}</b>
        <span className={styles.count}>
          {entry.count} <i>{entry.count === 1 ? 'error' : 'errors'}</i>
        </span>
      </div>
      {parts.detail ? <p className={styles.detail}>{parts.detail}</p> : null}
      <table className={styles.table} aria-label="Errors per run">
        <tbody>
          {columns.map((col, i) => (
            <ErrorCardRow
              key={col.key}
              index={col.runIdxs[0] ?? 0}
              name={columnName(model, col)}
              title={col.title}
              count={entry.counts[i] ?? 0}
              delta={i === baseIdx ? null : (entry.counts[i] ?? 0) - (entry.counts[baseIdx] ?? 0)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
