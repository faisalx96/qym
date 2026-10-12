/**
 * Cutover of tests/platform/test_root_cause_issue_javascript.py (the vanilla issue popup): what the
 * Add / Edit / Delete issue dialog sends and when it refuses. The run page dialog is the same
 * component logic (this one takes its run context as props), so both are pinned here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import type * as HttpModule from '@/lib/http';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import type { RootCauseIssue, Row } from '@/features/run-detail/types';

const post = vi.fn();
vi.mock('@/lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(async () => ({
        categories: ['Agent', 'Evaluator'],
        category_taxonomy: { Agent: { description: 'Meaning of agent', when_to_use: 'Usage guidance' } },
      })),
      post: (...args: unknown[]) => post(...args),
    },
  };
});

import { IssueDialog } from './IssueDialog';

const row = { item_id: 'item-1', index: 0 } as Row;
const one: RootCauseIssue = {
  issue_id: 'one',
  category: 'Agent',
  subcategory: '',
  finding: 'First',
  category_reason: '',
  solution: 'First fix',
  review_status: 'approved',
};
const two: RootCauseIssue = {
  issue_id: 'two',
  category: 'Evaluator',
  subcategory: 'Subtype',
  finding: 'Second',
  solution: 'Second fix',
  solution_note: 'Second note',
  category_reason: 'Saved why',
  confidence: 0.9,
};

function open(props: Partial<ComponentProps<typeof IssueDialog>> = {}) {
  const onOpenChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <IssueDialog
        open
        onOpenChange={onOpenChange}
        row={row}
        metric="accuracy"
        issue={null}
        passNumber={null}
        runId="run-1"
        slug="demo"
        passRevision={3}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const save = () => screen.getByTestId('issue-save');

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ ok: true, row: { item_id: 'item-1' } });
});

describe('issue dialog', () => {
  it.each([null, two])('requires a category before anything is sent (%#)', async (issue) => {
    const user = userEvent.setup();
    // an existing issue with its category blanked, and a new empty one
    open({ issue: issue ? { ...issue, category: '' } : null });
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose or type a category.');
    expect(post).not.toHaveBeenCalled();
  });

  it('shows every original field of the issue it edits, and only that issue', () => {
    open({ issue: two });
    expect(screen.getByRole('heading', { name: 'Edit issue · accuracy' })).toBeInTheDocument();
    expect(screen.getByLabelText('Subcategory')).toHaveValue('Subtype');
    expect(screen.getByLabelText('Finding')).toHaveValue('Second');
    expect(screen.getByLabelText('Why this category')).toHaveValue('Saved why');
    expect(screen.getByLabelText('Solution')).toHaveValue('Second fix');
    expect(screen.getByLabelText('Solution notes')).toHaveValue('Second note');
    expect(screen.queryByDisplayValue('First')).toBeNull();
  });

  it('adding sends one new issue with a client id and never the existing issue list', async () => {
    const user = userEvent.setup();
    open({ issue: null, passNumber: 2 });
    await user.click(screen.getByRole('button', { name: /Category/ }));
    await user.click(await screen.findByRole('option', { name: 'Agent' }));
    await user.type(screen.getByLabelText('Subcategory'), '  Newly proposed label  ');
    await user.type(screen.getByLabelText('Finding'), 'Evidence');
    await user.type(screen.getByLabelText('Solution'), '  New custom fix  ');
    await user.click(save());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/runs/update_root_cause_issue');
    expect(body).toMatchObject({
      run_id: 'run-1',
      item_id: 'item-1',
      metric_name: 'accuracy',
      action: 'add',
      pass_number: 2,
      expected_pass_version: 3,
      issue: {
        category: 'Agent',
        subcategory: 'Newly proposed label',
        finding: 'Evidence',
        solution: 'New custom fix',
        solution_note: '',
      },
    });
    expect(typeof body.client_issue_id).toBe('string');
    expect(body).not.toHaveProperty('root_cause_issues');
    expect(body).not.toHaveProperty('issue_id');
  });

  it('editing targets the issue by its stable id and expects the stored issue; deleting likewise', async () => {
    const user = userEvent.setup();
    open({ issue: two });
    await user.clear(screen.getByLabelText('Finding'));
    await user.type(screen.getByLabelText('Finding'), 'Unsaved finding');
    await user.click(save());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const edit = post.mock.calls[0]![1] as Record<string, unknown>;
    expect(edit).toMatchObject({ action: 'edit', issue_id: 'two', expected_issue: two });
    expect((edit.issue as Record<string, string>).finding).toBe('Unsaved finding');
    // The draft never touches the stored issues.
    expect(two.finding).toBe('Second');
    expect(one.review_status).toBe('approved');

    post.mockClear();
    await user.click(screen.getByRole('button', { name: 'Delete issue' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![1]).toMatchObject({ action: 'delete', issue_id: 'two', expected_issue: two });
  });

  it('keeps the draft when the save fails, says why, and a retry reuses the same client id', async () => {
    const user = userEvent.setup();
    post.mockRejectedValueOnce(new ApiError(500, 'Connection interrupted'));
    const { onOpenChange } = open({ issue: null });
    await user.click(screen.getByRole('button', { name: /Category/ }));
    await user.click(await screen.findByRole('option', { name: 'Agent' }));
    await user.type(screen.getByLabelText('Finding'), ' Missing filter ');
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
    expect(screen.getByLabelText('Finding')).toHaveValue(' Missing filter ');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await user.click(save());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [first, second] = post.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(second!.client_issue_id).toBe(first!.client_issue_id);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('a second press while the save is in flight sends nothing more', async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    post.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    open({ issue: two });
    await user.click(save());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Delete issue' }));
    expect(post).toHaveBeenCalledTimes(1);
    finish({ ok: true });
  });
});
