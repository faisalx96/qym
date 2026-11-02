import type { BestRunRow } from '@/api/launch';
import { DataTable, ScoreBar, Tag, TwoLine, type Column } from '@/ui';
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
    {
      id: 'rank',
      header: '#',
      type: 'number',
      width: 40,
      minWidth: 36,
      priority: 1,
      cell: (r) => r.rank,
      resizable: false,
    },
    {
      id: 'run',
      header: 'Run',
      type: 'id',
      width: 120,
      priority: 1,
      cell: (r) => (
        <TwoLine
          primary={shortId(r.run_id)}
          secondary={r.run_id === selectedRunId ? <Tag tone="success">Current base</Tag> : undefined}
        />
      ),
    },
    {
      id: 'dataset',
      header: 'Dataset',
      width: 180,
      flex: true,
      priority: 2,
      cell: (r) =>
        r.dataset
          ? r.dataset.name + (r.dataset_version ? ` ${r.dataset_version.version}` : '')
          : 'Custom dataset',
    },
    {
      id: 'score',
      header: metric || 'Score',
      type: 'score',
      width: 120,
      priority: 1,
      cell: (r) => <ScoreBar value={r.score} text={formatScore(r.score)} direction="none" />,
    },
    {
      id: 'pass',
      header: k ? `pass@${k}` : 'pass@k',
      type: 'number',
      width: 80,
      priority: 2,
      cell: (r) => (r.pass_at_k_value == null ? '—' : formatScore(r.pass_at_k_value)),
    },
    {
      id: 'items',
      header: 'Items',
      type: 'number',
      width: 100,
      priority: 2,
      cell: (r) => `${r.item_count ?? 0}${r.error_item_count ? ` (${r.error_item_count} err)` : ''}`,
    },
    {
      id: 'versions',
      header: 'Versions',
      width: 200,
      type: 'id',
      priority: 3,
      cell: (r) => versionText(r.remote_versioning) || '—',
    },
    {
      id: 'swept',
      header: 'Swept',
      width: 150,
      type: 'id',
      priority: 3,
      cell: (r) => sweepText(r.params) || '—',
    },
    { id: 'age', header: 'Age', type: 'date', width: 80, priority: 3, cell: (r) => formatAge(r.age_seconds) },
  ];
  return (
    <div className={styles.tableWrap}>
      <DataTable<BestRunRow>
        aria-label="Best runs"
        columns={columns}
        rows={runs}
        rowKey={(r) => r.run_id}
        minWidth={900}
        stickyHeader={false}
        density="regular"
        rowActions={(r) =>
          r.run_id === selectedRunId
            ? []
            : [
                {
                  id: 'use',
                  label: `Start from run ${shortId(r.run_id)}`,
                  icon: 'check',
                  primary: true,
                  onPress: onUse,
                },
              ]
        }
      />
    </div>
  );
}
