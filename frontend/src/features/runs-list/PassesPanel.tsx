/** Inline passes panel under a repeat run (J6): group-metrics strip + one row per pass. */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RunPass, RunRow } from '@/api/dashboardTypes';
import { useDeletePasses, useGroupMetrics, useRunPasses } from '@/api/dashboard';
import {
  ConfirmDialog,
  Checkbox,
  ErrorState,
  HelpMarker,
  IconButton,
  RunStatusBadge,
  ScoreValue,
  Select,
  Skeleton,
  Slider,
  Text,
  useToast,
} from '@/ui';
import { formatDateParts, formatDurationMs, formatLatency, formatNumericValue } from '@/lib/format';
import { runPath } from '@/app/routes';
import { runHref } from '@/lib/runs-order';
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
  const { metricTypes, slug: ctxSlug, listContext } = useRunsCtx();
  useEffect(() => {
    onNotePassRevision?.(row.run_id, row.pass_revision ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callback is stable per selection; revision is what matters
  }, [row.run_id, row.pass_revision]);
  const live = isActiveRun(row);
  const passesQ = useRunPasses(row.run_id, { refetchInterval: live ? 15_000 : false });
  const scoreMetrics = (passesQ.data?.metrics ?? row.metrics).filter((m) => metricTypes[m] !== 'numeric');
  const initialMetric = defaultMetricName(scoreMetrics, row.metric_specs) ?? scoreMetrics[0] ?? null;
  const [metric, setMetric] = useState<string | null>(null);
  const activeMetric = metric ?? initialMetric;
  const rule = activeMetric ? groupStatRule([toChartRun(row)], activeMetric) : null;
  const [threshold, setThreshold] = useState<number | null>(null);
  const activeThreshold =
    threshold ??
    rule?.threshold ??
    defaultPassThreshold(
      activeMetric ? row.metric_specs[activeMetric] : undefined,
      activeMetric ? metricDirection(row.metric_specs[activeMetric]) : null,
    );
  const groupQ = useGroupMetrics(row.run_id, activeMetric, activeThreshold, {
    enabled: Boolean(activeMetric) && row.samples > 1,
  });
  const del = useDeletePasses(slug);
  const toast = useToast();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [draft, setDraft] = useState<number | null>(null);

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
  const metrics = data.metrics;
  const g = groupQ.data?.group ?? null;
  const dir = metricDirection(row.metric_specs[activeMetric ?? '']);
  const canDeletePass = canDelete && !['RUNNING', 'PENDING', 'SUBMITTED', 'APPROVED'].includes(row.status);
  const name = row.external_run_id || row.run_name;
  const view = passRowsView(data.passes, data.samples || row.samples, row.status);
  const passHref = (n: number, sub = '') => {
    const base = runHref(`${runPath(ctxSlug, row.run_id)}${sub}`, listContext);
    return `${base}${base.includes('?') ? '&' : '?'}pass=${n}`;
  };
  const cmp = dir === 'minimize' ? '≤' : '≥';
  const thrPct = Math.round((draft ?? activeThreshold) * 100);
  const colSpan = 7 + metrics.length + (selectMode ? 1 : 0);

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
            Group metrics are not available:{' '}
            {groupQ.error instanceof Error ? groupQ.error.message : 'request failed'}
          </Text>
        ) : (
          <dl className={styles.stats} aria-busy={groupQ.isFetching}>
            <Stat
              label={`Pass@${g?.k ?? 'k'}`}
              help="Share of items solved by at least one of the k passes at the threshold."
              value={g?.pass_at_k}
              dir={dir}
            />
            <Stat
              label={`Pass^${g?.k ?? 'k'}`}
              help="Share of items solved by every pass."
              value={g?.pass_hat_k}
              dir={dir}
            />
            <Stat
              label={`Avg@${g?.k ?? 'k'}`}
              help={`Mean score across all items and all ${g?.k ?? row.samples} passes.`}
              value={g?.avg_at_k}
              dir={dir}
            />
            <Stat
              label="Consistency"
              help="Agreement between passes on the same item."
              value={g?.consistency}
              dir={dir}
            />
            <Stat
              label="Reliability"
              help="Pass^k over Pass@k: how much of the ceiling is reached every time."
              value={g?.reliability}
              dir={dir}
            />
            <div>
              <dt>Avg latency</dt>
              <dd>
                <Mono>{formatLatency(row.avg_latency_ms)}</Mono>
              </dd>
            </div>
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
          {dir ? (
            <>
              <Text
                variant="sm"
                tone="muted"
                as="span"
                title={
                  dir === 'minimize'
                    ? 'An item passes when its score is at or below this threshold.'
                    : 'An item passes when its score meets or exceeds this threshold.'
                }
              >
                Pass if {cmp} {thrPct}%
              </Text>
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
            </>
          ) : (
            <Text variant="sm" tone="muted" as="span">
              No direction declared
            </Text>
          )}
        </div>
      </div>
      <table className={styles.passes} aria-label={`${name} passes`}>
        <thead>
          <tr>
            {selectMode ? <th scope="col" className={styles.selectCol} /> : null}
            <th scope="col">Pass</th>
            <th scope="col">Status</th>
            <th scope="col">Date</th>
            <th scope="col">Analysis</th>
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
          {view.rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className={styles.empty}>
                No pass results are available yet.
              </td>
            </tr>
          ) : null}
          {view.rows.map((r) => {
            if (r.kind === 'queued') {
              const label = r.first === r.last ? `Pass ${r.first}` : `Passes ${r.first}–${r.last}`;
              return (
                <tr key={`queued-${r.first}`} data-queued="">
                  {selectMode ? <td className={styles.selectCol} /> : null}
                  <td>
                    <Mono>{label}</Mono>{' '}
                    <Text variant="sm" tone="muted" as="span">
                      {r.count} {r.notRun ? 'not run' : 'waiting to start'}
                    </Text>
                  </td>
                  <td>
                    <RunStatusBadge
                      status={r.notRun ? 'STOPPED' : 'PENDING'}
                      label={r.notRun ? 'NOT RUN' : 'QUEUED'}
                    />
                  </td>
                  <td colSpan={colSpan - (selectMode ? 3 : 2)} />
                </tr>
              );
            }
            const p = r.pass;
            const ref = passRef(row.run_id, p.pass_number);
            const date = p.started_at ? formatDateParts(p.started_at) : null;
            const open = () => navigate(passHref(p.pass_number));
            const taskErr = p.task_error_count ?? 0;
            const metricErr = p.metric_error_count ?? 0;
            const retries = p.retry_count ?? 0;
            const anyErr = p.error_count ?? 0;
            const progress =
              r.status === 'running' && p.items_total > 0
                ? ` ${Math.round((p.completed_count / p.items_total) * 100)}% · ${p.completed_count}/${p.items_total}`
                : '';
            return (
              <tr
                key={p.pass_number}
                data-selected={selected.has(ref) ? '' : undefined}
                data-pass-row={p.pass_number}
                className={styles.openable}
                title={`Open pass ${p.pass_number}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a, button, input, label, [role="button"]')) return;
                  open();
                }}
              >
                {selectMode ? (
                  <td className={styles.selectCol}>
                    <Checkbox
                      aria-label={`Select pass ${p.pass_number} of ${name}`}
                      isSelected={selected.has(ref)}
                      onChange={() => onToggle(ref)}
                    />
                  </td>
                ) : null}
                <td>
                  <Link
                    to={passHref(p.pass_number)}
                    className={styles.passLink}
                    aria-label={`Open pass ${p.pass_number}`}
                  >
                    #{p.pass_number}
                  </Link>
                </td>
                <td>
                  <span className={styles.statusCell}>
                    <RunStatusBadge status={r.status.toUpperCase() as 'COMPLETED'} />
                    {progress ? <span className={styles.mono}>{progress}</span> : null}
                    {taskErr || (anyErr && !metricErr) ? (
                      <span
                        className={styles.chip}
                        data-tone="error"
                        title={`${taskErr || anyErr} task error${(taskErr || anyErr) > 1 ? 's' : ''} in this pass`}
                      >
                        ⚠ {taskErr || anyErr}
                      </span>
                    ) : null}
                    {metricErr ? (
                      <span
                        className={styles.chip}
                        data-tone="metric"
                        title={`${metricErr} metric error${metricErr > 1 ? 's' : ''} in this pass`}
                      >
                        ⚠ {metricErr}
                      </span>
                    ) : null}
                    {retries ? (
                      <span
                        className={styles.chip}
                        data-tone="info"
                        title={`${retries} retr${retries === 1 ? 'y' : 'ies'} in this pass`}
                      >
                        {retries}↻
                      </span>
                    ) : null}
                  </span>
                </td>
                <td>
                  {date ? (
                    <time className={styles.mono} dateTime={p.started_at ?? undefined} title={date.full}>
                      {date.date} · {date.time}
                    </time>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  {r.status === 'running' || r.status === 'pending' ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    <Link
                      to={passHref(p.pass_number, '/analyzer')}
                      className={p.analysis_cause_count ? styles.analyze : styles.analyzeQuiet}
                    >
                      {p.analysis_cause_count ? `${p.analysis_cause_count} causes` : 'Analyze'}
                    </Link>
                  )}
                </td>
                {metrics.map((m) => (
                  <td key={m} data-align="end">
                    {metricTypes[m] === 'numeric' ? (
                      <Mono>{formatNumericValue(p.metric_means[m], 2)}</Mono>
                    ) : (
                      <ScoreValue
                        value={p.metric_means[m]}
                        type={metricTypes[m]}
                        direction={metricDirection(row.metric_specs[m])}
                        digits={1}
                      />
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
                  {canDeletePass ? (
                    <IconButton
                      label={`Delete pass ${p.pass_number} of ${name}`}
                      icon="trash"
                      tone="danger"
                      onPress={() => setDeleting(p.pass_number)}
                    />
                  ) : null}
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

type PassView = { kind: 'pass'; pass: RunPass; status: string };
type QueuedView = { kind: 'queued'; first: number; last: number; count: number; notRun: boolean };

/** One row per started pass; waiting passes collapse into one row ("not run" once the run ended without them). */
export function passRowsView(
  passes: RunPass[],
  samples: number,
  runStatus: string,
): { rows: Array<PassView | QueuedView> } {
  const terminal = { STOPPED: 'stopped', FAILED: 'failed', COMPLETED: 'completed' }[runStatus.toUpperCase()];
  const notRun = ['STOPPED', 'FAILED', 'CANCELED', 'CANCELLED'].includes(runStatus.toUpperCase());
  const rows: Array<PassView | QueuedView> = [];
  const have = new Set(passes.map((p) => p.pass_number));
  const queued: number[] = [];
  for (const p of passes) {
    const raw = String(p.status || 'unknown').toLowerCase();
    if (raw === 'pending') queued.push(p.pass_number);
    else rows.push({ kind: 'pass', pass: p, status: raw === 'running' && terminal ? terminal : raw });
  }
  for (let n = 1; n <= samples; n++) if (!have.has(n)) queued.push(n);
  if (queued.length) {
    queued.sort((a, b) => a - b);
    rows.push({
      kind: 'queued',
      first: queued[0]!,
      last: queued[queued.length - 1]!,
      count: queued.length,
      notRun,
    });
  }
  return { rows };
}

function Stat({
  label,
  help,
  value,
  dir,
}: {
  label: string;
  help: string;
  value: number | null | undefined;
  dir: 'maximize' | 'minimize' | null;
}) {
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
