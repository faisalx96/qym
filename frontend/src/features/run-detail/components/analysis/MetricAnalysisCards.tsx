/** Per-metric root cause cards on an item: issues, add / edit / approve (brief 04 J8, §3j). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useIssueAction } from '@/api/runs';
import { isItemTaskError } from '@/lib/metrics';
import { Button, Tag, useToast } from '@/ui';
import { rowPassesFor, rowScoreFor } from '../../lib/filterRules';
import { rootCauseCategories, rootCauseIssues } from '../../lib/rowMeta';
import { useRunPage } from '../../RunContext';
import type { MetricAnalysis, RootCauseIssue, Row } from '../../types';
import { messageFor } from '../items/ScoreEditor';
import { IssueDialog } from './IssueDialog';
import styles from './MetricAnalysisCards.module.css';

function statusTag(status: string) {
  if (status === 'approved') return <Tag tone="success">Approved</Tag>;
  if (status === 'rejected')
    return (
      <Tag tone="danger" title="Reset it to pending on Reviews to decide it again">
        Rejected
      </Tag>
    );
  return <Tag>Pending review</Tag>;
}

/**
 * The status an issue is judged by: the server's per-issue review status (row.review_issue_statuses,
 * by issue_id or position) first, then the issue JSON, the analysis and the legacy correction.
 */
export function issueStatus(
  row: Row,
  metric: string,
  issue: RootCauseIssue,
  index: number,
  analysis: MetricAnalysis | undefined,
): string {
  const list = row.review_issue_statuses?.[metric];
  if (Array.isArray(list)) {
    const entry = issue.issue_id ? list.find((c) => c && c.issue_id === issue.issue_id) : list[index];
    if (entry && (issue.issue_id || !entry.issue_id) && entry.status)
      return String(entry.status).toLowerCase();
  }
  return String(
    issue.review_status || analysis?.review_status || row.review_corrections?.[metric]?.status || 'pending',
  ).toLowerCase();
}

function Card({
  row,
  metric,
  analysis,
  passNumber,
  canEdit,
}: {
  row: Row;
  metric: string;
  analysis: MetricAnalysis | undefined;
  passNumber: number | null;
  canEdit: boolean;
}) {
  const { runId, model } = useRunPage();
  const toast = useToast();
  const action = useIssueAction(runId);
  const [dialog, setDialog] = useState<{ open: boolean; issue: RootCauseIssue | null }>({
    open: false,
    issue: null,
  });
  const issues = rootCauseIssues(analysis ?? {}, false);
  const approve = (issue: RootCauseIssue) =>
    action.mutate(
      {
        run_id: runId,
        item_id: row.item_id,
        metric_name: metric,
        action: 'approve',
        issue_id: issue.issue_id,
        expected_issue: issue as unknown as Record<string, unknown>,
        ...(passNumber ? { pass_number: passNumber, expected_pass_version: model.passRevision } : {}),
      },
      { onError: (e) => toast.show(messageFor(e), { tone: 'error' }) },
    );
  return (
    <section
      className={styles.card}
      aria-label={`Root cause analysis for ${metric}`}
      data-testid="metric-analysis-card"
      data-metric={metric}
    >
      <header className={styles.head}>
        <h4 className={styles.title}>Root cause · {metric}</h4>
        {analysis?.error ? <Tag tone="danger">analysis failed</Tag> : null}
        {canEdit ? (
          <Button size="sm" variant="neutral" onPress={() => setDialog({ open: true, issue: null })}>
            + Add issue
          </Button>
        ) : null}
      </header>
      {analysis?.error ? <p className={styles.errorText}>{String(analysis.error)}</p> : null}
      {issues.length === 0 && !analysis?.error ? (
        <p className={styles.muted}>No issues recorded for this metric.</p>
      ) : null}
      <ul className={styles.issues}>
        {issues.map((issue, i) => (
          <li key={issue.issue_id ?? i} className={styles.issue} data-testid="issue">
            <div className={styles.issueHead}>
              <Tag kind="accent">{issue.category || 'Uncategorized'}</Tag>
              {issue.subcategory ? <span className={styles.sub}>{issue.subcategory}</span> : null}
              {statusTag(issueStatus(row, metric, issue, i, analysis))}
              {issue.confidence != null ? (
                <span className={styles.conf}>{Math.round(issue.confidence * 100)}% confidence</span>
              ) : null}
              {canEdit ? (
                <span className={styles.actions}>
                  <Button size="sm" variant="neutral" onPress={() => setDialog({ open: true, issue })}>
                    Edit
                  </Button>
                  {issueStatus(row, metric, issue, i, analysis) === 'pending' ? (
                    <Button
                      size="sm"
                      variant="accent"
                      onPress={() => approve(issue)}
                      isDisabled={action.isPending}
                      aria-label={`Approve issue ${issue.category}`}
                    >
                      ✓ Approve
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </div>
            {issue.finding ? <p className={styles.finding}>{issue.finding}</p> : null}
            {issue.category_reason ? (
              <p className={styles.muted}>
                <b>Why this category:</b> {issue.category_reason}
              </p>
            ) : null}
            {issue.solution || issue.solution_note ? (
              <p className={styles.muted}>
                <b>Solution:</b> {issue.solution}
                {issue.solution_note ? ` — ${issue.solution_note}` : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {dialog.open ? (
        <IssueDialog
          open
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          row={row}
          metric={metric}
          issue={dialog.issue}
          passNumber={passNumber}
        />
      ) : null}
    </section>
  );
}

export function MetricAnalysisCards({ row }: { row: Row }) {
  const { model, api, readOnly, basePath } = useRunPage();
  const repeatAggregate = model.isRepeat && !model.viewPass;
  const md = row.item_metadata ?? {};
  const analyses = (md.metric_analyses ?? {}) as Record<string, MetricAnalysis>;
  if (repeatAggregate) {
    return model.metricNames.length ? (
      <p className={styles.muted} data-testid="root-cause-pass-hint">
        Root causes are reviewed per pass.{' '}
        {Array.from({ length: model.samples }, (_, i) => i + 1).map((p) => (
          <Link
            key={p}
            to={`${basePath}?pass=${p}&item=${encodeURIComponent(row.item_id)}`}
            className={styles.link}
          >
            Pass {p}
          </Link>
        ))}
      </p>
    ) : null;
  }
  const passNumber = model.viewPass ?? (model.isRepeat ? 1 : null);
  const canEdit = !readOnly;
  // A task error or a missing outcome means the judges said nothing: only saved diagnoses show.
  const noVerdict = isItemTaskError(row) || row.output_received === false;
  const cards = model.metricNames
    .map((metric) => {
      if (noVerdict) {
        const saved = analyses[metric];
        return saved && !saved.error && rootCauseIssues(saved, false).length
          ? { metric, analysis: saved }
          : null;
      }
      const idx = model.metricNames.indexOf(metric);
      const outcome = rowScoreFor(api.ctx, row, idx, metric);
      const failing = outcome.isError || rowPassesFor(api.ctx, metric, outcome) === false;
      const analysis = analyses[metric];
      return failing || analysis ? { metric, analysis } : null;
    })
    .filter((c): c is { metric: string; analysis: MetricAnalysis | undefined } => !!c);
  const legacy =
    !Object.keys(analyses).length && (rootCauseCategories(md).length || md.root_cause_note || md.solution);
  return (
    <>
      {cards.map((c) => (
        <Card
          key={c.metric}
          row={row}
          metric={c.metric}
          analysis={c.analysis}
          passNumber={passNumber}
          canEdit={canEdit}
        />
      ))}
      {legacy ? (
        <section className={styles.card} aria-label="Legacy diagnosis">
          <header className={styles.head}>
            <h4 className={styles.title}>Diagnosis (legacy)</h4>
          </header>
          <p className={styles.finding}>
            {rootCauseCategories(md).join(', ')}
            {md.root_cause_detail ? ` · ${String(md.root_cause_detail)}` : ''}
          </p>
          {md.root_cause_note ? <p className={styles.muted}>{String(md.root_cause_note)}</p> : null}
          {md.solution ? (
            <p className={styles.muted}>
              <b>Solution:</b> {String(md.solution)}
              {md.solution_note ? ` — ${String(md.solution_note)}` : ''}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
