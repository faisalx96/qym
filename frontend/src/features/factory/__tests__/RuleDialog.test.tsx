/**
 * The rule editor's bridge controls: a bridge extends an item into other groups of the grouping key, so its targets
 * are groups (the known ones as chips, more by name), never its own group, and never a category.
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
  group_metadata_key: 'tables',
  metadata_keys: [
    { key: 'tables', kind: 'list', values: ['customers', 'orders'], value_count: 2, truncated: false },
  ],
} as unknown as FactoryDetail;

const bridge = {
  id: 'r1',
  factory_id: 'f1',
  category_id: 'c1',
  category_key: 'general',
  category_name: 'General',
  categories: [{ id: 'c1', key: 'general', name: 'General' }],
  kind: 'bridge',
  bridge_to: ['orders'],
  group_value: 'customers',
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
              groups={['customers', 'shipments']}
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
  it('offers the other groups as targets, with the stored ones on, and takes more by name', async () => {
    const onSave = mount(bridge);
    const dialog = await screen.findByTestId('rule-dialog');
    // The key's values and the groups with rules, the rule's own group (customers) left out.
    expect(chips(dialog, 'Bridges into')).toEqual(['orders:true', 'shipments:false']);
    expect(chips(dialog, 'Also in')).toEqual(['Joins:false']);
    await userEvent.click(
      within(within(dialog).getByRole('group', { name: 'Bridges into' })).getByRole('button', {
        name: 'shipments',
      }),
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Other groups' }),
      'invoices, customers ,orders',
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).not.toBeDisabled();
    await userEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Typed groups join the chips, distinct, the own group dropped; categories are untouched.
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      category_id: 'c1',
      category_ids: [],
      kind: 'bridge',
      group_value: 'customers',
      bridge_to_groups: ['orders', 'shipments', 'invoices'],
    });
  });

  it('needs a group before a new bridge saves and sends none for a plain rule', async () => {
    const onSave = mount(null);
    const dialog = await screen.findByTestId('rule-dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Bridge');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Bridge' }));
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    await userEvent.click(
      within(within(dialog).getByRole('group', { name: 'Bridges into' })).getByRole('button', {
        name: 'orders',
      }),
    );
    expect(screen.getByRole('button', { name: 'Add rule' })).not.toBeDisabled();
    // Back to a plain rule: no groups are sent.
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Rule' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ kind: 'rule', bridge_to_groups: [] });
  });
});
