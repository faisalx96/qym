/** "Edit" of a model card: pick which of the model's runs count (at most K, across pages). */
import { useMemo, useState } from 'react';
import { flattenRunsPage, useModelRunsPage, type DashboardFilters } from '@/api/dashboardModels';
import { formatPercent } from '@/lib/metrics';
import { Button, Checkbox, Dialog, ErrorState, Pagination, Skeleton, Tag } from '@/ui';
import styles from './Models.module.css';

const PAGE_SIZE = 20;

export interface RunSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  modelKey: string;
  modelLabel: string;
  filters: DashboardFilters;
  metric: string;
  k: number;
  initial: string[];
  onApply: (ids: string[]) => void;
}

function Body({
  onOpenChange,
  slug,
  modelKey,
  filters,
  metric,
  k,
  initial,
  onApply,
}: Omit<RunSelectionDialogProps, 'open' | 'modelLabel'>) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>(initial);
  const request = useMemo(
    () => ({
      project_slug: slug,
      filters: { ...filters, models: [modelKey] },
      sort: 'time-desc',
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      include_config_groups: true,
    }),
    [slug, filters, modelKey, page],
  );
  const query = useModelRunsPage(request);
  const runs = useMemo(() => flattenRunsPage(query.data?.tasks ?? {}), [query.data]);
  const groups = useMemo(
    () => new Map((query.data?.config_groups ?? []).map((g) => [g.key, g])),
    [query.data],
  );
  const total = query.data?.total_runs ?? 0;
  const atLimit = selected.length >= k;
  const onPage = runs.filter((r) => selected.includes(r.run_id)).length;

  function toggle(id: string, on: boolean) {
    setSelected((cur) =>
      on ? (cur.length >= k || cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id),
    );
  }

  return (
    <>
      <div className={styles.selHead}>
        <span className={styles.selCount} data-limit={atLimit ? '' : undefined} aria-live="polite">
          {selected.length} / {k} selected
        </span>
        {selected.length > onPage ? (
          <span className={styles.muted}>{selected.length - onPage} on other pages</span>
        ) : null}
        {groups.size > 1 ? <span className={styles.muted}>{groups.size} config groups</span> : null}
      </div>
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Could not load runs"
          onRetry={() => void query.refetch()}
          compact
        />
      ) : !query.data ? (
        <Skeleton kind="list" rows={6} label="Loading runs" />
      ) : (
        <ul className={styles.selList}>
          {runs.map((run, index) => {
            const key = run.config_group_key ?? '';
            const previous = index > 0 ? (runs[index - 1]!.config_group_key ?? '') : undefined;
            const header = groups.size > 1 && key && key !== previous ? groups.get(key) : undefined;
            const score = run.metric_averages?.[metric];
            const checked = selected.includes(run.run_id);
            return (
              <li key={run.run_id}>
                {header ? (
                  <div className={styles.selGroup}>
                    {header.label ?? 'Config group'} ({header.total_runs ?? '?'} runs)
                  </div>
                ) : null}
                <div className={styles.selItem} data-selected={checked ? '' : undefined}>
                  <Checkbox
                    isSelected={checked}
                    isDisabled={!checked && atLimit}
                    onChange={(on) => toggle(run.run_id, on)}
                  >
                    <span className={styles.selName}>{run.run_name || run.run_id}</span>
                  </Checkbox>
                  <span className={styles.selMeta}>
                    {new Date(run.timestamp).toLocaleString()}
                    {run.origin === 'official' ? <Tag kind="accent">official</Tag> : null}
                  </span>
                  {score !== undefined && score !== null ? (
                    <span className={styles.selScore}>{formatPercent(score, 0)}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
          {!runs.length ? <li className={styles.muted}>No runs match these filters.</li> : null}
        </ul>
      )}
      <Pagination total={total} page={page} pageSize={PAGE_SIZE} noun="runs" onPageChange={setPage} />
      <div className={styles.dialogActions}>
        <Button size="md" onPress={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          size="md"
          variant="primary"
          isDisabled={!selected.length}
          onPress={() => {
            onApply(selected);
            onOpenChange(false);
          }}
        >
          Apply selection
        </Button>
      </div>
    </>
  );
}

export function RunSelectionDialog(props: RunSelectionDialogProps) {
  const { open, onOpenChange, modelLabel } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Select runs · ${modelLabel}`} size="data">
      <Body {...props} />
    </Dialog>
  );
}
