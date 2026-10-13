/** Item → Runs tab: stat strip + sortable table of every run that evaluated this item. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useItemRuns, type Dataset, type DatasetVersion, type ItemRunRow } from '@/api/datasets';
import { runPath } from '@/app/routes';
import { useDelayedPending } from '@/lib/pending';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  RunStatusBadge,
  ScoreValue,
  Skeleton,
  StatStrip,
  Text,
  type RunStatus,
  type SortState,
} from '@/ui';
import { Preview } from '../detail/ItemsTab';
import { formatDate, formatLatency, previewValue } from '../lib/itemValue';
import { metricDir } from '../lib/metricDir';
import styles from './ItemRunsTab.module.css';

export function ItemRunsTab({
  slug,
  dataset,
  version,
  itemId,
}: {
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  itemId: string;
}) {
  const query = useItemRuns(slug, dataset.slug, version.version, itemId);
  const showSkeleton = useDelayedPending(query.isPending);
  const [sort, setSort] = useState<SortState>({ key: 'date', direction: 'desc' });
  const [expandAll, setExpandAll] = useState(false);
  const metrics = useMemo(() => Object.keys(query.data?.aggregates.metrics ?? {}), [query.data]);
  const rows = useMemo(() => {
    const list = [...(query.data?.runs ?? [])];
    const dir = sort.direction === 'asc' ? 1 : -1;
    const score = (r: ItemRunRow, m: string) =>
      r.scores.find((s) => s.metric_name === m)?.score_numeric ?? -Infinity;
    list.sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return a.run_name.localeCompare(b.run_name) * dir;
        case 'model':
          return String(a.model ?? '').localeCompare(String(b.model ?? '')) * dir;
        case 'latency':
          return ((a.latency_ms ?? -1) - (b.latency_ms ?? -1)) * dir;
        case 'date':
          return (
            (Date.parse(a.completed_at ?? a.created_at) - Date.parse(b.completed_at ?? b.created_at)) * dir
          );
        default:
          if (sort.key.startsWith('metric:')) {
            const m = sort.key.slice(7);
            return (score(a, m) - score(b, m)) * dir;
          }
          return 0;
      }
    });
    return list;
  }, [query.data, sort]);

  if (showSkeleton) return <Skeleton kind="table" rows={4} label="Loading runs" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title="Couldn’t load runs for this item"
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return null;
  const agg = query.data.aggregates;
  if (!query.data.runs.length) return <EmptyState compact title="No runs evaluated this item yet" />;

  return (
    <div className={styles.wrap}>
      <StatStrip
        aria-label="Run aggregates"
        variant="compact-header"
        items={[
          { label: 'Runs', value: agg.run_count },
          { label: 'Errors', value: agg.error_count, tone: agg.error_count ? 'danger' : undefined },
          { label: 'Avg latency', value: formatLatency(agg.avg_latency_ms) },
          ...metrics.map((m) => ({
            label: m,
            value: (
              <ScoreValue
                value={agg.metrics[m]?.avg ?? null}
                direction={metricDir(agg.metric_directions?.[m])}
              />
            ),
          })),
        ]}
      />
      <DataTable<ItemRunRow>
        aria-label="Runs for this item"
        storageKey="datasets.item.runs.v4"
        rows={rows}
        rowKey={(r) => r.run_id}
        sort={sort}
        onSortChange={(s) => s && setSort(s)}
        columns={[
          {
            id: 'name',
            label: 'Run name',
            sortKey: 'name',
            flex: true,
            minWidth: 200,
            cell: (r) => (
              <Link
                to={`${runPath(slug, r.run_id)}?item=${encodeURIComponent(r.item_id)}`}
                className={styles.runLink}
              >
                {r.run_name || r.external_run_id || r.run_id}
              </Link>
            ),
          },
          {
            id: 'status',
            label: 'Status',
            width: 110,
            cell: (r) => <RunStatusBadge status={r.status as RunStatus} />,
          },
          {
            id: 'date',
            label: 'Run date',
            sortKey: 'date',
            width: 170,
            mono: true,
            cell: (r) => formatDate(r.completed_at ?? r.created_at),
          },
          { id: 'model', label: 'Model', sortKey: 'model', width: 150, cell: (r) => r.model ?? '—' },
          {
            id: 'output',
            label: (
              <span className={styles.outputHead}>
                Output
                <Button variant="ghost" size="sm" onPress={() => setExpandAll((v) => !v)}>
                  {expandAll ? 'Collapse' : 'Expand'}
                </Button>
              </span>
            ),
            flex: true,
            minWidth: 220,
            cell: (r) =>
              r.error ? (
                <Text as="span" variant="sm" tone="danger">
                  {previewValue(r.error, 200)}
                </Text>
              ) : expandAll ? (
                <pre className={styles.outputFull}>{previewValue(r.output, 4000)}</pre>
              ) : (
                <Preview value={r.output} />
              ),
          },
          {
            id: 'latency',
            label: 'Latency',
            sortKey: 'latency',
            width: 90,
            align: 'end',
            mono: true,
            cell: (r) => formatLatency(r.latency_ms),
          },
          ...metrics.map((m) => ({
            id: `metric:${m}`,
            label: m,
            sortKey: `metric:${m}`,
            width: 110,
            align: 'end' as const,
            mono: true,
            cell: (r: ItemRunRow) => {
              const s = r.scores.find((x) => x.metric_name === m);
              return (
                <ScoreValue
                  value={s?.score_numeric ?? null}
                  direction={metricDir(r.metric_directions?.[m])}
                  error={r.error ? 'task' : s && s.score_numeric === null ? 'metric' : null}
                />
              );
            },
          })),
          {
            id: 'trace',
            label: 'Trace',
            width: 80,
            cell: (r) =>
              r.trace_id || r.trace_url ? (
                <Link
                  to={`${runPath(slug, r.run_id)}?item=${encodeURIComponent(r.item_id)}&trace=1`}
                  className={styles.runLink}
                >
                  Trace
                </Link>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}
