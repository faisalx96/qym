/** Inline passes panel under a repeat run (J6): group-metrics strip + one row per pass. */
import { useState } from 'react';
import type { RunRow } from '@/api/dashboardTypes';
import { useDeletePasses, useGroupMetrics, useRunPasses } from '@/api/dashboard';
import { ConfirmDialog, Checkbox, ErrorState, HelpMarker, IconButton, RunStatusBadge, ScoreValue, Select, Skeleton, Slider, Text, useToast } from '@/ui';
import { formatDurationMs, formatLatency, formatNumericValue } from '@/lib/format';
import { metricDirection } from '@/lib/metrics';
import { defaultMetricName, defaultPassThreshold, groupStatRule, toChartRun } from './chartModel';
import { Mono } from './cells';
import { useRunsCtx } from './context';
import { isActiveRun } from './polling';
import { passRef } from './selection';
import styles from './PassesPanel.module.css';

export function PassesPanel({
  row,
  slug,
  selectMode,
  selected,
  onToggle,
  canDelete,
}: {
  row: RunRow;
  slug: string;
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (ref: string) => void;
  canDelete: boolean;
}) {
  const { metricTypes } = useRunsCtx();
  const live = isActiveRun(row);
  const passesQ = useRunPasses(row.run_id, { refetchInterval: live ? 15_000 : false });
  const scoreMetrics = (passesQ.data?.metrics ?? row.metrics).filter((m) => metricTypes[m] !== 'numeric');
  const initialMetric = defaultMetricName(scoreMetrics, row.metric_specs) ?? scoreMetrics[0] ?? null;
  const [metric, setMetric] = useState<string | null>(null);
  const activeMetric = metric ?? initialMetric;
  const rule = activeMetric ? groupStatRule([toChartRun(row)], activeMetric) : null;
  const [threshold, setThreshold] = useState<number | null>(null);
  const activeThreshold =
    threshold ?? rule?.threshold ?? defaultPassThreshold(activeMetric ? row.metric_specs[activeMetric] : undefined, activeMetric ? metricDirection(row.metric_specs[activeMetric]) : null);
  const groupQ = useGroupMetrics(row.run_id, activeMetric, activeThreshold, { enabled: Boolean(activeMetric) && row.samples > 1 });
  const del = useDeletePasses(slug);
  const toast = useToast();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [draft, setDraft] = useState<number | null>(null);

  if (passesQ.isPending) return <div className={styles.panel}><Skeleton kind="lines" rows={3} label="Loading passes" /></div>;
  if (passesQ.isError) return <div className={styles.panel}><ErrorState compact error={passesQ.error} title="Could not load passes" onRetry={() => passesQ.refetch()} /></div>;
  const passes = passesQ.data.passes;
  const metrics = passesQ.data.metrics;
  const g = groupQ.data?.group ?? null;
  const dir = metricDirection(row.metric_specs[activeMetric ?? '']);
  const canDeletePass = canDelete && !['RUNNING', 'PENDING', 'SUBMITTED', 'APPROVED'].includes(row.status);
  const name = row.external_run_id || row.run_name;

  return (
    <div className={styles.panel} role="region" aria-label={`Passes of ${name}`}>
      <div className={styles.summary}>
        <div className={styles.summaryHead}>
          <Text variant="md" as="span">
            Group metrics
          </Text>
          <Text variant="sm" tone="muted" as="span">
            k = {g?.k ?? row.samples} · {g?.total_items ?? row.total_items} items
          </Text>
        </div>
        {groupQ.isError ? (
          <Text variant="sm" tone="muted" as="p">
            Group metrics are not available: {groupQ.error instanceof Error ? groupQ.error.message : 'request failed'}
          </Text>
        ) : (
          <dl className={styles.stats} aria-busy={groupQ.isFetching}>
            <Stat label={`Pass@${g?.k ?? 'k'}`} help="Share of items solved by at least one of the k passes at the threshold." value={g?.pass_at_k} dir={dir} />
            <Stat label={`Pass^${g?.k ?? 'k'}`} help="Share of items solved by every pass." value={g?.pass_hat_k} dir={dir} />
            <Stat label="Consistency" help="Agreement between passes on the same item." value={g?.consistency} dir={dir} />
            <Stat label="Reliability" help="Pass^k over Pass@k: how much of the ceiling is reached every time." value={g?.reliability} dir={dir} />
          </dl>
        )}
        <div className={styles.controls}>
          <Select
            label="Metric"
            items={scoreMetrics.map((m) => ({ key: m, label: m.replace(/_/g, ' ') }))}
            value={activeMetric}
            onChange={(k) => {
              if (k) {
                setMetric(String(k));
                setThreshold(null);
                setDraft(null);
              }
            }}
            width={180}
          />
          <Slider
            label="Pass threshold"
            minValue={0}
            maxValue={1}
            step={0.05}
            value={draft ?? activeThreshold}
            onChange={(v) => setDraft(v as number)}
            onChangeEnd={(v) => {
              setThreshold(v as number);
              setDraft(null);
            }}
            width={200}
          />
        </div>
      </div>
      <table className={styles.passes} aria-label={`${name} passes`}>
        <thead>
          <tr>
            {selectMode ? <th scope="col" className={styles.selectCol} /> : null}
            <th scope="col">Pass</th>
            <th scope="col">Status</th>
            {metrics.map((m) => (
              <th scope="col" key={m} data-align="end">
                {m.replace(/_/g, ' ')}
              </th>
            ))}
            <th scope="col" data-align="end">
              Items
            </th>
            <th scope="col" data-align="end">
              ⚡ Avg latency
            </th>
            <th scope="col" data-align="end">
              Duration
            </th>
            <th scope="col">
              <span className={styles.srOnly}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {passes.map((p) => {
            const ref = passRef(row.run_id, p.pass_number);
            return (
              <tr key={p.pass_number} data-selected={selected.has(ref) ? '' : undefined}>
                {selectMode ? (
                  <td className={styles.selectCol}>
                    <Checkbox aria-label={`Select pass ${p.pass_number} of ${name}`} isSelected={selected.has(ref)} onChange={() => onToggle(ref)} />
                  </td>
                ) : null}
                <td>
                  <Mono>#{p.pass_number}</Mono>
                </td>
                <td>
                  <RunStatusBadge status={p.status.toUpperCase() as 'COMPLETED'} />
                </td>
                {metrics.map((m) => (
                  <td key={m} data-align="end">
                    {metricTypes[m] === 'numeric' ? (
                      <Mono>{formatNumericValue(p.metric_means[m], 2)}</Mono>
                    ) : (
                      <ScoreValue value={p.metric_means[m]} type={metricTypes[m]} direction={metricDirection(row.metric_specs[m])} digits={1} />
                    )}
                  </td>
                ))}
                <td data-align="end">
                  <Mono>
                    {p.items_scored}/{p.items_total}
                  </Mono>
                </td>
                <td data-align="end">
                  <Mono>{formatLatency(p.avg_latency_ms)}</Mono>
                </td>
                <td data-align="end">
                  <Mono>{formatDurationMs(p.duration_ms)}</Mono>
                </td>
                <td>
                  {canDeletePass ? <IconButton label={`Delete pass ${p.pass_number} of ${name}`} icon="trash" tone="danger" onPress={() => setDeleting(p.pass_number)} /> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete pass ${deleting ?? ''}?`}
        description="The pass and its scores are removed from this run permanently. The run's means are recomputed."
        confirmLabel="Delete pass"
        tone="danger"
        onConfirm={async () => {
          if (deleting === null) return;
          await del.mutateAsync({ runId: row.run_id, passes: [deleting] });
          toast.show(`Pass ${deleting} deleted`, { tone: 'success' });
        }}
      />
    </div>
  );
}

function Stat({ label, help, value, dir }: { label: string; help: string; value: number | null | undefined; dir: 'maximize' | 'minimize' | null }) {
  return (
    <div>
      <dt>
        {label} <HelpMarker label={label}>{help}</HelpMarker>
      </dt>
      <dd>
        <ScoreValue value={value} direction={dir ?? 'maximize'} digits={1} />
      </dd>
    </div>
  );
}
