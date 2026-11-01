/** Root cause categories across items, aggregate and auto-analyze actions (brief 04 §3h). */
import { useMemo, useState } from 'react';
import { useAggregateAnalysis } from '@/api/runs';
import { AnalysisSpark } from '@/features/runs-list/AnalyzeAction';
import { Button, Card, LinkButton, Select, Tag, useToast } from '@/ui';
import {
  getRowRootCauseAnalyses,
  isRejectedIssue,
  rootCauseCategories,
  rootCauseIssues,
} from '../../lib/rowMeta';
import { analyzerHref } from '../../lib/runActions';
import { useRunPage } from '../../RunContext';
import { messageFor } from '../items/ScoreEditor';
import styles from './Panels.module.css';

export function RootCauseTab() {
  const { model, api, items, runId, basePath, readOnly, payload } = useRunPage();
  const toast = useToast();
  const [metric, setMetric] = useState<string>('all');
  const aggregate = useAggregateAnalysis(runId);
  const repeatAggregate = model.isRepeat && !model.viewPass;
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  // Rejected issues leave the counts and the filter (C067); each card says how many it left out.
  const { categories, rejected, rejectedElsewhere } = useMemo(() => {
    const map = new Map<string, { items: Set<string>; subs: Map<string, number> }>();
    const rejectedBy = new Map<string, number>();
    rows.forEach((row) => {
      const passes = repeatAggregate ? row.pass_metric_analyses : null;
      const source: [string, unknown][] =
        passes && Object.keys(passes).length
          ? Object.entries(passes).flatMap(([name, list]) =>
              Array.isArray(list) ? list.map((a): [string, unknown] => [name, a]) : [],
            )
          : Object.entries((row.item_metadata?.metric_analyses ?? {}) as Record<string, unknown>);
      source.forEach(([name, analysis]) => {
        if (metric !== 'all' && metric !== name) return;
        rootCauseIssues(analysis, false)
          .filter(isRejectedIssue)
          .forEach((i) => rejectedBy.set(i.category, (rejectedBy.get(i.category) ?? 0) + 1));
      });
      getRowRootCauseAnalyses(row, metric, repeatAggregate).forEach((analysis) => {
        const issues = rootCauseIssues(analysis).filter((i) => !isRejectedIssue(i));
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
    const list = Array.from(map.entries()).sort((a, b) => b[1].items.size - a[1].items.size);
    const shown = new Set(list.map(([cat]) => cat));
    let elsewhere = 0;
    rejectedBy.forEach((n, cat) => {
      if (!shown.has(cat)) elsewhere += n;
    });
    return { categories: list, rejected: rejectedBy, rejectedElsewhere: elsewhere };
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
          <LinkButton
            size="sm"
            variant="meta"
            to={analyzerHref(basePath, model.viewPass, metric === 'all' ? api.selectedMetric : metric)}
            icon={<AnalysisSpark filled={false} />}
          >
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
      <div className={styles.cards}>
        {categories.map(([cat, entry]) => {
          const on = active.some((a) => a.toLowerCase() === cat.toLowerCase());
          return (
            <Card
              key={cat}
              compact
              tone="neutral"
              isSelected={on}
              data-testid="root-cause-card"
              onPress={() => {
                if (on) api.setFilters({ rootCause: null, rootCauseMetric: 'all' });
                else api.setFilters({ rootCause: [cat], rootCauseMetric: metric });
              }}
            >
              <span className={styles.rowHead}>
                <span className={styles.label}>{cat}</span>
                <Tag kind="count">{entry.items.size}</Tag>
                {rejected.get(cat) ? (
                  <span className={styles.rejectedNote} data-testid="root-cause-rejected">
                    {rejected.get(cat)} rejected
                  </span>
                ) : null}
              </span>
              {entry.subs.size ? (
                <span className={styles.detail}>
                  {Array.from(entry.subs.entries())
                    .map(([s, n]) => `${s} (${n})`)
                    .join(' · ')}
                </span>
              ) : null}
            </Card>
          );
        })}
      </div>
      {rejectedElsewhere ? (
        <p className={styles.note} data-testid="root-cause-rejected-elsewhere">
          {rejectedElsewhere} rejected {rejectedElsewhere === 1 ? 'issue is' : 'issues are'} left out of these
          counts.
        </p>
      ) : null}
    </div>
  );
}
