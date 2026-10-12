/** Dataset → Runs tab (brief 07 §2.9): runs evaluated on the active version. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DATASET_RUNS_PAGE, useDatasetRuns, type DatasetRunRow, type DatasetVersion } from '@/api/datasets';
import { runPath } from '@/app/routes';
import { useDelayedPending } from '@/lib/pending';
import { DataTable, EmptyState, ErrorState, Pagination, RunStatusBadge, ScoreValue, Skeleton, Text, type RunStatus } from '@/ui';
import { formatDate, formatLatency } from '../lib/itemValue';
import { metricDir } from '../lib/metricDir';

export function RunsTab({ slug, datasetRef, version }: { slug: string; datasetRef: string; version: DatasetVersion | null }) {
  const [page, setPage] = useState(1);
  const query = useDatasetRuns(slug, datasetRef, version?.version ?? null, (page - 1) * DATASET_RUNS_PAGE);
  const showSkeleton = useDelayedPending(query.isPending);
  const navigate = useNavigate();
  if (showSkeleton) return <Skeleton kind="table" rows={6} label="Loading runs" />;
  if (query.isError) return <ErrorState error={query.error} title="Couldn’t load runs" onRetry={() => void query.refetch()} />;
  if (!query.data) return null;
  const { runs, total, metric_names: metrics } = query.data;
  if (!runs.length) {
    return (
      <EmptyState
        title={version ? `No runs on ${version.version} yet` : 'No runs yet'}
        body={
          <>
            Point the SDK at this dataset (<code>Evaluator(task, &quot;{datasetRef}&quot;, …)</code>) to see runs here.
          </>
        }
      />
    );
  }
  return (
    <div data-dataset-runs>
      <DataTable<DatasetRunRow>
        aria-label="Runs on this dataset"
        storageKey="datasets.runs.v2"
        rows={runs}
        rowKey={(r) => r.id}
        rowHref={(r) => runPath(slug, r.id)}
        onRowAction={(_k, r) => navigate(runPath(slug, r.id))}
        columns={[
          { id: 'name', label: 'Run name', flex: true, minWidth: 220, cell: (r) => <Text as="span" variant="md" weight={600}>{r.run_name || r.external_run_id || r.id}</Text> },
          { id: 'status', label: 'Status', width: 120, cell: (r) => <RunStatusBadge status={r.status as RunStatus} /> },
          { id: 'date', label: 'Run date', width: 170, mono: true, cell: (r) => formatDate(r.completed_at ?? r.started_at) },
          { id: 'model', label: 'Model', width: 160, cell: (r) => r.model ?? '—' },
          { id: 'version', label: 'Version', width: 90, mono: true, cell: (r) => r.version_label ?? '—' },
          { id: 'latency', label: 'Latency', width: 90, align: 'end', mono: true, cell: (r) => formatLatency(r.avg_latency_ms) },
          ...metrics.map((m) => ({
            id: `metric:${m}`,
            label: m,
            width: 110,
            align: 'end' as const,
            mono: true,
            cell: (r: DatasetRunRow) => <ScoreValue value={r.metric_averages?.[m] ?? null} direction={metricDir(r.metric_directions?.[m])} />,
          })),
        ]}
      />
      {total > DATASET_RUNS_PAGE ? <Pagination total={total} page={page} pageSize={DATASET_RUNS_PAGE} noun="runs" onPageChange={setPage} /> : null}
    </div>
  );
}
