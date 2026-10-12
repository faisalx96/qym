/** Root cause categories across items, aggregate and auto-analyze actions (brief 04 §3h). */
import { useMemo, useState } from 'react';
import { useAggregateAnalysis } from '@/api/runs';
import { Button, LinkButton, Select, Tag, useToast } from '@/ui';
import { getRowRootCauseAnalyses, rootCauseCategories, rootCauseIssues } from '../../lib/rowMeta';
import { useRunPage } from '../../RunContext';
import { messageFor } from '../items/ScoreEditor';
import styles from './Panels.module.css';

const TONES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

function toneFor(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length]!;
}

export function RootCauseTab() {
  const { model, api, items, runId, basePath, readOnly, payload } = useRunPage();
  const toast = useToast();
  const [metric, setMetric] = useState<string>('all');
  const aggregate = useAggregateAnalysis(runId);
  const repeatAggregate = model.isRepeat && !model.viewPass;
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  const categories = useMemo(() => {
    const map = new Map<string, { items: Set<string>; subs: Map<string, number> }>();
    rows.forEach((row) => {
      getRowRootCauseAnalyses(row, metric, repeatAggregate).forEach((analysis) => {
        const issues = rootCauseIssues(analysis);
        rootCauseCategories(analysis).forEach((cat) => {
          const entry = map.get(cat) ?? { items: new Set(), subs: new Map() };
          entry.items.add(row.item_id);
          issues
            .filter((i) => i.category === cat && i.subcategory)
            .forEach((i) => entry.subs.set(i.subcategory, (entry.subs.get(i.subcategory) ?? 0) + 1));
          map.set(cat, entry);
        });
      });
    });
    return Array.from(map.entries()).sort((a, b) => b[1].items.size - a[1].items.size);
  }, [rows, metric, repeatAggregate]);
  const status = payload.run.metadata?.analysis_aggregation as
    { status?: string; message?: string } | string | null | undefined;
  const statusText = typeof status === 'string' ? status : (status?.message ?? status?.status ?? '');
  const active = api.view.filters.rootCause ?? [];
  return (
    <div className={styles.stack}>
      <div className={styles.controls}>
        <Select
          label="Metric"
          items={[
            { key: 'all', label: 'All metrics' },
            ...model.metricNames.map((m) => ({ key: m, label: m })),
          ]}
          value={metric}
          onChange={(k) => k !== null && setMetric(String(k))}
          width="16ch"
        />
        {readOnly ? null : (
          <Button
            size="sm"
            variant="neutral"
            loading={aggregate.isPending}
            onPress={() =>
              aggregate.mutate(metric === 'all' ? {} : { metric }, {
                onSuccess: () => toast.show('Aggregation started', { tone: 'success' }),
                onError: (e) => toast.show(messageFor(e), { tone: 'error' }),
              })
            }
          >
            Aggregate results
          </Button>
        )}
        {readOnly ? null : (
          <LinkButton size="sm" variant="accent" to={`${basePath}/analyzer`}>
            Auto-Analyze
          </LinkButton>
        )}
      </div>
      {statusText ? <p className={styles.note}>Aggregation: {statusText}</p> : null}
      {categories.length === 0 ? (
        <p className={styles.note}>
          No root causes recorded yet. Run Auto-Analyze, or add issues from an item’s failing metric.
        </p>
      ) : null}
      {categories.map(([cat, entry]) => {
        const on = active.some((a) => a.toLowerCase() === cat.toLowerCase());
        return (
          <button
            key={cat}
            type="button"
            className={styles.cardButton}
            aria-pressed={on}
            data-testid="root-cause-card"
            style={{ borderInlineStartWidth: 3, borderInlineStartColor: toneFor(cat) }}
            onClick={() => {
              if (on) api.setFilters({ rootCause: null, rootCauseMetric: 'all' });
              else api.setFilters({ rootCause: [cat], rootCauseMetric: metric });
            }}
          >
            <span className={styles.rowHead}>
              <span className={styles.label}>{cat}</span>
              <Tag kind="count">{entry.items.size}</Tag>
            </span>
            {entry.subs.size ? (
              <span className={styles.detail}>
                {Array.from(entry.subs.entries())
                  .map(([s, n]) => `${s} (${n})`)
                  .join(' · ')}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
