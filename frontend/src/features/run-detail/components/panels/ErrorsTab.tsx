/** Errors grouped by message; a card toggles the per-kind error filter (brief 04 §3g). */
import { useMemo, useState } from 'react';
import { Tag } from '@/ui';
import {
  collectErrors,
  slotOfKind,
  splitErrorLabel,
  type ErrorBucket,
  type ErrorKind,
} from '../../lib/rowErrors';
import { useRunPage } from '../../RunContext';
import styles from './Panels.module.css';

const ORDER: ErrorKind[] = ['Task error', 'Metric error', 'Trace error', 'Analysis error'];
const CLASS: Record<ErrorKind, string> = {
  'Task error': 'task',
  'Metric error': 'metric',
  'Trace error': 'trace',
  'Analysis error': 'analysis',
};

function ErrorCard({
  bucket,
  active,
  onToggle,
}: {
  bucket: ErrorBucket;
  active: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { title, detail } = splitErrorLabel(bucket.label);
  const long = detail.length > 120;
  return (
    <div>
      <button
        type="button"
        className={styles.cardButton}
        data-kind={CLASS[bucket.kind]}
        aria-pressed={active}
        onClick={onToggle}
        data-testid="error-card"
      >
        <span className={styles.rowHead}>
          <span className={styles.label}>{title}</span>
          <span className={styles.stat}>
            {bucket.count} {bucket.count === 1 ? 'error' : 'errors'}
          </span>
        </span>
        {detail ? (
          <span className={styles.detail}>{long && !open ? detail.slice(0, 118) + '…' : detail}</span>
        ) : null}
        <span className={styles.detail}>
          {bucket.itemIds.size} {bucket.itemIds.size === 1 ? 'item' : 'items'}
        </span>
      </button>
      {long ? (
        <button type="button" className={styles.showMore} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

export function ErrorsTab() {
  const { items, model, api } = useRunPage();
  const repeatAggregate = model.isRepeat && !model.viewPass;
  const groups = useMemo(() => {
    const buckets = Array.from(
      collectErrors(
        items.map((i) => i.row),
        repeatAggregate,
      ).values(),
    );
    return ORDER.map((kind) => ({
      kind,
      buckets: buckets.filter((b) => b.kind === kind).sort((a, b) => b.count - a.count),
    })).filter((g) => g.buckets.length);
  }, [items, repeatAggregate]);
  if (!groups.length) return <p className={styles.note}>No errors in the current view.</p>;
  const active = api.view.filters.errors;
  return (
    <div className={styles.stack}>
      {groups.map((g) => (
        <section key={g.kind} aria-label={g.kind + 's'} className={styles.stack}>
          <h3 className={styles.groupTitle}>
            {g.kind}s <Tag kind="count">{g.buckets.reduce((a, b) => a + b.count, 0)}</Tag>
          </h3>
          {g.buckets.map((b) => {
            const slot = slotOfKind(b.kind);
            const on = active[slot]?.label === b.label;
            return (
              <ErrorCard
                key={b.kind + b.label}
                bucket={b}
                active={on}
                onToggle={() => {
                  const errors = { ...api.view.filters.errors };
                  if (on) delete errors[slot];
                  else errors[slot] = { kind: b.kind, label: b.label };
                  api.setFilters({ errors });
                }}
              />
            );
          })}
        </section>
      ))}
    </div>
  );
}
