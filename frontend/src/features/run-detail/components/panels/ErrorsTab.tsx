/**
 * Errors grouped by message (brief 04 §3g). Round 10: each kind is a group with a tinted icon, its colour and its
 * total, then one card per message: the message and its detail, the error count large in the kind's colour, the items
 * it touched, and a bar of its share of the kind. Cards wrap in a grid (no table, no sideways scroll). A card toggles
 * the page's filter for that error.
 */
import { useMemo } from 'react';
import { Icon, type IconName } from '@/ui';
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

const ICON: Record<ErrorKind, IconName> = {
  'Task error': 'warning',
  'Metric error': 'target',
  'Trace error': 'chain',
  'Analysis error': 'sparkles',
};

/** What an error of the kind means for the numbers above. */
const MEANING: Record<ErrorKind, string> = {
  'Task error': 'The task failed before it could be scored. These items count as 0 in score means.',
  'Metric error': 'The scorer failed on an item. The item counts as 0 for that metric.',
  'Trace error': 'A step inside the trace failed (a tool or a model call). The item may still have a score.',
  'Analysis error': 'The automatic analysis could not explain the item.',
};

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
    return ORDER.map((kind) => {
      const list = buckets.filter((b) => b.kind === kind).sort((a, b) => b.count - a.count);
      return { kind, buckets: list, total: list.reduce((a, b) => a + b.count, 0) };
    }).filter((g) => g.buckets.length);
  }, [items, repeatAggregate]);
  if (!groups.length) return <p className={styles.note}>No errors in the current view.</p>;
  const active = api.view.filters.errors;
  const toggle = (b: ErrorBucket) => {
    const slot = slotOfKind(b.kind);
    const on = active[slot]?.label === b.label;
    const errors = { ...api.view.filters.errors };
    if (on) delete errors[slot];
    else errors[slot] = { kind: b.kind, label: b.label };
    api.setFilters({ errors });
  };
  return (
    <div className={styles.errGroups}>
      {groups.map((g) => (
        <section key={g.kind} aria-label={g.kind + 's'} className={styles.errGroup} data-kind={CLASS[g.kind]}>
          <header className={styles.errHead}>
            <span className={styles.errIcon} aria-hidden="true">
              <Icon name={ICON[g.kind]} size={14} />
            </span>
            <h3 className={styles.errKind}>{g.kind}s</h3>
            <span className={styles.errTotal}>{g.total}</span>
            <p className={styles.errMeaning}>{MEANING[g.kind]}</p>
          </header>
          <div className={styles.errGrid} role="group" aria-label={`${g.kind}s by message`}>
            {g.buckets.map((b) => {
              const { title, detail } = splitErrorLabel(b.label);
              const on = active[slotOfKind(b.kind)]?.label === b.label;
              const share = g.total ? b.count / g.total : 0;
              return (
                <button
                  key={b.kind + b.label}
                  type="button"
                  className={styles.errCard}
                  data-testid="error-card"
                  data-kind={CLASS[b.kind]}
                  aria-pressed={on}
                  data-selected={on ? '' : undefined}
                  onClick={() => toggle(b)}
                  title={
                    on ? 'Showing only these items. Click to clear.' : 'Show only the items with this error'
                  }
                >
                  <span className={styles.errText}>
                    <span className={styles.errTitle}>{title}</span>
                    {detail ? <span className={styles.errDetail}>{detail}</span> : null}
                  </span>
                  <span className={styles.errNums}>
                    <span className={styles.errCount}>{b.count}</span>
                    <span className={styles.errUnit}>
                      {b.count === 1 ? 'error' : 'errors'} · {b.itemIds.size}{' '}
                      {b.itemIds.size === 1 ? 'item' : 'items'}
                    </span>
                  </span>
                  <span className={styles.errShare} aria-hidden="true">
                    <span style={{ width: `${Math.max(3, share * 100)}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
