/**
 * Inline passes panel under a repeat run (J6, redesign2 §5.3): one header line (title, metric, threshold chip),
 * one stat band, then the pass rows as an embedded table that mirrors the parent's metric columns.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunRow } from '@/api/dashboardTypes';
import { useDeletePasses, useGroupMetrics, useRunPasses } from '@/api/dashboard';
import { Badge, Button, ConfirmDialog, ErrorState, HelpMarker, Select, Skeleton, Text, useToast } from '@/ui';
import { runPath } from '@/app/routes';
import { runHref } from '@/lib/runs-order';
import { metricDirection } from '@/lib/metrics';
import { defaultMetricName, defaultPassThreshold, groupStatRule, toChartRun } from '../chartModel';
import { useRunsCtx } from '../context';
import { isActiveRun } from '../polling';
import { PassStats, statDefinitions } from './PassStats';
import { PassThreshold } from './PassThreshold';
import { PassesTable, toPassRows } from './PassesTable';
import {
  mirroredMetrics,
  passRowsView,
  queuedText,
  readStoredMetric,
  writeStoredMetric,
  type PassView,
  type QueuedView,
} from './model';
import styles from './PassesPanel.module.css';

export function PassesPanel({
  row,
  slug,
  selectMode,
  selected,
  onToggle,
  canDelete,
  onNotePassRevision,
  onPassesDeleted,
}: {
  row: RunRow;
  slug: string;
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (ref: string) => void;
  canDelete: boolean;
  /** Records the pass revision these refs were picked against (stale picks drop out when it changes). */
  onNotePassRevision?: (runId: string, revision: number) => void;
  /** Called after a pass delete so the run's pass picks (now renumbered) can be cleared. */
  onPassesDeleted?: (runId: string) => void;
}) {
  const { metricTypes, slug: ctxSlug, listContext, visibleMetrics, analyzing } = useRunsCtx();
  useEffect(() => {
    onNotePassRevision?.(row.run_id, row.pass_revision ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callback is stable per selection; revision is what matters
  }, [row.run_id, row.pass_revision]);
  const live = isActiveRun(row);
  const passesQ = useRunPasses(row.run_id, { refetchInterval: live ? 15_000 : false });
  const scoreMetrics = (passesQ.data?.metrics ?? row.metrics).filter((m) => metricTypes[m] !== 'numeric');
  const defaultMetric = defaultMetricName(scoreMetrics, row.metric_specs) ?? scoreMetrics[0] ?? null;
  const [metric, setMetric] = useState<string | null>(null);
  const remembered = readStoredMetric(ctxSlug || slug);
  const initialMetric = remembered && scoreMetrics.includes(remembered) ? remembered : defaultMetric;
  const activeMetric = metric ?? initialMetric;
  const rule = activeMetric ? groupStatRule([toChartRun(row)], activeMetric) : null;
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const dirOf = metricDirection(row.metric_specs[activeMetric ?? '']);
  const defaultThreshold =
    rule?.threshold ?? defaultPassThreshold(activeMetric ? row.metric_specs[activeMetric] : undefined, dirOf);
  const activeThreshold = (activeMetric ? thresholds[activeMetric] : undefined) ?? defaultThreshold;
  const groupQ = useGroupMetrics(row.run_id, activeMetric, activeThreshold, {
    enabled: Boolean(activeMetric) && row.samples > 1,
  });
  const del = useDeletePasses(slug);
  const toast = useToast();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const name = row.external_run_id || row.run_name;

  if (passesQ.isPending)
    return (
      <div className={styles.panel}>
        <Skeleton kind="lines" rows={3} label="Loading passes" />
      </div>
    );
  if (passesQ.isError)
    return (
      <div className={styles.panel}>
        <ErrorState
          compact
          error={passesQ.error}
          title="Could not load passes"
          onRetry={() => passesQ.refetch()}
        />
      </div>
    );
  const data = passesQ.data;
  const g = groupQ.data?.group ?? null;
  const k = g?.k ?? row.samples;
  const dir = dirOf;
  const canDeletePass = canDelete && !['RUNNING', 'PENDING', 'SUBMITTED', 'APPROVED'].includes(row.status);
  const view = passRowsView(data.passes, data.samples || row.samples, row.status);
  const passViews = view.rows.filter((r): r is PassView => r.kind === 'pass');
  const queued = view.rows.find((r): r is QueuedView => r.kind === 'queued');
  const { shown, hidden } = mirroredMetrics(data.metrics, visibleMetrics);
  const tableMetrics = showAll ? [...shown, ...hidden] : shown;
  const passHref = (n: number, sub = '') => {
    const base = runHref(`${runPath(ctxSlug, row.run_id)}${sub}`, listContext);
    return `${base}${base.includes('?') ? '&' : '?'}pass=${n}`;
  };
  const items = g?.total_items ?? row.total_items;

  return (
    <div
      className={styles.panel}

      role="region"
      aria-label={`Passes of ${name}`}
    >
      <div className={styles.head}>
        <div className={styles.title}>
          <Text variant="md" as="span">
            Passes
          </Text>
          <Text variant="sm" tone="muted" as="span">
            {k} passes · {items} items
          </Text>
        </div>
        <div className={styles.controls}>
          <Select
            label="Metric"
            hideLabel
            items={scoreMetrics.map((m) => ({ key: m, label: m.replace(/_/g, ' ') }))}
            value={activeMetric}
            onChange={(key) => {
              if (key) {
                setMetric(String(key));
                writeStoredMetric(ctxSlug || slug, String(key));
              }
            }}
            width={160}
          />
          {dir && activeMetric ? (
            <PassThreshold
              value={activeThreshold}
              defaultValue={defaultThreshold}
              direction={dir}
              onChange={(v) => setThresholds((t) => ({ ...t, [activeMetric]: v }))}
              onReset={() =>
                setThresholds((t) => {
                  const next = { ...t };
                  delete next[activeMetric];
                  return next;
                })
              }
            />
          ) : (
            <Text variant="sm" tone="muted" as="span">
              No direction declared
            </Text>
          )}
          <HelpMarker label="group metrics">
            <dl className={styles.defs}>
              {statDefinitions(k).map((d) => (
                <div key={d.label}>
                  <dt>{d.label}</dt>
                  <dd>{d.help}</dd>
                </div>
              ))}
            </dl>
          </HelpMarker>
        </div>
      </div>
      {groupQ.isError ? (
        <Text variant="sm" tone="muted" as="p">
          Group metrics are not available:{' '}
          {groupQ.error instanceof Error ? groupQ.error.message : 'request failed'}
        </Text>
      ) : (
        <PassStats group={g} k={k} dir={dir} busy={groupQ.isFetching} />
      )}
      <PassesTable
        name={name}
        rows={toPassRows(row.run_id, passViews)}
        metrics={tableMetrics}
        specs={row.metric_specs}
        metricTypes={metricTypes}
        selectedMetric={activeMetric}
        passHref={passHref}
        analyzing={analyzing?.has(row.run_id) ?? false}
        selectMode={selectMode}
        selected={selected}
        onToggle={onToggle}
        canDelete={canDeletePass}
        onOpen={(n) => navigate(passHref(n))}
        onDelete={setDeleting}
      />
      {queued || hidden.length ? (
        <div className={styles.foot}>
          {queued ? (
            <span className={styles.queued} data-queued="">
              <Badge tone={queued.notRun ? 'warning' : 'neutral'}>
                {queued.notRun ? 'NOT RUN' : 'QUEUED'}
              </Badge>
              <Text variant="sm" tone="muted" as="span">
                {queuedText(queued)}
              </Text>
            </span>
          ) : (
            <span />
          )}
          {hidden.length ? (
            <Button variant="ghost" aria-pressed={showAll} onPress={() => setShowAll((v) => !v)}>
              {showAll ? 'Show only the visible metrics' : `Show all metrics (+${hidden.length})`}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete pass ${deleting ?? ''}?`}
        description="The pass and its scores are removed from this run permanently. The run's means are recomputed."
        confirmLabel="Delete pass"
        tone="danger"
        onConfirm={async () => {
          if (deleting === null) return;
          await del.mutateAsync({
            runId: row.run_id,
            passes: [deleting],
            expectedVersion: data.pass_revision ?? row.pass_revision ?? 0,
          });
          onPassesDeleted?.(row.run_id);
          toast.show(`Pass ${deleting} deleted`, { tone: 'success' });
        }}
      />
    </div>
  );
}
