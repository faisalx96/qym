/** Cells of a child row (a pass, the waiting passes, a loading or error placeholder) in the runs table's columns. */
import { Link } from 'react-router-dom';
import type { RunPass, RunRow } from '@/api/dashboardTypes';
import { Badge, Button, DropdownMenu, IconButton, RunStatusBadge, ScoreBar, Tooltip } from '@/ui';
import { formatDateParts, formatNumericValue } from '@/lib/format';
import { formatPercent, metricDirection } from '@/lib/metrics';
import { AnalyzeAction } from '../AnalyzeAction';
import { Mono } from '../cells';
import { useRunsCtx } from '../context';
import { smartDigits } from '../model';
import { passHref } from './links';
import { queuedText, type PassIssue, type QueuedView } from './model';
import styles from './PassCells.module.css';

const runName = (run: RunRow) => run.external_run_id || run.run_name || run.run_id.slice(0, 8);

export function IssuesCell({ issues }: { issues: PassIssue[] }) {
  if (!issues.length) return <span className={styles.none}>–</span>;
  return (
    <span className={styles.issues}>
      {issues.map((i) => (
        <span
          key={i.kind}
          className={styles.issue}
          data-tone={i.tone}
          title={i.text}
          role="img"
          aria-label={i.text}
        >
          <span aria-hidden="true">{i.glyph}</span>
          <Mono>{i.count}</Mono>
        </span>
      ))}
    </span>
  );
}

/** "Pass 2" at the run name's x, linking to the pass; only while running or partial, how far it got. */
export function PassNameCell({ run, pass, status }: { run: RunRow; pass: RunPass; status: string }) {
  const { slug, listContext } = useRunsCtx();
  const n = pass.pass_number;
  const partial = status === 'running' && pass.items_total > 0;
  return (
    <span className={styles.passName}>
      <Link
        to={passHref(slug, listContext, run.run_id, n)}
        className={styles.passLink}
        aria-label={`Pass ${n} of ${run.samples} of run ${runName(run)}`}
      >
        Pass {n}
      </Link>
      {partial ? (
        <span className={styles.muted}>
          {Math.round((pass.completed_count / pass.items_total) * 100)}% · {pass.completed_count}/
          {pass.items_total} items
        </span>
      ) : null}
    </span>
  );
}

export function QueuedNameCell({ queued }: { queued: QueuedView }) {
  return (
    <span className={styles.passName}>
      <span className={styles.muted}>{queuedText(queued)}</span>
    </span>
  );
}

export function QueuedStatus({ queued }: { queued: QueuedView }) {
  return <Badge tone={queued.notRun ? 'warning' : 'neutral'}>{queued.notRun ? 'NOT RUN' : 'QUEUED'}</Badge>;
}

export function PassStatus({ status }: { status: string }) {
  return <RunStatusBadge status={status.toUpperCase() as 'COMPLETED'} />;
}

export function PassDate({ pass }: { pass: RunPass }) {
  const date = pass.started_at ? formatDateParts(pass.started_at) : null;
  if (!date) return <span className={styles.none}>—</span>;
  return (
    <time className={styles.mono} dateTime={pass.started_at ?? undefined} title={date.full}>
      {date.date} · {date.time}
    </time>
  );
}

export function PassAnalysis({ run, pass, status }: { run: RunRow; pass: RunPass; status: string }) {
  const { slug, listContext, analyzing } = useRunsCtx();
  if (status === 'running' || status === 'pending') return null;
  return (
    <AnalyzeAction
      to={passHref(slug, listContext, run.run_id, pass.pass_number, '/analyzer')}
      causeCount={pass.analysis_cause_count ?? 0}
      analyzing={analyzing?.has(run.run_id) ?? false}
      subject={`pass ${pass.pass_number}`}
    />
  );
}

/** The pass mean of one metric, drawn like the run's cell in the same column. */
export function PassMetricCell({ run, pass, metric }: { run: RunRow; pass: RunPass; metric: string }) {
  const { metricTypes } = useRunsCtx();
  const v = pass.metric_means?.[metric];
  if (v === undefined || v === null || !run.metrics.includes(metric)) return <span className={styles.none}>—</span>;
  const type = metricTypes[metric];
  const errors = pass.metric_error_counts?.[metric] ?? 0;
  const marker = errors ? (
    <span
      className={styles.metricError}
      role="img"
      aria-label={`${errors} ${metric} scorer error${errors === 1 ? '' : 's'} in this pass`}
      title={`${errors} ${metric} scorer error${errors === 1 ? '' : 's'} in this pass`}
    >
      <span aria-hidden="true">⚠</span>
    </span>
  ) : null;
  if (type === 'numeric')
    return (
      <span className={styles.metric}>
        <Mono>{formatNumericValue(v, 2)}</Mono>
        {marker}
      </span>
    );
  return (
    <span className={styles.metric}>
      <ScoreBar
        value={v}
        type={type}
        direction={metricDirection(run.metric_specs?.[metric])}
        text={formatPercent(v, smartDigits(v, undefined))}
        error={null}
      />
      {marker}
    </span>
  );
}

export function PassActions({
  run,
  pass,
  canDelete,
  onDelete,
  onOpen,
}: {
  run: RunRow;
  pass: RunPass;
  canDelete: boolean;
  onDelete: (n: number) => void;
  onOpen: (n: number) => void;
}) {
  const n = pass.pass_number;
  return (
    <span className={styles.actions}>
      {canDelete ? (
        <Tooltip content={`Delete pass ${n}`}>
          <IconButton label={`Delete pass ${n}`} icon="trash" tone="danger" onPress={() => onDelete(n)} />
        </Tooltip>
      ) : null}
      <DropdownMenu
        label={`More actions for pass ${n} of ${runName(run)}`}
        trigger={<IconButton label={`More actions for pass ${n} of ${runName(run)}`} icon="more" />}
        items={[{ id: 'open', label: `Open pass ${n}` }]}
        onAction={() => onOpen(n)}
      />
    </span>
  );
}

export function ErrorRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <Button variant="ghost" onPress={onRetry}>
      Retry
    </Button>
  );
}
