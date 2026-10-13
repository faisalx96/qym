/** Item → Runs tab: stat strip + sortable table of every run that evaluated this item. */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useItemRuns, type Dataset, type DatasetVersion, type ItemRunRow } from '@/api/datasets';
import { runPath } from '@/app/routes';
import { useDelayedPending } from '@/lib/pending';
import {
  Button,
  DataTable,
  EmptyState,
  RelativeTime,
  ScoreBar,
  ScoreValue,
  StatStrip,
  StatusCell,
  Text,
  type Column,
  type SortState,
} from '@/ui';
import { Preview } from '../detail/ItemsTab';
import { formatLatency, previewValue } from '../lib/itemValue';
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
  const navigate = useNavigate();
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

  const columns: Column<ItemRunRow>[] = [
    {
      id: 'name',
      header: 'Run name',
      sort: 'name',
      flex: true,
      minWidth: 200,
      pin: 'start',
      hideable: false,
      priority: 1,
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
      header: 'Status',
      type: 'status',
      width: 110,
      priority: 1,
      cell: (r) => <StatusCell status={r.status} />,
    },
    {
      id: 'date',
      header: 'Run date',
      type: 'date',
      sort: 'date',
      width: 130,
      priority: 2,
      cell: (r) => <RelativeTime iso={r.completed_at ?? r.created_at} />,
    },
    { id: 'model', header: 'Model', sort: 'model', width: 150, priority: 2, cell: (r) => r.model ?? '—' },
    {
      id: 'output',
      header: (
        <span className={styles.outputHead}>
          Output
          <Button variant="ghost" size="sm" onPress={() => setExpandAll((v) => !v)}>
            {expandAll ? 'Collapse' : 'Expand'}
          </Button>
        </span>
      ),
      flex: true,
      minWidth: 220,
      wrap: expandAll ? undefined : 2,
      priority: 3,
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
      header: 'Latency',
      type: 'duration',
      sort: 'latency',
      width: 90,
      priority: 3,
      cell: (r) => formatLatency(r.latency_ms),
    },
    ...metrics.map((m): Column<ItemRunRow> => ({
      id: `metric:${m}`,
      header: m,
      group: 'Metrics',
      type: 'score',
      sort: `metric:${m}`,
      width: 130,
      priority: 2,
      cell: (r) => {
        const s = r.scores.find((x) => x.metric_name === m);
        return (
          <ScoreBar
            value={s?.score_numeric ?? null}
            direction={metricDir(r.metric_directions?.[m])}
            error={r.error ? 'task' : s && s.score_numeric === null ? 'metric' : null}
          />
        );
      },
    })),
    {
      id: 'trace',
      header: 'Trace',
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
  ];

  const agg = query.data?.aggregates;
  if (query.data && !query.data.runs.length)
    return <EmptyState compact title="No runs evaluated this item yet" />;

  return (
    <div className={styles.wrap}>
      {agg ? (
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
      ) : null}
      <DataTable<ItemRunRow>
        aria-label="Runs for this item"
        storageKey="datasets.item.runs.v4"
        rows={rows}
        rowKey={(r) => r.run_id}
        sort={sort}
        onSortChange={(s) => s && setSort(s)}
        columns={columns}
        loading={showSkeleton}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        rowHref={(r) => `${runPath(slug, r.run_id)}?item=${encodeURIComponent(r.item_id)}`}
        onRowOpen={(r) => navigate(`${runPath(slug, r.run_id)}?item=${encodeURIComponent(r.item_id)}`)}
        density="regular"
      >
        <DataTable.Footer summary={`${rows.length} ${rows.length === 1 ? 'run' : 'runs'}`} />
      </DataTable>
    </div>
  );
}
