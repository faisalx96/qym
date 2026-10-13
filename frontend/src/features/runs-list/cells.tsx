/** Cell renderers for the runs table (brief 03 §3 "Runs table"). */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button as AriaButton } from 'react-aria-components';
import type { RunRow } from '@/api/dashboardTypes';
import {
  Badge,
  DropdownMenu,
  HelpMarker,
  Icon,
  IconButton,
  RunStatusBadge,
  ScoreBar,
  Tag,
  Tooltip,
} from '@/ui';
import { formatDateParts, formatDurationMs, formatLatency, formatNumericValue } from '@/lib/format';
import { errorsLeftOut, formatPercent, metricDirection } from '@/lib/metrics';
import { projectPath, runPath } from '@/app/routes';
import { runHref } from '@/lib/runs-order';
import { textDirAttrs } from '@/lib/text';
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
  return (
    <span className={styles.model}>
      <ModelMark modelKey={key} />
      <span className={styles.modelName} title={row.model_name}>
        {plainModelName(key)}
      </span>
      {reasoning ? <Tag kind="data">reasoning</Tag> : null}
    </span>
  );
}

export function OwnerCell({ row }: { row: RunRow }) {
  const name = row.owner?.display_name || row.owner?.email || '—';
  const initials = name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={styles.owner} title={row.owner?.email}>
      <span className={styles.avatar} aria-hidden="true">
        {initials}
      </span>
      <span className={styles.ownerName}>{name}</span>
    </span>
  );
}

export function DatasetCell({ row }: { row: RunRow }) {
  return (
    <span className={styles.dataset}>
      <Tag kind="data" title={row.dataset_name}>
        {row.dataset_name}
      </Tag>
      {row.dataset_version ? <Tag kind="version">{row.dataset_version}</Tag> : null}
      {row.dataset_aliases?.map((a) => (
        <Tag key={a}>{a}</Tag>
      ))}
    </span>
  );
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

export function DateCell({ row }: { row: RunRow }) {
  const d = formatDateParts(row.timestamp);
  return (
    <time className={styles.mono} dateTime={row.timestamp} title={d.full}>
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

/** Status badge with live suffixes (pass j/k, percent, done/total). */
export function StatusCell({ row }: { row: RunRow }) {
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

/** ⚠ task errors, ⚠ metric errors, ↻ retries, ingest marker; each is a focusable button with a tooltip and opens the details dialog. */
export function Signals({ row, onDetails }: { row: RunRow; onDetails?: (row: RunRow) => void }) {
  const items = signalItems(row);
  if (!items.length) return <span className={styles.empty}>—</span>;
  return (
    <span className={styles.signals}>
      {items.map((it) => (
        <Tooltip key={it.key} content={it.text}>
          <AriaButton
            className={styles.signal}
            data-tone={it.tone}
            aria-label={it.text}
            onPress={() => onDetails?.(row)}
          >
            {it.count ? <span className={styles.mono}>{it.count}</span> : null}
            <span aria-hidden="true">{it.glyph}</span>
          </AriaButton>
        </Tooltip>
      ))}
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
      <ScoreBar
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
  const repeat = row.samples > 1;
  const name = row.external_run_id || row.run_name || row.run_id.slice(0, 8);
  return (
    <span className={styles.runName}>
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
      ) : (
        <span className={styles.chevronSpacer} aria-hidden="true" />
      )}
      <Link
        to={runHref(runPath(slug, row.run_id), listContext)}
        className={styles.runLink}
        title={row.run_id}
        onClick={() => rememberRunFile(row.run_id)}
        {...textDirAttrs(name)}
      >
        {name}
      </Link>
      {repeat ? <Tag kind="count">×{row.samples}</Tag> : null}
      {row.origin === 'official' ? (
        <Tag kind="accent" title="Run launched by an official experiment">
          Official
        </Tag>
      ) : null}
    </span>
  );
}

export function AnalysisCell({ row }: { row: RunRow }) {
  const { slug } = useRunsCtx();
  if (isActiveRun(row)) return <span className={styles.empty}>—</span>;
  const to = `${runPath(slug, row.run_id)}/analyzer`;
  if (row.analysis_cause_count > 0)
    return (
      <Link to={to} className={styles.analyze}>
        <Icon name="sparkles" size={12} /> {row.analysis_cause_count} causes
      </Link>
    );
  return (
    <Link to={to} className={styles.analyzeQuiet}>
      Analyze
    </Link>
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

export function RowActions({
  row,
  perm,
  onAction,
}: {
  row: RunRow;
  perm: RowPermissions;
  onAction: (id: string, row: RunRow) => void;
}) {
  if (perm.readOnly) return <span className={styles.empty}>—</span>;
  const isOwner = row.owner?.id === perm.meId;
  const items = [];
  if (perm.canManage) {
    if (row.status === 'SUBMITTED')
      items.push(
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject', tone: 'danger' as const },
      );
    if (row.status === 'APPROVED') items.push({ id: 'unapprove', label: 'Unapprove' });
    if (row.status === 'REJECTED') items.push({ id: 'unreject', label: 'Unreject' });
    items.push({ id: 'transfer', label: 'Transfer ownership…', separatorBefore: items.length > 0 });
  }
  const canSubmit = (isOwner || perm.canManage) && ['COMPLETED', 'FAILED', 'REJECTED'].includes(row.status);
  const canDelete = perm.isAdmin || perm.canManage || isOwner;
  const name = row.external_run_id || row.run_name;
  return (
    <span className={styles.actions}>
      {canSubmit ? (
        <IconButton
          label={`Submit ${name} for review${!isOwner && row.owner ? ` on behalf of ${row.owner.display_name || row.owner.email}` : ''}`}
          icon="check"
          tone="approve"
          onPress={() => onAction('submit', row)}
        />
      ) : null}
      {canDelete ? (
        <IconButton
          label={`Delete ${name}`}
          icon="trash"
          tone="danger"
          onPress={() => onAction('delete', row)}
        />
      ) : null}
      {items.length ? (
        <DropdownMenu
          label={`More actions for ${name}`}
          trigger={<IconButton label={`More actions for ${name}`} icon="more" />}
          items={items}
          onAction={(id) => onAction(id, row)}
        />
      ) : null}
    </span>
  );
}

export function LatencyCell({ ms }: { ms: number | null | undefined }) {
  return <span className={styles.mono}>{formatLatency(ms)}</span>;
}

export function DurationCell({ ms }: { ms: number | null | undefined }) {
  return <span className={styles.mono}>{formatDurationMs(ms)}</span>;
}

export function OriginBadge({ origin }: { origin: string }) {
  return origin === 'official' ? <Badge tone="info">official</Badge> : <Badge tone="neutral">local</Badge>;
}
