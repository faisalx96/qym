/** The root-cause issues of one run on one item, in the item pane of the compare page: a list, Add issue and Edit. */
import { useState, type ReactNode } from 'react';
import { Button, Eyebrow, Tag } from '@/ui';
import { getRowRootCauseAnalyses, rootCauseIssues } from '@/features/run-detail/lib/rowMeta';
import type { RootCauseIssue, Row } from '@/features/run-detail/types';
import { useCompare } from '../../../CompareContext';
import { useRowPatch } from '../../../hooks/useRowPatch';
import type { CompareRun } from '../../../lib/model';
import { runReadOnly, runScoresLocked } from '../../../lib/rowCells';
import { IssueDialog } from '../../rd/IssueDialog';
import s from './issues.module.css';

export function Issues({
  run,
  row,
  head,
}: {
  run: CompareRun;
  row: Row;
  /** The start of the head row: the run the issues belong to. */
  head?: ReactNode;
}) {
  const { model, slug, metric: pageMetric } = useCompare();
  const patch = useRowPatch();
  const [dialog, setDialog] = useState<{ metric: string; issue: RootCauseIssue | null } | null>(null);
  const canEdit = !runReadOnly(run) && !runScoresLocked(run) && !run.run.items_restricted;
  const analyses = getRowRootCauseAnalyses(row, 'all', false);
  const byMetric = model.metrics
    .map((metric) => ({
      metric,
      issues: analyses.filter((a) => a.metric_name === metric).flatMap((a) => rootCauseIssues(a, false)),
    }))
    .filter((x) => x.issues.length);
  const own = model.metrics.filter((m) => run.metricIndex[m] !== undefined);
  // New issues target the metric the page is on, not whichever the run lists first.
  const first = own.includes(pageMetric) ? pageMetric : own[0];
  return (
    <section className={s.issues} aria-label={`Root-cause issues for ${run.label}`}>
      <header className={s.head}>
        {head}
        {canEdit && first ? (
          <span className={s.headEnd}>
            <Button size="sm" variant="neutral" onPress={() => setDialog({ metric: first, issue: null })}>
              Add issue
            </Button>
          </span>
        ) : null}
      </header>
      {byMetric.length === 0 ? <p className={s.muted}>No root-cause issues assigned</p> : null}
      {byMetric.map(({ metric, issues }) => (
        <ul key={metric} className={s.list}>
          {issues.map((issue, i) => (
            <li key={issue.issue_id ?? i} className={s.issue}>
              <Tag kind="data">{issue.category || 'Uncategorized'}</Tag>
              {issue.subcategory ? <span className={s.muted}>{issue.subcategory}</span> : null}
              <span className={s.metric}>{metric}</span>
              {canEdit ? (
                <span className={s.headEnd}>
                  <Button size="sm" variant="neutral" onPress={() => setDialog({ metric, issue })}>
                    Edit
                  </Button>
                </span>
              ) : null}
              {issue.finding ? <span className={s.finding}>{issue.finding}</span> : null}
              {issue.category_reason ? (
                <span className={s.finding} data-field="reason">
                  <Eyebrow>Why</Eyebrow> {issue.category_reason}
                </span>
              ) : null}
              {issue.solution ? (
                <span className={s.finding} data-field="solution">
                  <Eyebrow>Solution</Eyebrow> {issue.solution}
                  {issue.solution_note ? <span className={s.muted}> {issue.solution_note}</span> : null}
                </span>
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
