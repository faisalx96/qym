/**
 * cv5 L2 and L3: the rule versions are a timeline, and the Rules tab shows one state and one action for the open
 * version. A released version is read-only: no Rule sources, no Generate rules, no Add rule.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisConfig, RuleVersion, RuleVersionsResponse } from '@/api/analysis';
import { ToastProvider } from '@/ui';

const start = vi.fn();
const createDraft = vi.fn();
let versions: RuleVersionsResponse;

vi.mock('@/api/analysis', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/api/analysis')>();
  return {
    ...real,
    useRuleVersions: () => ({ data: versions, isPending: false, isError: false }),
    useAnalysisConfig: () => ({
      data: {
        can_manage_analysis_rules: true,
        enabled_document_count: 1,
        approved_example_count: 2,
        default_connection_id: 'c1',
        llm_configured: true,
        analysis_limits: {},
      } as unknown as AnalysisConfig,
      isPending: false,
      isError: false,
    }),
    useCreateDraft: () => ({ mutateAsync: createDraft, isPending: false }),
    usePromoteVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSaveRules: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('../useRuleGenerator', () => ({
  useRuleGenerator: () => ({
    job: null,
    busy: false,
    cancelling: false,
    startError: null,
    start,
    cancel: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { RulesPanel } from './RulesPanel';

function version(n: number, status: RuleVersion['status'], extra: Partial<RuleVersion> = {}): RuleVersion {
  return {
    id: `id-${n}`,
    version: n,
    name: `v${n}`,
    description: '',
    status,
    rules: [{ id: `r${n}`, title: `Rule ${n}`, instruction: 'Do it' }],
    rule_count: 1,
    source: 'manual',
    parent_version_id: null,
    base_version_id: null,
    merge_parent_ids: [],
    aliases: [],
    is_active: false,
    is_deleted: false,
    created_by: { id: 'u1', display_name: 'Mei Chen' },
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-02T10:00:00Z',
    published_at: null,
    activated_at: null,
    ...extra,
  } as RuleVersion;
}

function renderPanel() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <RulesPanel scope={{ slug: 'demo' }} canManage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const versionRow = (name: string) =>
  within(screen.getByRole('list', { name: 'Versions' }))
    .getAllByRole('button')
    .find((b) => b.textContent?.startsWith(name))!;

describe('RulesPanel (cv5 L2, L3)', () => {
  beforeEach(() => {
    start.mockReset();
    createDraft.mockReset();
    versions = {
      versions: [version(3, 'published'), version(5, 'draft'), version(4, 'published', { is_active: true })],
      production_version_id: 'id-4',
      can_delete: true,
      can_activate: true,
      can_restore: true,
    } as RuleVersionsResponse;
  });

  it('lists the versions as a timeline, newest first, with the state of each', () => {
    renderPanel();
    const rows = within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-key'))).toEqual(['id-5', 'id-4', 'id-3']);
    expect(rows[0]!.textContent).toContain('Draft');
    expect(rows[1]!.textContent).toContain('Production');
    expect(rows[2]!.textContent).not.toMatch(/Draft|Production|Published/);
    // the row menu is inside each row
    expect(within(rows[2]!).getByRole('button', { name: 'Actions for v3' })).toBeTruthy();
    // no create button above the list
    expect(screen.queryByRole('button', { name: /^Create draft/ })).toBeNull();
  });

  it('a draft: Publish in the header, Add rule as the primary create action, Rule sources with Generate rules', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Rules in v5' })).toBeTruthy();
    expect(screen.queryByText('Editable draft')).toBeNull();
    expect(screen.queryByText('Read-only')).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Add rule' });
    expect(add.getAttribute('data-variant') ?? add.className).toMatch(/primary/);
    const sources = screen.getByRole('region', { name: 'Rule sources' });
    expect(sources.textContent).toContain('Generate rules asks the LLM to write new rules into this draft');
    fireEvent.click(within(sources).getByRole('button', { name: 'Generate rules' }));
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ rule_version_id: 'id-5', mode: 'generate' }),
    );
  });

  it('the production version is read-only and offers the open draft, not Generate rules', () => {
    renderPanel();
    fireEvent.click(versionRow('v4'));
    expect(screen.getByRole('heading', { name: 'Rules in v4' })).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Rule sources' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate rules' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Create draft/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open draft v5' }));
    expect(screen.getByRole('heading', { name: 'Rules in v5' })).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
  });

  it('with no draft, a released version offers one Create draft from it', () => {
    versions = { ...versions, versions: versions.versions.filter((v) => v.status !== 'draft') };
    createDraft.mockResolvedValue({ version: version(6, 'draft') });
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Rules in v4' })).toBeTruthy();
    const create = screen.getAllByRole('button', { name: /^Create draft/ });
    expect(create).toHaveLength(1);
    expect(create[0]!.textContent).toBe('Create draft from v4');
    fireEvent.click(create[0]!);
    expect(createDraft).toHaveBeenCalledWith('id-4');
    expect(screen.queryByRole('button', { name: 'Generate rules' })).toBeNull();
  });
});
