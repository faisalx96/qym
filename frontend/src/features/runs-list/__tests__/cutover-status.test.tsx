/**
 * Cutover of test_run_review_workflow.py::test_run_page_shows_history_and_runs_list_credits_only_decisions_in_effect
 * (the runs-list half): a withdrawn decision stays on the approval row, so the status tooltip credits
 * the reviewer only while the run is still in the status that decision set.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusCell } from '../cells';
import type { RunRow } from '@/api/dashboardTypes';

const row = (status: string, approval: Record<string, unknown> | null): RunRow =>
  ({ run_id: 'r1', status, samples: 1, approval }) as unknown as RunRow;

const decision = {
  decision: 'APPROVED',
  decision_by: { display_name: 'Maya', email: 'maya@example.com' },
  comment: 'LGTM',
};

describe('runs list stopping state (test_run_stop_reflection.py)', () => {
  it('shows STOPPING while a stop is under way, with the reason in the tooltip', () => {
    const { container } = render(
      <StatusCell row={{ ...row('RUNNING', null), stop_requested: true } as RunRow} />,
    );
    expect(container).toHaveTextContent('Stopping…');
    expect(container.querySelector('[title]')).toHaveAttribute(
      'title',
      'Stop requested: waiting for the evaluation service to confirm',
    );
  });

  it('a stop request on a finished run changes nothing', () => {
    const { container } = render(
      <StatusCell row={{ ...row('COMPLETED', null), stop_requested: true } as RunRow} />,
    );
    expect(container).not.toHaveTextContent('Stopping…');
  });
});

describe('runs list status tooltip', () => {
  it('credits the approver while the approval is in effect', () => {
    const { container } = render(<StatusCell row={row('APPROVED', decision)} />);
    expect(container.querySelector('[title]')).toHaveAttribute('title', 'APPROVED by Maya\n"LGTM"');
  });

  it('does not credit a withdrawn decision once the run has moved on', () => {
    const { container } = render(<StatusCell row={row('COMPLETED', decision)} />);
    expect(container.querySelector('[title]')).toHaveAttribute('title', 'COMPLETED');
    expect(screen.queryByText(/Maya/)).toBeNull();
  });
});
