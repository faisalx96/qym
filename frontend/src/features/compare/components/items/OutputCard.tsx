/** One run's (or pass') answer to an item: verdict, latency, trace, output, metric chips and root-cause issues. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { runPath } from '@/app/routes';
import { formatLatency, isInternalMetaKey, metricMetaDisplayKey } from '@/lib/metrics';
import {
  Button,
  CopyButton,
  Icon,
  IconButton,
  JsonPreview,
  LinkButton,
  ScoreValue,
  Tag,
  TextBlock,
  Card,
} from '@/ui';
import type { Row, RootCauseIssue } from '@/features/run-detail/types';
import { bodyText } from '@/features/run-detail/lib/itemText';
import {
  getRowRootCauseAnalyses,
  itemMetadataDisplayValue,
  rootCauseIssues,
} from '@/features/run-detail/lib/rowMeta';
import { buildLangfuseTraceUrl } from '@/features/run-detail/lib/traceTree';
import { letterOf, useCompare } from '../../CompareContext';
import { useRowPatch } from '../../hooks/useRowPatch';
import { metricCellFor, pillState, runReadOnly, runScoresLocked } from '../../lib/rowCells';
import type { CompareRun } from '../../lib/model';
import { CompareScoreEditor } from '../rd/CompareScoreEditor';
import { IssueDialog } from '../rd/IssueDialog';
import { RunDot } from '../common';
import { useItemsUi } from './ItemsUi';
import styles from './OutputCard.module.css';

export function Collapsible({ text, lines = 12 }: { text: string; lines?: number }) {
  const { textMode } = useItemsUi();
  const [open, setOpen] = useState(false);
  const long = text.length > 600 || text.split('\n').length > lines;
  return (
    <div>
      <div
        className={long && !open ? styles.clamped : undefined}
        style={long && !open ? ({ ['--lines' as string]: lines } as React.CSSProperties) : undefined}
      >
        <TextBlock text={text} mode={textMode} />
      </div>
      {long ? (
        <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

function MetaList({ meta, hidden }: { meta: Record<string, unknown>; hidden: Set<string> }) {
  const entries = Object.entries(meta).filter(
    ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
  );
  if (!entries.length) return <div className={styles.muted}>No judge metadata recorded.</div>;
  return (
    <dl className={styles.metaList}>
      {entries.map(([k, v]) => (
        <div key={k} className={styles.metaRow}>
          <dt>{metricMetaDisplayKey(k, meta)}</dt>
          <dd>
            {v !== null && typeof v === 'object' ? (
              <JsonPreview value={v} title={k} compact />
            ) : (
              itemMetadataDisplayValue(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MetricChips({ run, row, itemId }: { run: CompareRun; row: Row; itemId: string }) {
  const { model, c } = useCompare();
  const ui = useItemsUi();
  const patch = useRowPatch();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit =
    !runReadOnly(run) &&
    !runScoresLocked(run) &&
    !run.run.items_restricted &&
    String(row.status) !== 'not_received';
  void c;
  return (
    <div className={styles.metrics} role="list" aria-label="Metrics">
      {model.metrics.map((metric) => {
        const idx = run.metricIndex[metric];
        if (idx === undefined) return null;
        const cell = metricCellFor(model, run, row, metric);
        const meta = (row.metric_meta?.[metric] ?? {}) as Record<string, unknown>;
        const isEditing = editing === metric;
        return (
          <div key={metric} role="listitem" className={styles.chip} data-metric={metric}>
            <div className={styles.chipHead}>
              <button
                type="button"
                className={styles.caret}
                aria-expanded={open === metric}
                aria-label={`${open === metric ? 'Hide' : 'Show'} ${metric} details`}
                onClick={() => setOpen(open === metric ? null : metric)}
              >
                <Icon name={open === metric ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
              <span className={styles.metricName}>{metric}</span>
              <ScoreValue
                value={cell.value}
                type={cell.type}
                direction={cell.direction}
                error={cell.error}
                text={cell.text}
              />
              {cell.edited ? (
                <Tag
                  kind="accent"
                  tone="warning"
                  title={`Edited${meta.original_score !== undefined ? `; scorer value ${String(meta.original_score)}` : ''}`}
                >
                  edited
                </Tag>
              ) : null}
              {canEdit ? (
                <IconButton
                  label={`Edit ${metric} score of ${run.label}`}
                  icon="edit"
                  onPress={() => setEditing(isEditing ? null : metric)}
                />
              ) : null}
            </div>
            {isEditing ? (
              <CompareScoreEditor
                runId={run.base}
                filePath={run.base}
                row={row}
                metric={metric}
                spec={model.specs[metric]}
                initial={
                  cell.value === null
                    ? ''
                    : cell.type === 'score'
                      ? `${Math.round(cell.value * 1000) / 10}%`
                      : String(cell.value)
                }
                passNumber={run.pass}
                passVersion={Number(run.run.metadata?.pass_revision ?? 0)}
                edited={cell.edited}
                onDone={(updated) => {
                  setEditing(null);
                  patch(run.base, updated);
                }}
              />
            ) : null}
            {open === metric ? <MetaList meta={meta} hidden={ui.hiddenFields} /> : null}
          </div>
        );
      })}
      <span className={styles.srOnly}>{itemId}</span>
    </div>
  );
}

function Issues({ run, row, metricIdsOnly }: { run: CompareRun; row: Row; metricIdsOnly?: undefined }) {
  const { model, slug } = useCompare();
  const patch = useRowPatch();
  const [dialog, setDialog] = useState<{ metric: string; issue: RootCauseIssue | null } | null>(null);
  void metricIdsOnly;
  const canEdit = !runReadOnly(run) && !runScoresLocked(run) && !run.run.items_restricted;
  const analyses = getRowRootCauseAnalyses(row, 'all', false);
  const byMetric = model.metrics
    .map((metric) => ({
      metric,
      issues: analyses.filter((a) => a.metric_name === metric).flatMap((a) => rootCauseIssues(a, false)),
    }))
    .filter((x) => x.issues.length);
  const { metric: pageMetric } = useCompare();
  const own = model.metrics.filter((m) => run.metricIndex[m] !== undefined);
  // New issues target the metric the page is on, not whichever the run lists first.
  const first = own.includes(pageMetric) ? pageMetric : own[0];
  return (
    <section className={styles.issues} aria-label={`Root-cause issues for ${run.label}`}>
      <header className={styles.issuesHead}>
        <span className={styles.label}>Root-cause issues</span>
        {canEdit && first ? (
          <Button size="sm" variant="neutral" onPress={() => setDialog({ metric: first, issue: null })}>
            Add issue
          </Button>
        ) : null}
      </header>
      {byMetric.length === 0 ? <p className={styles.muted}>No root-cause issues assigned.</p> : null}
      {byMetric.map(({ metric, issues }) => (
        <ul key={metric} className={styles.issueList}>
          {issues.map((issue, i) => (
            <li key={issue.issue_id ?? i} className={styles.issue}>
              <Tag kind="accent">{issue.category || 'Uncategorized'}</Tag>
              {issue.subcategory ? <span className={styles.muted}>{issue.subcategory}</span> : null}
              <span className={styles.muted}>{metric}</span>
              {issue.finding ? <span className={styles.finding}>{issue.finding}</span> : null}
              {issue.category_reason ? (
                <span className={styles.finding} data-field="reason">
                  <span className={styles.label}>Why: </span>
                  {issue.category_reason}
                </span>
              ) : null}
              {issue.solution ? (
                <span className={styles.finding} data-field="solution">
                  <span className={styles.label}>Solution: </span>
                  {issue.solution}
                  {issue.solution_note ? <span className={styles.muted}> {issue.solution_note}</span> : null}
                </span>
              ) : null}
              {canEdit ? (
                <Button size="sm" variant="ghost" onPress={() => setDialog({ metric, issue })}>
                  Edit
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ))}
      {dialog ? (
        <IssueDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          row={row}
          metric={dialog.metric}
          metrics={own}
          issue={dialog.issue}
          passNumber={run.pass}
          runId={run.base}
          slug={slug ?? run.run.project?.slug}
          passRevision={Number(run.run.metadata?.pass_revision ?? 0)}
          onSaved={(updated) => patch(run.base, updated)}
        />
      ) : null}
    </section>
  );
}

export function OutputCard({
  run,
  runIndex,
  row,
  itemId,
}: {
  run: CompareRun;
  runIndex: number;
  row: Row;
  itemId: string;
}) {
  const { ctx, model } = useCompare();
  const ui = useItemsUi();
  const pill = pillState(run, row, ctx);
  const failed = String(row.status) === 'error' || !!row.error;
  const output = failed
    ? `ERROR: ${row.error || row.__execution_error || 'The task failed'}`
    : bodyText(row.output_full ?? row.output);
  const langfuse =
    row.trace_url ||
    buildLangfuseTraceUrl(
      model.langfuseHost || run.run.langfuse_host,
      model.langfuseProjectId || run.run.langfuse_project_id,
      row.trace_id,
    );
  const slug = run.run.project?.slug;
  return (
    <Card
      as="article"
      data-testid="output-card"
      data-run={run.ref}
      data-state={pill.state}
      tone={
        pill.state === 'pass'
          ? 'success'
          : pill.state === 'fail'
            ? 'danger'
            : pill.state === 'error'
              ? 'warning'
              : 'neutral'
      }
    >
      <div className={styles.stack}>
        <header className={styles.head}>
          <RunDot index={runIndex} />
          <span className={styles.letter}>{letterOf(runIndex)}</span>
          {slug ? (
            <Link
              className={styles.runLink}
              to={`${runPath(slug, run.base)}?item=${encodeURIComponent(row.item_id)}${run.pass ? `&pass=${run.pass}` : ''}`}
              title={run.title}
            >
              {run.label}
            </Link>
          ) : (
            <span className={styles.runLink} title={run.title}>
              {run.label}
            </span>
          )}
          <Tag tone={pill.state === 'pass' ? 'success' : pill.state === 'none' ? undefined : 'danger'}>
            {pill.state === 'pass'
              ? '✓ PASS'
              : pill.state === 'fail'
                ? '✗ FAIL'
                : pill.state === 'error'
                  ? '⚠ ERROR'
                  : '—'}
          </Tag>
          {row.latency_ms != null ? (
            <span className={styles.meta}>
              {row.latency_ms === 0 ? '0ms' : formatLatency(row.latency_ms)}
            </span>
          ) : null}
          <span className={styles.actions}>
            {row.trace_id ? (
              <Button
                size="sm"
                variant="neutral"
                icon={<Icon name="list" size={12} />}
                onPress={() => ui.openTrace({ runId: run.base, itemId: row.item_id, pass: run.pass })}
              >
                Trace
              </Button>
            ) : null}
            {langfuse ? (
              <LinkButton
                size="sm"
                variant="neutral"
                href={langfuse}
                target="_blank"
                rel="noopener noreferrer"
                icon={<Icon name="external" size={12} />}
              >
                Langfuse
              </LinkButton>
            ) : null}
            <CopyButton text={output} label={`Copy output of ${run.label}`} />
          </span>
        </header>
        {row.output_received === false ? (
          <p className={styles.note} role="note">
            Output not received: this item’s outcome event never reached the platform.
          </p>
        ) : run.run.items_restricted ? (
          <p className={styles.note}>Item bodies are visible to admins only on a private test set.</p>
        ) : (
          <Collapsible text={output} />
        )}
        <MetricChips run={run} row={row} itemId={itemId} />
        <Issues run={run} row={row} />
      </div>
    </Card>
  );
}
