/**
 * Per-metric root cause cards on an item: issues, add / edit, approve / reject (brief 04 J8, §3j; C125, C128, C174).
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/lib/http';
import { useIssueAction, useIssueBlocksQuery } from '@/api/runs';
import { isItemTaskError } from '@/lib/metrics';
import { Button, Disclosure, Icon, ReviewStatusMark, Tag, Textarea, useToast } from '@/ui';
import { rowPassesFor, rowScoreFor } from '../../lib/filterRules';
import { rootCauseCategories, rootCauseIssues } from '../../lib/rowMeta';
import { useRunPage } from '../../RunContext';
import type { MetricAnalysis, RootCauseIssue, Row } from '../../types';
import { messageFor } from '../items/ScoreEditor';
import { IssueForm } from './IssueForm';
import styles from './MetricAnalysisCards.module.css';

function decidedOn(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** One muted line under a decided issue: 'Rejected by Name · date: comment' (C125). */
export function decisionLine(status: string, issue: RootCauseIssue): string {
  if (status !== 'approved' && status !== 'rejected') return '';
  const by = issue.reviewed_by_name ? ` by ${issue.reviewed_by_name}` : '';
  const when = decidedOn(issue.reviewed_at);
  const comment = issue.review_comment ? `: ${issue.review_comment}` : '';
  return `${status === 'approved' ? 'Approved' : 'Rejected'}${by}${when ? ` · ${when}` : ''}${comment}`;
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
  // The form opens inline: 'new' under the issues, or in place of the issue being edited (C128).
  const [form, setForm] = useState<{ key: string; issue: RootCauseIssue | null } | null>(null);
  const [rejecting, setRejecting] = useState<{ key: string; comment: string } | null>(null);
  // A refusal the server gave for one issue (the rule changed after the blocks were read).
  const [refused, setRefused] = useState<Record<string, string>>({});
  const issues = rootCauseIssues(analysis ?? {}, false);
  const blocks = useIssueBlocksQuery(runId, row.item_id, passNumber, canEdit && issues.length > 0);
  const blockFor = (issue: RootCauseIssue, key: string) =>
    refused[key] ||
    blocks.data?.role_block ||
    (issue.issue_id ? blocks.data?.blocks?.[metric]?.[issue.issue_id] : undefined) ||
    '';
  const decide = (issue: RootCauseIssue, key: string, verdict: 'approve' | 'reject', comment = '') =>
    action.mutate(
      {
        run_id: runId,
        item_id: row.item_id,
        metric_name: metric,
        action: verdict,
        issue_id: issue.issue_id,
        expected_issue: issue as unknown as Record<string, unknown>,
        ...(verdict === 'reject' ? { comment } : {}),
        ...(passNumber ? { pass_number: passNumber, expected_pass_version: model.passRevision } : {}),
      },
      {
        onSuccess: () => setRejecting(null),
        onError: (e) => {
          if (e instanceof ApiError && e.status === 403) setRefused((r) => ({ ...r, [key]: messageFor(e) }));
          else toast.show(messageFor(e), { tone: 'error' });
        },
      },
    );
  return (
    <section
      className={styles.metricRow}
      aria-label={`Root cause analysis for ${metric}`}
      data-testid="metric-analysis-card"
      data-metric={metric}
    >
      <div className={styles.stack}>
        <header className={styles.head}>
          <h5 className={styles.title}>{metric}</h5>
          {analysis?.error ? <Tag tone="danger">analysis failed</Tag> : null}
          {canEdit && !form ? (
            <Button size="sm" variant="neutral" onPress={() => setForm({ key: '', issue: null })}>
              + Add issue
            </Button>
          ) : null}
        </header>
        {analysis?.error ? <p className={styles.errorText}>{String(analysis.error)}</p> : null}
        {issues.length === 0 && !analysis?.error ? (
          <p className={styles.muted}>No issues recorded for this metric.</p>
        ) : null}
        <ul className={styles.issues}>
          {issues.map((issue, i) => {
            const key = issue.issue_id ?? String(i);
            if (form?.issue && form.key === key)
              return (
                <li key={key} className={styles.issue}>
                  <IssueForm
                    onClose={() => setForm(null)}
                    row={row}
                    metric={metric}
                    issue={issue}
                    passNumber={passNumber}
                  />
                </li>
              );
            const status = issueStatus(row, metric, issue, i, analysis);
            const block = canEdit ? blockFor(issue, key) : '';
            const line = decisionLine(status, issue);
            const isRejecting = rejecting?.key === key;
            return (
              <li key={key} className={styles.issue} data-testid="issue" data-status={status}>
                <div className={styles.issueHead}>
                  <Tag kind="accent">{issue.category || 'Uncategorized'}</Tag>
                  {issue.subcategory ? <span className={styles.sub}>{issue.subcategory}</span> : null}
                  <ReviewStatusMark status={status} />
                  {issue.confidence != null ? (
                    <span className={styles.conf}>{Math.round(issue.confidence * 100)}% confidence</span>
                  ) : null}
                  {canEdit ? (
                    <span className={styles.actions}>
                      <Button size="sm" variant="neutral" onPress={() => setForm({ key, issue })}>
                        Edit
                      </Button>
                      {status === 'pending' && !isRejecting ? (
                        <>
                          <Button
                            size="sm"
                            variant="accent"
                            onPress={() => decide(issue, key, 'approve')}
                            isDisabled={action.isPending || !!block}
                            aria-label={`Approve issue ${issue.category}`}
                          >
                            ✓ Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onPress={() => setRejecting({ key, comment: '' })}
                            isDisabled={action.isPending || !!block}
                            aria-label={`Reject issue ${issue.category}`}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {status === 'pending' && block ? (
                  <p className={styles.blocked} data-testid="issue-block">
                    <Icon name="lock" size={12} />
                    {block}
                  </p>
                ) : null}
                {line ? (
                  <p className={styles.decision} data-testid="issue-decision">
                    {line}
                  </p>
                ) : null}
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
                {isRejecting ? (
                  <div className={styles.rejectForm} data-testid="reject-form">
                    <Textarea
                      label="Why reject it? (optional)"
                      value={rejecting.comment}
                      onChange={(comment) => setRejecting({ key, comment })}
                      rows={2}
                      autoFocus
                    />
                    <div className={styles.formActions}>
                      <span className={styles.formSpacer} />
                      <Button size="sm" variant="neutral" onPress={() => setRejecting(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={action.isPending}
                        onPress={() => decide(issue, key, 'reject', rejecting.comment.trim())}
                      >
                        Reject issue
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {form && !form.issue ? (
          <IssueForm
            onClose={() => setForm(null)}
            row={row}
            metric={metric}
            issue={null}
            passNumber={passNumber}
          />
        ) : null}
      </div>
    </section>
  );
}

/**
 * The link to one pass of a repeat item (C127): it keeps the page's filters (show, metric, threshold, q and the rest)
 * and sets only the pass and the item, so a reviewer keeps the list of failures after the switch.
 */
export function passItemHref(
  basePath: string,
  search: URLSearchParams,
  pass: number,
  itemId: string,
): string {
  const next = new URLSearchParams(search);
  next.delete('item_id');
  next.delete('page');
  next.delete('trace');
  next.delete('trace_pass');
  next.set('pass', String(pass));
  next.set('item', itemId);
  return `${basePath}?${next.toString()}`;
}

export function MetricAnalysisCards({ row }: { row: Row }) {
  const { model, api, readOnly, basePath } = useRunPage();
  const [search] = useSearchParams();
  const repeatAggregate = model.isRepeat && !model.viewPass;
  const md = row.item_metadata ?? {};
  const analyses = (md.metric_analyses ?? {}) as Record<string, MetricAnalysis>;
  if (repeatAggregate) {
    return model.metricNames.length ? (
      <p className={styles.muted} data-testid="root-cause-pass-hint">
        Root causes are reviewed per pass.{' '}
        {Array.from({ length: model.samples }, (_, i) => i + 1).map((p) => (
          <Link key={p} to={passItemHref(basePath, search, p, row.item_id)} className={styles.link}>
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
  const issueCount = cards.reduce((n, c) => n + rootCauseIssues(c.analysis ?? {}, false).length, 0);
  if (!cards.length && !legacy) return null;
  if (!cards.length) return <LegacyDiagnosis md={md} />;
  if (issueCount === 0 && !canEdit && !cards.some((c) => c.analysis?.error)) {
    return (
      <p className={styles.muted} data-testid="root-cause-empty">
        No root-cause issues assigned
      </p>
    );
  }
  const summary =
    issueCount === 0
      ? `no issues yet, ${cards.length} ${cards.length === 1 ? 'metric' : 'metrics'}`
      : `${issueCount} ${issueCount === 1 ? 'issue' : 'issues'} across ${cards.length} ${cards.length === 1 ? 'metric' : 'metrics'}`;
  return (
    <Disclosure title="Root cause" summary={summary} className={styles.rootCause}>
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
      {legacy ? <LegacyDiagnosis md={md} /> : null}
    </Disclosure>
  );
}

function LegacyDiagnosis({ md }: { md: Record<string, unknown> }) {
  return (
    <section className={styles.metricRow} aria-label="Legacy diagnosis">
      <div className={styles.stack}>
        <header className={styles.head}>
          <h5 className={styles.title}>Diagnosis (legacy)</h5>
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
      </div>
    </section>
  );
}
