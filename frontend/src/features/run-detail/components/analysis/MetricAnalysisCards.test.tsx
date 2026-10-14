/**
 * Cutover of tests/platform/test_root_cause_issue_javascript.py (metric analysis cards on an item):
 * a card shows only for a failing or errored metric (or one that already has an analysis), what it
 * lists per issue, and a failed analysis never lists its provider error as an issue.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';
import { buildRunModel } from '../../lib/runModel';
import { effectiveThresholds, type FilterContext } from '../../lib/filterRules';
import type { Row, RunPayload } from '../../types';

let current: ReturnType<typeof makeContext>;
vi.mock('../../RunContext', () => ({ useRunPage: () => current }));
vi.mock('@/api/runs', () => ({
  useIssueAction: () => ({ mutate: vi.fn(), isPending: false }),
  useCategoryCatalogQuery: () => ({ data: undefined }),
}));

import { MetricAnalysisCards } from './MetricAnalysisCards';

const specs = {
  passing_boolean: { score_type: 'boolean', direction: 'maximize', schema_version: 2 },
  failing_boolean: { score_type: 'boolean', direction: 'maximize', schema_version: 2 },
  passing_score: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.8, schema_version: 2 },
  failing_score: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.8, schema_version: 2 },
  zero_threshold: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0, schema_version: 2 },
  observation: { score_type: 'number', schema_version: 2 },
  broken_judge: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.8, schema_version: 2 },
};
const names = Object.keys(specs);

function makeContext(row: Row, readOnly = false) {
  const payload = {
    run: { run_id: 'r', status: 'COMPLETED', samples: 1, metric_names: names, metric_specs: specs },
    snapshot: { rows: [row], metric_names: names, metric_specs: specs },
  } as unknown as RunPayload;
  const model = buildRunModel(payload, null);
  const ctx: FilterContext = {
    model,
    thresholds: effectiveThresholds(model, { metric: null, threshold: null }),
    selectedMetric: model.defaultMetric,
    repeatAggregate: false,
  };
  return { runId: 'r', slug: 'p', model, api: { ctx }, readOnly, basePath: '/projects/p/runs/r' };
}

function show(row: Row, readOnly = false) {
  current = makeContext(row, readOnly);
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <MetricAnalysisCards row={row} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const base = (over: Partial<Row> = {}): Row =>
  ({
    index: 0,
    item_id: 'item-1',
    status: 'completed',
    metric_values: [1, 0, 0.8, 0.79, 0, 42, 0],
    metric_meta: {},
    item_metadata: {},
    ...over,
  }) as Row;

const cards = () => screen.queryAllByTestId('metric-analysis-card').map((c) => c.getAttribute('data-metric'));

describe('metric analysis is shown only for failed or errored judges', () => {
  it('passing, undirected and unscored metrics get no card', () => {
    show(base());
    // failing_boolean (0 of True), failing_score (0.79 < 0.8), broken_judge (0 < 0.8) fail; the rest pass or have no verdict.
    expect(cards()).toEqual(['failing_boolean', 'failing_score', 'broken_judge']);
    expect(cards()).not.toContain('passing_boolean');
    expect(cards()).not.toContain('passing_score');
    expect(cards()).not.toContain('zero_threshold');
    expect(cards()).not.toContain('observation');
  });

  it('a metric whose judge errored gets its card even with a stored 0', () => {
    show(
      base({ metric_values: [1, 1, 0.9, 0.9, 0, 42, 0], metric_meta: { broken_judge: { status: 'error' } } }),
    );
    expect(cards()).toEqual(['broken_judge']);
  });

  it('a metric with an analysis keeps its card even when it passes', () => {
    show(
      base({
        metric_values: [1, 1, 0.9, 0.9, 0, 42, 1],
        item_metadata: { metric_analyses: { passing_score: { root_cause_issues: [] } } },
      }),
    );
    expect(cards()).toEqual(['passing_score']);
  });
});

describe('what a card lists', () => {
  const issue = {
    issue_id: 'issue-1',
    category: 'Retrieval',
    subcategory: 'Document coverage',
    finding: 'Missing evidence',
    solution: 'Use <verified> evidence',
    solution_note: 'Keep <filters>',
    review_status: 'pending',
  };
  const withIssue = (extra = {}) =>
    base({
      metric_values: [1, 1, 0.9, 0.5, 1, 42, 1],
      item_metadata: { metric_analyses: { failing_score: { root_cause_issues: [{ ...issue, ...extra }] } } },
    });

  it('renders category, subcategory, finding and the solution as text, never markup', () => {
    const { container } = show(withIssue());
    fireEvent.click(screen.getByRole('button', { name: /Root cause/ }));
    const card = screen.getByTestId('metric-analysis-card');
    expect(card).toHaveTextContent('Retrieval');
    expect(card).toHaveTextContent('Document coverage');
    expect(card).toHaveTextContent('Missing evidence');
    expect(card).toHaveTextContent('Use <verified> evidence');
    expect(card).toHaveTextContent('Keep <filters>');
    expect(container.querySelector('verified, filters')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve issue Retrieval/ })).toBeInTheDocument();
  });

  it('shows no solution line when the solution is empty or blank', () => {
    for (const solution of [undefined, null, '']) {
      const { unmount } = show(withIssue({ solution, solution_note: '' }));
      expect(screen.getByTestId('metric-analysis-card')).not.toHaveTextContent('Solution:');
      unmount();
    }
  });

  it('an approved issue offers no Approve, and a read-only run offers no editing', () => {
    show(withIssue({ review_status: 'approved' }));
    expect(screen.queryByRole('button', { name: /Approve issue/ })).toBeNull();
    expect(screen.getByTestId('metric-analysis-card')).toHaveTextContent('Approved');
  });

  it('read-only: no Add issue, Edit or Approve', () => {
    show(withIssue(), true);
    expect(screen.queryByRole('button', { name: /Add issue|Edit|Approve/ })).toBeNull();
  });

  it('a failed analysis says so and lists no issue; the saved data is untouched', () => {
    const analysis = Object.freeze({ error: 'Provider failure', error_code: 'timeout', source: 'ai' });
    const before = JSON.stringify(analysis);
    show(base({ item_metadata: { metric_analyses: { failing_score: analysis } } }));
    const card = screen
      .getAllByTestId('metric-analysis-card')
      .find((c) => c.getAttribute('data-metric') === 'failing_score')!;
    expect(card).toHaveTextContent('analysis failed');
    expect(card.querySelectorAll('[data-testid=issue]')).toHaveLength(0);
    expect(JSON.stringify(analysis)).toBe(before);
  });
});
