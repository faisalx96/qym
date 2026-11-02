/** Cell renderers for the runs table (brief 03 §3 "Runs table"). */
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button as AriaButton } from 'react-aria-components';
import type { RunPass, RunRow } from '@/api/dashboardTypes';
import {
  ActionTile,
  HelpMarker,
  Icon,
  IconButton,
  RowMenu,
  RunStatusBadge,
  ScoreValue,
  DatasetTag,
  ModelTag,
  RunName,
  Tag,
  Tooltip,
  UserName,
  useRowArmed,
  type MenuItemSpec,
} from '@/ui';
import { formatDateParts, formatDurationMs, formatLatency, formatNumericValue } from '@/lib/format';
import { errorsLeftOut, formatPercent, metricDirection } from '@/lib/metrics';
import { useRunIntent } from '@/app/prefetch';
import { projectPath, runPath } from '@/app/routes';
import { runHref } from '@/lib/runs-order';
import { textDirAttrs } from '@/lib/text';
import { DatasetCountTag } from '@/features/run-detail/components/DatasetChip';
import { AnalysisSpark, AnalyzeAction, analyzeState } from './AnalyzeAction';
import { useRunsCtx } from './context';
import { modelKeyOf, modelShape, modelSlot, plainModelName, smartDigits, STATUS_LABEL } from './model';
import { isActiveRun, isStoppingRun } from './polling';
import { rememberRunFile } from './selection';
import styles from './cells.module.css';

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={[styles.mono, className].filter(Boolean).join(' ')}>{children}</span>;
}

export function ModelMark({ modelKey, size = 'sm' }: { modelKey: string; size?: 'sm' | 'md' }) {
  const { modelIndex } = useRunsCtx();
  return (
    <span
      className={styles.modelMark}
      data-series={modelSlot(modelKey, modelIndex)}
      data-shape={modelShape(modelKey, modelIndex)}
      data-size={size}
      aria-hidden="true"
    />
  );
}

export function ModelCell({ row }: { row: RunRow }) {
  const key = modelKeyOf(row);
  const reasoning = key.endsWith('|||reasoning');
  const { modelIndex } = useRunsCtx();
  return (
    <ModelTag
      name={plainModelName(key)}
      title={row.model_name}
      series={modelSlot(key, modelIndex) as 1}
      mark={<ModelMark modelKey={key} />}
      reasoning={reasoning}
    />
  );
}

/** The run owner: the shared person recipe (initials disc in the person's colour, then the name). */
export function OwnerCell({ row }: { row: RunRow }) {
  return <UserName id={row.owner?.id} name={row.owner?.display_name} email={row.owner?.email} />;
}

export function DatasetCell({ row }: { row: RunRow }) {
  // A run over several dataset versions: a count tag (the full list is its title), never an ellipsis.
  if ((row.dataset_count ?? 1) > 1)
    return (
      <DatasetCountTag
        count={row.dataset_count ?? 0}
        title={(row.datasets ?? []).map((d) => `${d.dataset}${d.version ? ` ${d.version}` : ''}`).join(' · ')}
        testId="dataset-count-tag"
      />
    );
  return <DatasetTag name={row.dataset_name} version={row.dataset_version} aliases={row.dataset_aliases} />;
}

export function VersionCell({ row }: { row: RunRow }) {
  if (!row.git_commit && !row.git_branch) return <span className={styles.empty}>—</span>;
  const text = [row.git_branch, row.git_commit].filter(Boolean).join('/');
  return (
    <Tag kind="version" title={text}>
      {text}
    </Tag>
  );
}

/** Sans with tabular figures (round 10, as the first qym list): the mono face spread the date and time apart. */
export function DateCell({ row }: { row: RunRow }) {
  const d = formatDateParts(row.timestamp);
  return (
    <time className={styles.date} dateTime={row.timestamp} title={d.full}>
      {d.date} · {d.time}
    </time>
  );
}

function statusTitle(row: RunRow, stopping: boolean): string {
  if (stopping) return 'Stop requested: waiting for the evaluation service to confirm';
  const a = row.approval;
  if (a?.decision_by && a.decision === row.status) {
    const by = a.decision_by.display_name || a.decision_by.email;
    return `${row.status} by ${by}${a.comment ? `\n"${a.comment}"` : ''}`;
  }
  return row.status;
}

/** Status badge with live suffixes (pass j/k, percent, done/total), then the run's signals (C028). */
export function StatusCell({ row }: { row: RunRow }) {
  const items = signalItems(row);
  const { slug, listContext } = useRunsCtx();
  return (
    <span className={styles.statusRow}>
      <StatusBadge row={row} />
      {items.length ? (
        <SignalMarkers items={items} href={`${runHref(runPath(slug, row.run_id), listContext)}#errors`} />
      ) : null}
    </span>
  );
}

function StatusBadge({ row }: { row: RunRow }) {
  const stopping = isStoppingRun(row);
  const status = stopping ? 'STOPPING' : row.status;
  const live = isActiveRun(row);
  const pct = Math.round((row.progress_pct ?? 0) * 100);
  const pass = row.samples > 1 && live ? Math.min((row.last_completed_pass ?? 0) + 1, row.samples) : null;
  return (
    <span className={styles.status} title={statusTitle(row, stopping)}>
      <RunStatusBadge status={status} label={STATUS_LABEL[status] ?? status} />
      {live ? (
        <span className={styles.progress} aria-label={`Progress ${pct} percent`}>
          {pass ? (
            <span className={styles.mono}>
              pass {pass}/{row.samples}
            </span>
          ) : null}
          {row.samples <= 1 ? (
            <span className={styles.progressTrack} aria-hidden="true">
              <span className={styles.progressFill} style={{ width: `${pct}%` }} />
            </span>
          ) : null}
          {row.samples <= 1 ? (
            <span className={styles.mono}>
              {row.progress_completed}/{row.progress_total ?? '?'}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export interface SignalItem {
  key: 'task' | 'metric' | 'retry' | 'ingest';
  glyph: string;
  tone: string;
  count: number;
  text: string;
}

export function signalItems(row: RunRow): SignalItem[] {
  const live = isActiveRun(row);
  const known = row.task_error_count != null && row.metric_error_count != null;
  const task = known
    ? (row.task_error_count ?? 0)
    : Number(row.execution_error_count ?? row.error_count ?? 0);
  const metric = row.metric_error_count ?? 0;
  const retries = row.total_retries ?? 0;
  const scope = row.samples > 1 ? ' across all passes' : ' across all items';
  const items: SignalItem[] = [];
  if (task)
    items.push({
      key: 'task',
      glyph: '⚠',
      tone: 'error',
      count: task,
      text: `${task} task error${task > 1 ? 's' : ''}${scope}${known ? '' : ' (breakdown is updating)'}`,
    });
  if (metric)
    items.push({
      key: 'metric',
      glyph: '⚠',
      tone: 'metric',
      count: metric,
      text: `${metric} metric error${metric > 1 ? 's' : ''}${scope}`,
    });
  if (retries && !live)
    items.push({
      key: 'retry',
      glyph: '↻',
      tone: 'info',
      count: retries,
      text: `${retries} total retr${retries > 1 ? 'ies' : 'y'}${scope}`,
    });
  const inc = row.ingest_incomplete as unknown;
  if (inc && typeof inc === 'object') {
    const reason = (inc as { reason?: string }).reason;
    items.push({
      key: 'ingest',
      glyph: '◌',
      tone: 'warning',
      count: 0,
      text: `Incomplete data. ${reason || 'Not all of this run reached the platform.'}`,
    });
  }
  return items;
}

/** The signals of a pass, drawn by the same markers as a run's (one Signals component for run and pass rows, C115). */
export function passSignalItems(
  p: Pick<RunPass, 'task_error_count' | 'metric_error_count' | 'retry_count' | 'error_count'>,
): SignalItem[] {
  const metric = p.metric_error_count ?? 0;
  const task = p.task_error_count || (p.error_count && !metric ? p.error_count : 0);
  const retries = p.retry_count ?? 0;
  const items: SignalItem[] = [];
  if (task)
    items.push({
      key: 'task',
      glyph: '⚠',
      tone: 'error',
      count: task,
      text: `${task} task error${task > 1 ? 's' : ''} in this pass`,
    });
  if (metric)
    items.push({
      key: 'metric',
      glyph: '⚠',
      tone: 'metric',
      count: metric,
      text: `${metric} metric error${metric > 1 ? 's' : ''} in this pass`,
    });
  if (retries)
    items.push({
      key: 'retry',
      glyph: '↻',
      tone: 'info',
      count: retries,
      text: `${retries} retr${retries === 1 ? 'y' : 'ies'} in this pass`,
    });
  return items;
}

/**
 * ⚠ task errors (red), ⚠ metric errors (yellow), ↻ retries (blue), ◌ incomplete data (amber), each with its count and
 * today's colour, no threshold (owner, Nov 1). Each marker links to the run's (or pass's) Errors section, with no
 * dialog (C115).
 */
export function SignalMarkers({ items, href }: { items: SignalItem[]; href: string }) {
  // Lean rows (C020): the tooltips mount when the row is first hovered or focused; the links are there from the start.
  const { armed, ref } = useRowArmed<HTMLSpanElement>();
  return (
    <span className={styles.signals} ref={ref}>
      {items.map((it) => {
        const link = (
          <Link className={styles.signal} data-tone={it.tone} aria-label={it.text} to={href}>
            {it.count ? <span className={styles.mono}>{it.count}</span> : null}
            <span aria-hidden="true">{it.glyph}</span>
          </Link>
        );
        return armed ? (
          <Tooltip key={it.key} content={it.text}>
            {link}
          </Tooltip>
        ) : (
          <Fragment key={it.key}>{link}</Fragment>
        );
      })}
    </span>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The per-metric error marker: how many errors this metric's mean left out (lower is better) or counted as 0. */
export function metricErrorLabel(row: RunRow, metric: string, leftOut: boolean, scope: string): string {
  const scorer = row.metric_error_counts?.[metric] ?? 0;
  const task = row.task_error_count ?? 0;
  if (leftOut) {
    return [
      scorer
        ? `${plural(scorer, 'scorer error')}${scope} ${scorer === 1 ? 'is' : 'are'} not counted in the ${metric} mean (lower is better).`
        : '',
      task && scorer
        ? `The run also has ${plural(task, 'task error')}${scope}, left out too unless a reviewer scored them.`
        : '',
      task && !scorer
        ? `The run has ${plural(task, 'task error')}${scope}. Lower is better for ${metric}, so they are left out of its mean unless a reviewer scored them.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return `${plural(scorer, `${metric} scorer error`)}${scope}, counted as 0%`;
}

export function MetricCell({
  row,
  metric,
  onErrorDetails,
}: {
  row: RunRow;
  metric: string;
  onErrorDetails?: (row: RunRow, metric: string) => void;
}) {
  const { metricTypes } = useRunsCtx();
  const v = row.metric_averages?.[metric];
  if (v === undefined || !row.metrics.includes(metric)) return <span className={styles.empty}>—</span>;
  const type = metricTypes[metric];
  const dir = metricDirection(row.metric_specs?.[metric]);
  const leftOut = errorsLeftOut(dir);
  const metricErr = row.metric_error_counts?.[metric] ?? 0;
  const taskErr = row.task_error_count ?? 0;
  const error = metricErr ? 'metric' : taskErr && dir === 'minimize' ? 'task' : null;
  const scope = row.samples > 1 ? ' across all passes' : '';
  const marked = leftOut ? metricErr + taskErr > 0 : metricErr > 0;
  const label = marked ? metricErrorLabel(row, metric, leftOut, scope) : '';
  const marker = marked ? (
    <AriaButton
      className={styles.metricError}
      data-tone={leftOut || !metricErr ? 'error' : 'metric'}
      aria-label={label}
      onPress={() => onErrorDetails?.(row, metric)}
    >
      <Tooltip content={label}>
        <span aria-hidden="true">⚠</span>
      </Tooltip>
    </AriaButton>
  ) : null;
  const lowSamples = row.report_k != null && row.samples < 2 * row.report_k;
  const noise = lowSamples ? (
    <HelpMarker label="high-noise estimate">
      {`pass@${row.report_k} estimated from only ${row.samples} passes is high-noise; ${2 * (row.report_k ?? 0)}+ recommended.`}
    </HelpMarker>
  ) : null;
  if (type === 'numeric') {
    return (
      <span className={styles.metric}>
        <span
          className={[styles.numeric, styles.mono].join(' ')}
          title={`${metric}: raw value${dir === 'minimize' ? ', lower is better' : ''}`}
        >
          {formatNumericValue(v, 2)}
        </span>
        {marker}
      </span>
    );
  }
  const scored = row.metric_scored_averages?.[metric];
  return (
    <span
      className={styles.metric}
      title={
        scored !== undefined && scored !== v
          ? `Mean of scored items: ${(scored * 100).toFixed(1)}%`
          : undefined
      }
    >
      <ScoreValue
        variant="plain"
        value={v}
        type={type}
        direction={dir}
        text={formatPercent(v, smartDigits(v, row.metric_neighbor_values?.[metric]))}
        error={error}
      />
      {marker}
      {noise}
    </span>
  );
}

/**
 * A run of a latency-sensitive experiment (QA3-25): a 20 x 20 clock tag, so it adds no width to the
 * 260 px Run column. The meaning is the accessible name and the title, as for `Official`.
 */
export function RunLatencyTag() {
  return (
    <Tag
      tone="info"
      className={styles.runLatencyTag}
      role="img"
      aria-label="Latency-sensitive experiment"
      title="Latency-sensitive experiment"
      data-testid="run-latency-tag"
    >
      <Icon name="clock" size={12} />
    </Tag>
  );
}

export function RunNameCell({
  row,
  expanded,
  onToggleExpand,
}: {
  row: RunRow;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const { slug, listContext } = useRunsCtx();
  const intent = useRunIntent(row.run_id);
  const repeat = row.samples > 1;
  const name = row.external_run_id || row.run_name || row.run_id.slice(0, 8);
  // Absent (a run not republished yet) reads as false.
  const latency = row.experiment?.latency_sensitive === true;
  return (
    <span className={styles.runName} data-testid="run-cell">
      {repeat ? (
        <IconButton
          label={
            expanded ? `Collapse ${row.samples} passes of ${name}` : `Expand ${row.samples} passes of ${name}`
          }
          icon={expanded ? 'chevron-down' : 'chevron-right'}
          onPress={onToggleExpand}
          aria-expanded={expanded}
          className={styles.chevron}
        />
      ) : latency ? (
        <span className={styles.leadSlot}>
          <RunLatencyTag />
        </span>
      ) : (
        <span className={styles.chevronSpacer} aria-hidden="true" />
      )}
      <RunName
        to={runHref(runPath(slug, row.run_id), listContext)}
        name={name}
        runId={row.run_id}
        onClick={() => rememberRunFile(row.run_id)}
        {...intent}
        {...textDirAttrs(name)}
      />
      {repeat ? <Tag kind="count">×{row.samples}</Tag> : null}
      {row.origin === 'official' ? (
        <Tag kind="accent" title="Run launched by an official experiment">
          Official
        </Tag>
      ) : null}
      {latency && repeat ? <RunLatencyTag /> : null}
    </span>
  );
}

/** 'N causes' or 'Analyzing' only (C133): starting an analysis is the first item of the row menu. */
export function AnalysisCell({ row }: { row: RunRow }) {
  const { slug, analyzing } = useRunsCtx();
  const state = analyzeState(row.analysis_cause_count ?? 0, analyzing?.has(row.run_id) ?? false);
  if (isActiveRun(row) || state === 'idle') return <span className={styles.empty}>—</span>;
  return (
    <AnalyzeAction
      to={`${runPath(slug, row.run_id)}/analyzer`}
      causeCount={row.analysis_cause_count}
      analyzing={analyzing?.has(row.run_id) ?? false}
      subject={row.external_run_id || row.run_name}
    />
  );
}

export function ExperimentCell({ row }: { row: RunRow }) {
  const { slug } = useRunsCtx();
  if (!row.experiment) return <span className={styles.empty}>—</span>;
  return (
    <Link
      to={projectPath(slug, `experiments/${row.experiment.id}`)}
      className={styles.runLink}
      title={row.experiment.name}
    >
      {row.experiment.name}
    </Link>
  );
}

export interface RowPermissions {
  readOnly: boolean;
  canManage: boolean;
  isAdmin: boolean;
  meId: string;
}

/**
 * Every action of a run row, in one menu behind the row's handle (owner decision, Nov 1). Each item carries its tile, so
 * the menu keeps the row's iconography: Open auto-analysis (purple sparkle) first, Submit (send), the review items
 * (Approve, Reject, Unapprove, Unreject, Transfer ownership on the review menu's file tile), then Delete (red trash).
 */
export function rowMenuItems(row: RunRow, perm: RowPermissions): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  // a live run has nothing to analyse yet
  if (!isActiveRun(row))
    items.push({
      id: 'analyze',
      label: 'Open auto-analysis',
      icon: <ActionTile tone="meta" icon={<AnalysisSpark filled={false} />} />,
      tone: 'meta',
    });
  if (perm.readOnly) return items;
  const isOwner = row.owner?.id === perm.meId;
  if ((isOwner || perm.canManage) && ['COMPLETED', 'FAILED', 'REJECTED'].includes(row.status))
    items.push({
      id: 'submit',
      label: 'Submit',
      icon: <ActionTile icon="send" />,
      description:
        !isOwner && row.owner ? `On behalf of ${row.owner.display_name || row.owner.email}` : undefined,
    });
  if (perm.canManage) {
    if (row.status === 'SUBMITTED')
      items.push(
        { id: 'approve', label: 'Approve', icon: <ActionTile icon="check" /> },
        { id: 'reject', label: 'Reject', icon: <ActionTile tone="danger" icon="close" />, tone: 'danger' },
      );
    if (row.status === 'APPROVED')
      items.push({ id: 'unapprove', label: 'Unapprove', icon: <ActionTile icon="retry" /> });
    if (row.status === 'REJECTED')
      items.push({ id: 'unreject', label: 'Unreject', icon: <ActionTile icon="retry" /> });
    items.push({ id: 'transfer', label: 'Transfer ownership', icon: <ActionTile icon="file" /> });
  }
  if (perm.isAdmin || perm.canManage || isOwner)
    items.push({
      id: 'delete',
      label: 'Delete',
      icon: <ActionTile tone="danger" icon="trash" />,
      tone: 'danger',
      separatorBefore: items.length > 0,
    });
  return items;
}

export function RowActions({
  row,
  perm,
  onAction,
}: {
  row: RunRow;
  perm: RowPermissions;
  onAction: (id: string, row: RunRow) => void;
}) {
  const name = row.external_run_id || row.run_name || row.run_id.slice(0, 8);
  return (
    <RowMenu
      label={`Actions for ${name}`}
      items={rowMenuItems(row, perm)}
      onAction={(id) => onAction(id, row)}
    />
  );
}

export function LatencyCell({ ms }: { ms: number | null | undefined }) {
  return <span className={styles.mono}>{formatLatency(ms)}</span>;
}

export function DurationCell({ ms }: { ms: number | null | undefined }) {
  return <span className={styles.mono}>{formatDurationMs(ms)}</span>;
}

export function OriginBadge({ origin }: { origin: string }) {
  // a category, not a status: a Tag (official in the info tone)
  return origin === 'official' ? (
    <Tag kind="origin" tone="info">
      official
    </Tag>
  ) : (
    <Tag kind="origin">local</Tag>
  );
}
