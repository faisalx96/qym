/** Dataset → Runs tab (brief 07 §2.9): runs evaluated on the active version. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DATASET_RUNS_PAGE, useDatasetRuns, type DatasetRunRow, type DatasetVersion } from '@/api/datasets';
import { runPath } from '@/app/routes';
import { useDelayedPending } from '@/lib/pending';
import { DataTable, EmptyState, RelativeTime, ScoreBar, StatusCell, Text, type Column } from '@/ui';
import { formatLatency } from '../lib/itemValue';
import { metricDir } from '../lib/metricDir';

export function RunsTab({
  slug,
  datasetRef,
  version,
}: {
  slug: string;
  datasetRef: string;
  version: DatasetVersion | null;
}) {
  const [page, setPage] = useState(1);
  const query = useDatasetRuns(slug, datasetRef, version?.version ?? null, (page - 1) * DATASET_RUNS_PAGE);
  const showSkeleton = useDelayedPending(query.isPending);
  const navigate = useNavigate();
  const runs = query.data?.runs ?? [];
  const total = query.data?.total ?? 0;
  const metrics = query.data?.metric_names ?? [];
  const columns: Column<DatasetRunRow>[] = [
    {
      id: 'name',
      header: 'Run name',
      flex: true,
      minWidth: 220,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (r) => (
        <Text as="span" variant="md" weight={600}>
          {r.run_name || r.external_run_id || r.id}
        </Text>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 120,
      priority: 1,
      cell: (r) => <StatusCell status={r.status} />,
    },
    {
      id: 'date',
      header: 'Run date',
      type: 'date',
      width: 130,
      priority: 2,
      cell: (r) => <RelativeTime iso={r.completed_at ?? r.started_at} />,
    },
    { id: 'model', header: 'Model', width: 160, priority: 2, cell: (r) => r.model ?? '—' },
    {
      id: 'version',
      header: 'Version',
      type: 'id',
      width: 90,
      priority: 3,
      cell: (r) => r.version_label ?? '—',
    },
    {
      id: 'latency',
      header: 'Latency',
      type: 'duration',
      width: 90,
      priority: 3,
      cell: (r) => formatLatency(r.avg_latency_ms),
    },
    ...metrics.map((m): Column<DatasetRunRow> => ({
      id: `metric:${m}`,
      header: m,
      group: 'Metrics',
      type: 'score',
      width: 130,
      priority: 2,
      cell: (r) => (
        <ScoreBar value={r.metric_averages?.[m] ?? null} direction={metricDir(r.metric_directions?.[m])} />
      ),
    })),
  ];
  return (
    <div data-dataset-runs>
      <DataTable<DatasetRunRow>
        aria-label="Runs on this dataset"
        storageKey="datasets.runs.v3"
        rows={runs}
        rowKey={(r) => r.id}
        rowHref={(r) => runPath(slug, r.id)}
        onRowOpen={(r) => navigate(runPath(slug, r.id))}
        columns={columns}
        loading={showSkeleton}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        empty={
          query.data ? (
            <EmptyState
              title={version ? `No runs on ${version.version} yet` : 'No runs yet'}
              body={
                <>
                  Point the SDK at this dataset (<code>Evaluator(task, &quot;{datasetRef}&quot;, …)</code>) to
                  see runs here.
                </>
              }
            />
          ) : undefined
        }
      >
        <DataTable.Footer
          summary={query.data ? `${total.toLocaleString()} ${total === 1 ? 'run' : 'runs'}` : undefined}
          pagination={
            total > DATASET_RUNS_PAGE
              ? { total, page, pageSize: DATASET_RUNS_PAGE, noun: 'runs', onPageChange: setPage }
              : undefined
          }
        />
      </DataTable>
    </div>
  );
}
