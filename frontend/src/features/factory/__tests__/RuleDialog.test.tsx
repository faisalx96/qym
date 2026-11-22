/**
 * The rule editor's bridge controls. Regression: a bridge's targets were the categories the rule was not in, so
 * in a two-category factory a bridge could take no further category and moving its primary category into its
 * target dropped the bridge and blocked Save. Every category is a possible target now.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { FactoryDetail, FactoryRule, RuleWrite } from '@/api/factory';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';
import { ToastProvider } from '@/ui';
import { RuleDialog } from '../dialogs';

function category(id: string, name: string) {
  return {
    id,
    factory_id: 'f1',
    key: name.toLowerCase(),
    name,
    description: '',
    json_schema: null,
    position: 0,
    rule_count: 0,
    created_at: null,
    updated_at: null,
  };
}

const factory = {
  id: 'f1',
  categories: [category('c1', 'General'), category('c2', 'Joins')],
  group_metadata_key: null,
} as unknown as FactoryDetail;

const bridge = {
  id: 'r1',
  factory_id: 'f1',
  category_id: 'c1',
  category_key: 'general',
  category_name: 'General',
  categories: [{ id: 'c1', key: 'general', name: 'General' }],
  kind: 'bridge',
  bridge_to: [{ id: 'c2', key: 'joins', name: 'Joins' }],
  group_value: '',
  title: 'Join orders',
  description: 'Joins the orders table.',
  body: null,
  official: false,
  source: 'agent',
  evidence: [],
  job_id: null,
  created_by: null,
  approved_by: null,
  approved_at: null,
  created_at: null,
  updated_at: null,
} as unknown as FactoryRule;

function mount(existing: FactoryRule | null) {
  const onSave = vi.fn<(values: RuleWrite) => Promise<unknown>>(async () => ({}));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <ProjectContext.Provider value={{ slug: 'demo' } as ProjectValue}>
            <RuleDialog
              open
              onOpenChange={() => undefined}
              factory={factory}
              groups={[]}
              existing={existing}
              onSave={onSave}
            />
          </ProjectContext.Provider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onSave;
}

function chips(dialog: HTMLElement, name: string) {
  const group = within(dialog).getByRole('group', { name });
  return within(group)
    .getAllByRole('button')
    .map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`);
}

describe('RuleDialog bridges', () => {
  it('files a bridge in the category it opens and keeps the target', async () => {
    const onSave = mount(bridge);
    const dialog = await screen.findByTestId('rule-dialog');
    expect(chips(dialog, 'Also in')).toEqual(['Joins:false']);
    expect(chips(dialog, 'Bridges into')).toEqual(['General:false', 'Joins:true']);
    await userEvent.click(
      within(within(dialog).getByRole('group', { name: 'Also in' })).getByRole('button', { name: 'Joins' }),
    );
    expect(chips(dialog, 'Bridges into')).toEqual(['General:false', 'Joins:true']);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).not.toBeDisabled();
    await userEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      category_id: 'c1',
      category_ids: ['c2'],
      kind: 'bridge',
      bridge_to_category_ids: ['c2'],
    });
  });

  it('keeps the target when the primary category becomes that target', async () => {
    const onSave = mount(bridge);
    const dialog = await screen.findByTestId('rule-dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Category/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Joins/ }));
    expect(chips(dialog, 'Also in')).toEqual(['General:false']);
    expect(chips(dialog, 'Bridges into')).toEqual(['General:false', 'Joins:true']);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      category_id: 'c2',
      category_ids: [],
      kind: 'bridge',
      bridge_to_category_ids: ['c2'],
    });
  });

  it('needs a target before a new bridge saves', async () => {
    const onSave = mount(null);
    const dialog = await screen.findByTestId('rule-dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Bridge');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Bridge' }));
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    await userEvent.click(
      within(within(dialog).getByRole('group', { name: 'Bridges into' })).getByRole('button', {
        name: 'General',
      }),
    );
    const add = screen.getByRole('button', { name: 'Add rule' });
    expect(add).not.toBeDisabled();
    await userEvent.click(add);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      category_id: 'c1',
      kind: 'bridge',
      bridge_to_category_ids: ['c1'],
    });
  });
});
