/** Errors grouped by message; a card toggles the per-kind error filter (brief 04 §3g). */
import { useMemo } from 'react';
import { DataTable, Tag, type Column } from '@/ui';
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

const GLYPH: Record<ErrorKind, string> = {
  'Task error': '⚠',
  'Metric error': '✕',
  'Trace error': '◔',
  'Analysis error': '✦',
};

function columnsFor(): Column<ErrorBucket>[] {
  return [
    {
      id: 'kind',
      header: 'Kind',
      label: 'Kind',
      hideLabel: true,
      width: 36,
      cell: (b) => (
        <span className={styles.sev} data-kind={CLASS[b.kind]} role="img" aria-label={b.kind}>
          {GLYPH[b.kind]}
        </span>
      ),
    },
    {
      id: 'message',
      header: 'Message',
      label: 'Message',
      flex: true,
      minWidth: 220,
      priority: 1,
      cardTitle: true,
      wrap: 2,
      accessor: (b) => splitErrorLabel(b.label).title,
      cell: (b) => {
        const { title, detail } = splitErrorLabel(b.label);
        return (
          <span className={styles.errMsg} title={detail || undefined}>
            <span className={styles.errTitle}>{title}</span>
            {detail ? <span className={styles.errDetail}>{detail}</span> : null}
          </span>
        );
      },
    },
    {
      id: 'items',
      header: 'Items',
      label: 'Items',
      type: 'number',
      width: 80,
      priority: 2,
      accessor: (b) => b.itemIds.size,
    },
    {
      id: 'count',
      header: 'Errors',
      label: 'Errors',
      type: 'number',
      width: 80,
      priority: 2,
      accessor: (b) => b.count,
    },
  ];
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
  const columns = columnsFor();
  const toggle = (b: ErrorBucket) => {
    const slot = slotOfKind(b.kind);
    const on = active[slot]?.label === b.label;
    const errors = { ...api.view.filters.errors };
    if (on) delete errors[slot];
    else errors[slot] = { kind: b.kind, label: b.label };
    api.setFilters({ errors });
  };
  return (
    <div className={styles.stack}>
      {groups.map((g) => (
        <section key={g.kind} aria-label={g.kind + 's'} className={styles.stack}>
          <h3 className={styles.groupTitle}>
            {g.kind}s <Tag kind="count">{g.buckets.reduce((a, b) => a + b.count, 0)}</Tag>
          </h3>
          <DataTable<ErrorBucket>
            aria-label={`${g.kind}s`}
            columns={columns}
            rows={g.buckets}
            rowKey={(b) => b.kind + b.label}
            density="compact"
            densityLocked
            columnMenu={false}
            zebra={false}
            variant="embedded"
            stickyHeader={false}
            onRowOpen={(b) => toggle(b)}
            rowProps={(b) => {
              const on = active[slotOfKind(b.kind)]?.label === b.label;
              return {
                'data-testid': 'error-card',
                'data-kind': CLASS[b.kind],
                'aria-current': on ? 'true' : undefined,
                'data-selected': on ? '' : undefined,
              };
            }}
          />
        </section>
      ))}
    </div>
  );
}
