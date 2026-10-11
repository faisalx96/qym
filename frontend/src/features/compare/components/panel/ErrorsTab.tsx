/** Error distribution per kind and run, with change against the baseline; a card filters the items (brief 05 J5). */
import { useMemo } from 'react';
import { splitErrorLabel, errorBucketKey, type ErrorSlot } from '@/features/run-detail/lib/rowErrors';
import { Tag, Text } from '@/ui';
import { errorDistribution } from '../../lib/breakdown';
import { letterOf, useCompare } from '../../CompareContext';
import { RunDot } from '../common';
import styles from './Panel.module.css';

const SLOT: Record<string, ErrorSlot> = { 'Task error': 'task', 'Metric error': 'metric', 'Trace error': 'trace', 'Analysis error': 'analysis' };

export function ErrorsTab() {
  const { model, columns, baseline, items, c } = useCompare();
  const entries = useMemo(() => errorDistribution(model, columns, items), [model, columns, items]);
  const baseIdx = columns.indexOf(baseline);
  const f = c.view.filters;
  if (!entries.length) return <Text variant="sm" tone="muted">No errors among the {items.length} filtered items.</Text>;
  const toggle = (kind: string, label: string) => {
    const slot = SLOT[kind] ?? 'trace';
    const cur = f.errors[slot];
    const same = cur && errorBucketKey(cur.kind, cur.label) === errorBucketKey(kind, label);
    const errors = { ...f.errors };
    if (same) delete errors[slot];
    else errors[slot] = { kind, label };
    // A metric-error card also selects that metric so a non-default metric error cannot hide behind a healthy default score.
    const patch = !same && kind === 'Metric error' && model.metrics.includes(label.split(':')[0] ?? '') ? { metric: label.split(':')[0] } : {};
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
            <ul className={styles.errorList}>
              {list.map((e) => {
                const slot = SLOT[kind] ?? 'trace';
                const cur = f.errors[slot];
                const on = !!cur && errorBucketKey(cur.kind, cur.label) === errorBucketKey(e.kind, e.label);
                const parts = splitErrorLabel(e.label);
                return (
                  <li key={`${kind}|${e.label}`}>
                    <button type="button" className={styles.errorCard} aria-pressed={on} onClick={() => toggle(kind, e.label)} title={e.label}>
                      <span className={styles.errorTitle}>{parts.title}</span>
                      {parts.detail ? <span className={styles.errorDetail}>{parts.detail}</span> : null}
                      <span className={styles.errorCounts}>
                        {columns.map((col, i) => {
                          const count = e.counts[i] ?? 0;
                          const delta = count - (e.counts[baseIdx] ?? 0);
                          return (
                            <span key={col.key} className={styles.errorCount} title={col.title}>
                              <RunDot index={col.runIdxs[0] ?? 0} />
                              {letterOf(col.runIdxs[0] ?? 0)} {count}
                              {i !== baseIdx && delta !== 0 ? (
                                <Tag kind="data" tone={delta < 0 ? 'success' : 'danger'}>
                                  {delta < 0 ? '▼' : '▲'} {delta > 0 ? '+' : '−'}
                                  {Math.abs(delta)}
                                </Tag>
                              ) : null}
                            </span>
                          );
                        })}
                      </span>
                    </button>
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
