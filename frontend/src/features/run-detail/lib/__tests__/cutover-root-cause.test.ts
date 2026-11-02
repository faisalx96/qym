/** Cutover of test_root_cause_issue_javascript.py::test_item_level_chart_preserves_all_issues (run and compare share rowMeta). */
import { describe, expect, it } from 'vitest';
import { scopeRowToPass } from '../passScope';
import { getRowRootCauseAnalyses, isRejectedIssue, rootCauseCategories, rootCauseIssues } from '../rowMeta';
import type { Row } from '../../types';

describe('the item-level root-cause chart keeps every issue', () => {
  it('lists all issues of an item, nothing when they are removed, and the legacy categories', () => {
    const issues = [
      { category: 'Agent', subcategory: 'Lookup', finding: 'First finding' },
      { category: 'Agent', subcategory: 'Filter', finding: 'Second finding' },
    ];
    const row = {
      item_metadata: {
        root_cause_issues: issues,
        root_causes: ['Agent'],
        root_cause: 'Agent',
        root_cause_detail: 'Lookup',
        root_cause_note: 'First finding',
      },
    } as unknown as Row;
    const chartIssues = getRowRootCauseAnalyses(row, 'all', false).flatMap((a) => rootCauseIssues(a));
    expect(chartIssues).toHaveLength(2);
    expect(chartIssues.map((i) => i.subcategory)).toEqual(['Lookup', 'Filter']);
    expect(chartIssues.map((i) => i.finding)).toEqual(['First finding', 'Second finding']);
    (row.item_metadata as Record<string, unknown>).root_cause_issues = [];
    expect(getRowRootCauseAnalyses(row, 'all', false)).toEqual([]);
    delete (row.item_metadata as Record<string, unknown>).root_cause_issues;
    (row.item_metadata as Record<string, unknown>).root_causes = ['Agent', 'Evaluator'];
    const legacy = getRowRootCauseAnalyses(row, 'all', false).flatMap((a) => rootCauseIssues(a));
    expect(legacy.map((i) => i.finding)).toEqual(['First finding', 'First finding']);
  });
});

/**
 * Cutover of tests/platform/test_issue_solution_flow.py. The vanilla Sankey (failure -> fix flow) was
 * dropped in the React rewrite (decisions/run-detail/OPEN_QUESTIONS.md 2026-10-12, compare Q5);
 * what remains is that every pass keeps its own diagnosis and never inherits the parent's.
 */
describe('pass diagnosis scoping', () => {
  const diagnosis = (solution: string) => ({ root_cause_issues: [{ category: 'Agent', solution }] });

  it('a run sums issue solutions across passes without a parent fallback', () => {
    const row = {
      item_metadata: { metric_analyses: { accuracy: diagnosis('Parent only') } },
      pass_metric_analyses: {
        accuracy: [diagnosis('Pass 1 fix'), diagnosis('Pass 2 fix'), null],
        style: [null, diagnosis('Style fix')],
      },
    } as unknown as Row;
    const analyses = getRowRootCauseAnalyses(row, 'accuracy', true);
    expect(analyses.map((a) => a.pass_number)).toEqual([1, 2]);
    expect(analyses.flatMap((a) => rootCauseIssues(a).map((i) => i.solution))).toEqual([
      'Pass 1 fix',
      'Pass 2 fix',
    ]);
    expect(getRowRootCauseAnalyses(row, 'all', true)).toHaveLength(3);
  });

  it('pass metadata never inherits the parent solutions and the parent row is untouched', () => {
    const one = { root_cause_issues: [{ category: 'Agent', solution: 'First' }] };
    const two = { root_cause_issues: [{ category: 'Agent', solution: 'Second' }] };
    const row = {
      item_metadata: {
        custom: { keep: true },
        root_cause: 'Stale',
        root_causes: ['Stale'],
        root_cause_categories: ['Stale'],
        root_cause_issues: [{ category: 'Stale', solution: 'Stale fix' }],
        root_cause_reason: 'Stale reason',
        solution: 'Shared',
        solution_note: 'Preserve in source',
        metric_analyses: { accuracy: { solution: 'Parent' } },
      },
      pass_metric_analyses: { accuracy: [one, two] },
    } as unknown as Row;
    const before = JSON.stringify(row);
    expect(scopeRowToPass(row, ['accuracy'], 1).item_metadata).toEqual({
      custom: { keep: true },
      metric_analyses: { accuracy: one },
    });
    expect(scopeRowToPass(row, ['accuracy'], 2).item_metadata).toEqual({
      custom: { keep: true },
      metric_analyses: { accuracy: two },
    });
    expect(scopeRowToPass(row, ['accuracy'], 3).item_metadata).toEqual({ custom: { keep: true } });
    expect(JSON.stringify(row)).toBe(before);
  });

  it('each pass of a sliced repeat run keeps its own solution', () => {
    const row = {
      index: 0,
      item_id: 'one',
      item_metadata: { metric_analyses: { accuracy: diagnosis('Parent') } },
      pass_metric_analyses: { accuracy: [diagnosis('First'), diagnosis('Second')] },
    } as unknown as Row;
    const solutions = (pass: number) =>
      getRowRootCauseAnalyses(scopeRowToPass(row, ['accuracy'], pass), 'all', false).flatMap((a) =>
        rootCauseIssues(a).map((i) => i.solution),
      );
    expect(solutions(1)).toEqual(['First']);
    expect(solutions(2)).toEqual(['Second']);
    expect(solutions(3)).toEqual([]);
    expect(
      (
        row.item_metadata as {
          metric_analyses: { accuracy: { root_cause_issues: Array<{ solution: string }> } };
        }
      ).metric_analyses.accuracy.root_cause_issues[0]!.solution,
    ).toBe('Parent');
  });
});

/** C007: the analysis-level reason belongs to the first issue only until the server gives it an ID. */
describe('the analysis-level category reason', () => {
  const top = 'Both issues come from the agent.';
  const reasons = (issues: Record<string, unknown>[]) =>
    rootCauseIssues({ root_cause_reason: top, root_cause_issues: issues }).map((i) => i.category_reason);

  it('shows on a first issue that has no ID yet, as the server copies it', () => {
    expect(reasons([{ category: 'A' }, { category: 'B' }])).toEqual([top, '']);
  });

  it('never replaces the reason of an issue that has an ID', () => {
    // a sibling that moved up after a delete, a reason a reviewer cleared, and a saved reason
    expect(reasons([{ issue_id: 'b', category: 'B' }])).toEqual(['']);
    expect(reasons([{ issue_id: 'a', category: 'A', category_reason: '' }])).toEqual(['']);
    expect(reasons([{ issue_id: 'a', category: 'A', category_reason: 'Own reason' }])).toEqual([
      'Own reason',
    ]);
  });
});

describe('rejected issues are not root causes (C067)', () => {
  const analysis = {
    root_cause_issues: [
      {
        issue_id: 'a',
        category: 'Knowledge Gap',
        subcategory: 'Old refund policy',
        review_status: 'rejected',
      },
      { issue_id: 'b', category: 'Knowledge Gap', subcategory: 'Missing doc', review_status: 'pending' },
      { issue_id: 'c', category: 'Hallucination', review_status: 'rejected' },
    ],
  };

  it('leave the categories (counts and filter), while the issue list keeps them', () => {
    expect(rootCauseCategories(analysis)).toEqual(['Knowledge Gap']);
    expect(rootCauseIssues(analysis, false).map((i) => i.issue_id)).toEqual(['a', 'b', 'c']);
    expect(
      isRejectedIssue({
        category: 'x',
        subcategory: '',
        finding: '',
        category_reason: '',
        review_status: 'REJECTED',
      }),
    ).toBe(true);
  });

  it('an analysis whose issues are all rejected has no category', () => {
    expect(rootCauseCategories({ root_cause_issues: [analysis.root_cause_issues[2]] })).toEqual([]);
  });
});
