/**
 * C005: the Reviews edit form edits the one issue a correction holds, starts from the AI issue
 * on an AI candidate, offers the project catalog for Category, and saves every field of the issue
 * under its own name.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type { CorrectionRow, RootCauseIssue } from '@/api/reviews';

vi.mock('@/lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(async () => ({
        categories: ['Knowledge Gap', 'Agent behavior'],
        category_taxonomy: { 'Knowledge Gap': { description: 'The bot lacks the fact.' } },
      })),
    },
  };
});

import { editSeed } from '../DetailPane';
import { IssueEditForm } from '../IssueList';

const ai: RootCauseIssue = {
  issue_id: 'issue-1',
  category: 'Knowledge Gap',
  subcategory: 'Outdated policy',
  finding: 'The bot describes the old login-page reset flow.',
  category_reason: 'The policy changed after the knowledge snapshot.',
  solution: 'Refresh the policy index',
  solution_note: 'Weekly',
  confidence: 0.8,
};

function form(props: Partial<ComponentProps<typeof IssueEditForm>> = {}) {
  const onSave = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <IssueEditForm
          initial={[ai]}
          single
          projectSlug="demo"
          runHref="/projects/demo/runs/run-1?item=item-1"
          saving={false}
          onSave={onSave}
          onCancel={() => {}}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSave };
}

describe('Reviews edit form', () => {
  it('an AI candidate opens with the AI issue in every field', () => {
    const row = { human_root_cause_issues: [], ai_root_cause_issues: [ai] } as unknown as CorrectionRow;
    form({ initial: editSeed(row) });
    expect(screen.getByRole('button', { name: /Category/ })).toHaveTextContent('Knowledge Gap');
    expect(screen.getByLabelText('Subcategory')).toHaveValue('Outdated policy');
    expect(screen.getByLabelText('Finding')).toHaveValue(ai.finding);
    expect(screen.getByLabelText('Solution')).toHaveValue('Refresh the policy index');
    expect(screen.getByLabelText('Solution notes')).toHaveValue('Weekly');
  });

  it('a human diagnosis is the seed when there is one', () => {
    const human = { ...ai, finding: 'Human finding' };
    const row = { human_root_cause_issues: [human], ai_root_cause_issues: [ai] } as unknown as CorrectionRow;
    expect(editSeed(row)).toEqual([human]);
  });

  it('saving stores the new finding as the finding and keeps the subcategory', async () => {
    const user = userEvent.setup();
    const { onSave } = form();
    const finding = screen.getByLabelText('Finding');
    await user.clear(finding);
    await user.type(finding, 'EDITED FINDING: the bot gives the legacy reset flow.');
    await user.click(screen.getByTestId('edit-save'));
    expect(onSave).toHaveBeenCalledWith([
      {
        issue_id: 'issue-1',
        category: 'Knowledge Gap',
        subcategory: 'Outdated policy',
        finding: 'EDITED FINDING: the bot gives the legacy reset flow.',
        solution: 'Refresh the policy index',
        solution_note: 'Weekly',
      },
    ]);
  });

  it('a one-issue correction offers no second issue and links to the run page instead', () => {
    form();
    expect(screen.queryByRole('button', { name: '+ Add issue' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove issue/ })).toBeNull();
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Add another issue on the run page' })).toHaveAttribute(
      'href',
      '/projects/demo/runs/run-1?item=item-1',
    );
  });

  it('Category is the project catalog, with New category for a name that is not in it', async () => {
    const user = userEvent.setup();
    const { onSave } = form();
    await user.click(screen.getByRole('button', { name: /Category/ }));
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Knowledge Gap', 'Agent behavior', 'New category']);
    await user.click(within(listbox).getByRole('option', { name: 'New category' }));
    await user.type(screen.getByRole('textbox', { name: /^New category/ }), 'Policy drift');
    await user.click(screen.getByTestId('edit-save'));
    expect(onSave.mock.calls[0]![0][0]).toMatchObject({ category: 'Policy drift' });
  });

  it('a legacy grouped correction still edits its list of issues', () => {
    form({ single: false, initial: [ai, { ...ai, issue_id: 'issue-2', finding: 'Second' }] });
    expect(screen.getByRole('button', { name: '+ Add issue' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Remove issue/ })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Add another issue on the run page' })).toBeNull();
  });
});
