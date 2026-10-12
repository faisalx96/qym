import type { BestRunRow } from '@/api/launch';
import { DataTable, Tag, type Column } from '@/ui';
import { Button } from '@/ui';
import { formatAge, formatScore, versionText } from '../model';
import { shortId, sweepText } from './lib';
import styles from './bestrun.module.css';

/** The ranked runs of a scope: rank, score, pass@k, items, remote versioning, params, age. */
export function RunsTable({
  runs,
  metric,
  k,
  selectedRunId,
  onUse,
}: {
  runs: BestRunRow[];
  metric: string;
  k: number | null | undefined;
  selectedRunId: string | undefined;
  onUse: (run: BestRunRow) => void;
}) {
  const columns: Column<BestRunRow>[] = [
    { id: 'rank', label: '#', width: 40, minWidth: 36, mono: true, cell: (r) => r.rank, resizable: false },
    { id: 'run', label: 'Run', width: 100, mono: true, cell: (r) => shortId(r.run_id) },
    {
      id: 'dataset',
      label: 'Dataset',
      width: 180,
      flex: true,
      cell: (r) =>
        r.dataset ? r.dataset.name + (r.dataset_version ? ` ${r.dataset_version.version}` : '') : 'Custom dataset',
    },
    {
      id: 'score',
      label: metric || 'Score',
      width: 90,
      mono: true,
      align: 'end',
      cell: (r) => formatScore(r.score),
    },
    {
      id: 'pass',
      label: k ? `pass@${k}` : 'pass@k',
      width: 80,
      mono: true,
      align: 'end',
      cell: (r) => (r.pass_at_k_value == null ? '—' : formatScore(r.pass_at_k_value)),
    },
    {
      id: 'items',
      label: 'Items',
      width: 100,
      mono: true,
      align: 'end',
      cell: (r) => `${r.item_count ?? 0}${r.error_item_count ? ` (${r.error_item_count} err)` : ''}`,
    },
    {
      id: 'versions',
      label: 'Versions',
      width: 200,
      mono: true,
      cell: (r) => versionText(r.remote_versioning) || '—',
    },
    { id: 'swept', label: 'Swept', width: 150, mono: true, cell: (r) => sweepText(r.params) || '—' },
    { id: 'age', label: 'Age', width: 80, cell: (r) => formatAge(r.age_seconds) },
    {
      id: 'action',
      label: 'Use',
      hideLabel: true,
      width: 120,
      resizable: false,
      cell: (r) =>
        r.run_id === selectedRunId ? (
          <Tag tone="success">Current base</Tag>
        ) : (
          <Button variant="neutral" aria-label={`Start from run ${shortId(r.run_id)}`} onPress={() => onUse(r)}>
            Use
          </Button>
        ),
    },
  ];
  return (
    <div className={styles.tableWrap}>
      <DataTable
        aria-label="Best runs"
        columns={columns}
        rows={runs}
        rowKey={(r) => r.run_id}
        minWidth={900}
        stickyHeader={false}
      />
    </div>
  );
}
