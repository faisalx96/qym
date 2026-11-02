/** Cells of a child row (a pass, the waiting passes, a loading or error placeholder) in the runs table's columns. */
import { Link, useNavigate } from 'react-router-dom';
import type { RunPass, RunRow } from '@/api/dashboardTypes';
import { ActionTile, Button, RowMenu, RunStatusBadge, ScoreValue, StatusMark, type MenuItemSpec } from '@/ui';
import { formatDateParts, formatNumericValue } from '@/lib/format';
import { formatPercent, metricDirection } from '@/lib/metrics';
import { AnalysisSpark, AnalyzeAction, analyzeState } from '../AnalyzeAction';
import { Mono, passSignalItems, SignalMarkers } from '../cells';
import { useRunsCtx } from '../context';
import { smartDigits } from '../model';
import { passHref } from './links';
import { queuedText, type QueuedView } from './model';
import styles from './PassCells.module.css';

const runName = (run: RunRow) => run.external_run_id || run.run_name || run.run_id.slice(0, 8);

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
  return (
    <StatusMark
      tone={queued.notRun ? 'warning' : 'neutral'}
      shape="ring"
      label={queued.notRun ? 'Not run' : 'Queued'}
    />
  );
}

/** The pass status, then its signals, drawn as a run's and linking to the pass's Errors section (C028, C115). */
export function PassStatus({ run, pass, status }: { run: RunRow; pass: RunPass; status: string }) {
  const { slug, listContext } = useRunsCtx();
  const items = passSignalItems(pass);
  return (
    <span className={styles.statusRow}>
      <RunStatusBadge status={status.toUpperCase() as 'COMPLETED'} />
      {items.length ? (
        <SignalMarkers
          items={items}
          href={`${passHref(slug, listContext, run.run_id, pass.pass_number)}#errors`}
        />
      ) : null}
    </span>
  );
}

export function PassDate({ pass }: { pass: RunPass }) {
  const date = pass.started_at ? formatDateParts(pass.started_at) : null;
  if (!date) return <span className={styles.none}>—</span>;
  return (
    <time className={styles.date} dateTime={pass.started_at ?? undefined} title={date.full}>
      {date.date} · {date.time}
    </time>
  );
}

/** 'N causes' or 'Analyzing' only, as on the run row (C133); starting one is in the pass's row menu. */
export function PassAnalysis({ run, pass, status }: { run: RunRow; pass: RunPass; status: string }) {
  const { slug, listContext, analyzing } = useRunsCtx();
  if (status === 'running' || status === 'pending') return null;
  if (analyzeState(pass.analysis_cause_count ?? 0, analyzing?.has(run.run_id) ?? false) === 'idle')
    return null;
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
  if (v === undefined || v === null || !run.metrics.includes(metric))
    return <span className={styles.none}>—</span>;
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
      <ScoreValue
        variant="plain"
        value={v}
        type={type}
        direction={metricDirection(run.metric_specs?.[metric])}
        text={formatPercent(v, smartDigits(v, undefined))}
      />
      {marker}
    </span>
  );
}

/** A pass row's actions in one menu behind its handle, as on the run row: auto-analysis, open the pass, delete it. */
export function PassActions({
  run,
  pass,
  status,
  canDelete,
  onDelete,
  onOpen,
}: {
  run: RunRow;
  pass: RunPass;
  status: string;
  canDelete: boolean;
  onDelete: (n: number) => void;
  onOpen: (n: number) => void;
}) {
  const { slug, listContext } = useRunsCtx();
  const navigate = useNavigate();
  const n = pass.pass_number;
  const items: MenuItemSpec[] = [];
  if (status !== 'running' && status !== 'pending')
    items.push({
      id: 'analyze',
      label: 'Open auto-analysis',
      icon: <ActionTile tone="meta" icon={<AnalysisSpark filled={false} />} />,
      tone: 'meta',
    });
  items.push({ id: 'open', label: `Open pass ${n}`, icon: <ActionTile icon="file" /> });
  if (canDelete)
    items.push({
      id: 'delete',
      label: `Delete pass ${n}`,
      icon: <ActionTile tone="danger" icon="trash" />,
      tone: 'danger',
      separatorBefore: true,
    });
  return (
    <RowMenu
      label={`Actions for pass ${n} of ${runName(run)}`}
      items={items}
      onAction={(id) => {
        if (id === 'analyze') navigate(passHref(slug, listContext, run.run_id, n, '/analyzer'));
        else if (id === 'open') onOpen(n);
        else if (id === 'delete') onDelete(n);
      }}
    />
  );
}

export function ErrorRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <Button variant="ghost" onPress={onRetry}>
      Retry
    </Button>
  );
}
