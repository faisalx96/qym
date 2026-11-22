import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryDetail, FactoryJob, FactoryList, FactoryRule, FactoryRulesList } from '@/api/factory';
import type { Project } from '@/api/types';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';
import { ToastProvider } from '@/ui';
import { FactoryDetailPage } from '../FactoryDetailPage';
import { FactoryListPage } from '../FactoryListPage';
import { parseFactoryRoute, factoryPath } from '../lib/route';
import { parseJsonObject } from '../dialogs';

const project = {
  id: 'p1',
  name: 'Demo',
  slug: 'demo',
  is_active: true,
  role: 'MEMBER',
} as unknown as Project;

const detail: FactoryDetail = {
  id: 'f1',
  project_id: 'p1',
  project_slug: 'demo',
  dataset: { id: 'ds1', name: 'Faq', slug: 'faq', deleted: false },
  group_metadata_key: 'topic',
  llm_connection: null,
  access_mode: 'project',
  analysis_instructions: '',
  generation_instructions: '',
  created_by: { id: 'mgr', display_name: 'Mgr', email: 'mgr@x.com' },
  last_analyzed_at: '2026-11-19T10:00:00Z',
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-19T10:00:00Z',
  counts: { categories: 2, rules: 2, official_rules: 1, jobs: 1, active_jobs: 0 },
  permissions: {
    access_level: 'approve',
    can_modify: true,
    can_approve: true,
    can_manage_access: false,
    can_disconnect: false,
    is_creator: false,
  },
  categories: [
    {
      id: 'c1',
      factory_id: 'f1',
      key: 'general',
      name: 'General',
      description: 'Any rule',
      json_schema: null,
      position: 0,
      rule_count: 1,
      created_at: null,
      updated_at: null,
    },
    {
      id: 'c2',
      factory_id: 'f1',
      key: 'format',
      name: 'Format',
      description: 'Shape of the answer',
      json_schema: { type: 'object', required: ['field'] },
      position: 1,
      rule_count: 1,
      created_at: null,
      updated_at: null,
    },
  ],
  source_version: {
    id: 'v',
    version: 'v3',
    name: '',
    item_count: 120,
    status: 'published',
    published_at: null,
  },
  metadata_keys: [
    { key: 'topic', kind: 'scalar', values: ['billing', 'shipping'], value_count: 2, truncated: false },
  ],
  llm_connections: [{ id: 'llm1', name: 'default', model: 'gpt-x', is_default: true, has_api_key: true }],
  active_job: null,
  generation_limits: {
    max_layers: 5,
    max_branching: 10,
    max_items: 5000,
    defaults: { max_layers: 1, branching: 3, max_items: 500, official_only: true },
  },
};

function rule(over: Partial<FactoryRule> & { id: string; title: string }): FactoryRule {
  return {
    factory_id: 'f1',
    category_id: 'c1',
    category_key: 'general',
    category_name: 'General',
    categories: [{ id: 'c1', key: 'general', name: 'General' }],
    kind: 'rule',
    bridge_to: [],
    group_value: 'billing',
    description: `${over.title} rule`,
    body: null,
    official: false,
    source: 'agent',
    evidence: ['i1'],
    job_id: 'j1',
    created_by: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-11-19T10:00:00Z',
    updated_at: '2026-11-19T10:00:00Z',
    ...over,
  };
}

const RULES: FactoryRulesList = {
  factory_id: 'f1',
  total: 2,
  rules: [
    rule({
      id: 'r1',
      title: 'Amounts in SAR',
      official: true,
      approved_by: { id: 'mgr', display_name: 'Mgr', email: 'mgr@x.com' },
    }),
    rule({ id: 'r2', title: 'Greet back', group_value: '', source: 'manual', evidence: [] }),
  ],
  groups: [
    { value: 'billing', count: 1, official: 1 },
    { value: '', count: 1, official: 0 },
  ],
};

const JOB: FactoryJob = {
  id: 'j1',
  factory_id: 'f1',
  kind: 'generation',
  status: 'succeeded',
  params: { max_layers: 2, branching: 3, max_items: 500, official_only: true },
  progress: { message: '6 items generated', generated: 6, max_items: 500, layer: 2, layers: 2 },
  error: null,
  output_dataset: { id: 'ds9', name: 'Faq generated 1', slug: 'faq-gen-1', deleted: false },
  requested_by: { id: 'me', display_name: 'Me', email: 'me@x.com' },
  created_at: '2026-11-19T10:00:00Z',
  started_at: '2026-11-19T10:00:01Z',
  finished_at: '2026-11-19T10:02:00Z',
  updated_at: '2026-11-19T10:02:00Z',
};

const LIST: FactoryList = {
  project_id: 'p1',
  project_slug: 'demo',
  connected_dataset_ids: ['ds1'],
  factories: [detail],
};

function stubFetch(over: { detail?: FactoryDetail; rules?: FactoryRulesList; list?: FactoryList } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/api/projects/demo/factories')) return body(over.list ?? LIST);
    if (/\/api\/factories\/f1\/rules\/r\d:(approve|revoke)$/.test(url))
      return body({ ...RULES.rules[1], official: url.endsWith(':approve') });
    if (url.includes('/api/factories/f1/rules')) return body(over.rules ?? RULES);
    if (url.includes('/api/factories/f1/jobs') && init?.method === 'POST') {
      const sent = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return body({ ...JOB, id: 'j2', status: 'queued', kind: sent.kind, params: sent.params ?? {} }, 202);
    }
    if (url.includes('/api/factories/f1/jobs')) return body({ factory_id: 'f1', jobs: [JOB] });
    if (url.includes('/api/factories/f1/access'))
      return body({
        access_mode: 'project',
        grants: [],
        can_manage_access: false,
        candidates: [],
        your_level: 'approve',
        levels: ['view', 'modify', 'approve'],
      });
    if (url.includes('/api/factories/f1')) return body(over.detail ?? detail);
    return body({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(
  ui: React.ReactElement,
  value: Partial<ProjectValue> = {},
  path = '/projects/demo/factory/f1',
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ctx: ProjectValue = {
    project,
    slug: 'demo',
    readOnly: false,
    archived: false,
    viewer: false,
    canManage: false,
    ...value,
  } as ProjectValue;
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <ProjectContext.Provider value={ctx}>{ui}</ProjectContext.Provider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('factory routes', () => {
  it('parses the list, the detail and its tab', () => {
    expect(parseFactoryRoute('', new URLSearchParams())).toEqual({
      mode: 'list',
      factoryId: null,
      tab: 'rules',
    });
    expect(parseFactoryRoute('f1', new URLSearchParams('tab=access'))).toEqual({
      mode: 'detail',
      factoryId: 'f1',
      tab: 'access',
    });
    expect(parseFactoryRoute('f1/extra', new URLSearchParams('tab=nope'))).toEqual({
      mode: 'detail',
      factoryId: 'f1',
      tab: 'rules',
    });
    expect(factoryPath('demo', 'f1', 'generation')).toBe('/projects/demo/factory/f1?tab=generation');
    expect(factoryPath('demo')).toBe('/projects/demo/factory');
  });

  it('parses a JSON object or names the problem', () => {
    expect(parseJsonObject('')).toEqual({ value: null, error: null });
    expect(parseJsonObject('{"type": "object"}')).toEqual({ value: { type: 'object' }, error: null });
    expect(parseJsonObject('[1]').error).toMatch(/JSON object/);
    expect(parseJsonObject('{nope').error).toMatch(/not valid JSON/);
  });
});

describe('FactoryListPage', () => {
  it('lists the connected datasets with their counts and grouping', async () => {
    stubFetch();
    renderPage(<FactoryListPage />, {}, '/projects/demo/factory');
    const card = await screen.findByTestId('factory-card');
    expect(within(card).getByRole('heading', { name: 'Faq' })).toBeInTheDocument();
    expect(within(card).getByText('2 rules')).toBeInTheDocument();
    expect(within(card).getByText('1 official')).toBeInTheDocument();
    expect(within(card).getByText('topic')).toBeInTheDocument();
    expect(screen.getByTestId('connect-dataset')).toBeInTheDocument();
    expect(screen.getByText('1 connected dataset')).toBeInTheDocument();
  });

  it('shows the empty state without the action when read-only', async () => {
    stubFetch({ list: { ...LIST, factories: [], connected_dataset_ids: [] } });
    renderPage(<FactoryListPage />, { readOnly: true }, '/projects/demo/factory');
    expect(await screen.findByText('No dataset is connected yet')).toBeInTheDocument();
    expect(screen.queryByTestId('connect-dataset')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect dataset' })).toBeNull();
  });
});

describe('FactoryDetailPage', () => {
  it('shows the rules with their status and approves a proposed one', async () => {
    const fetchMock = stubFetch();
    renderPage(<FactoryDetailPage factoryId="f1" />);
    expect(await screen.findByRole('heading', { name: 'Faq' })).toBeInTheDocument();
    expect(screen.getByText('Connected dataset · v3 · 120 items')).toBeInTheDocument();
    await screen.findByText('Amounts in SAR');
    expect(screen.getByText('Greet back')).toBeInTheDocument();
    expect(screen.getAllByText('Official')).not.toHaveLength(0);
    expect(screen.getAllByText('Proposed')).not.toHaveLength(0);
    // The official rule offers "take back", the proposed one "make official".
    expect(screen.getByTestId('rule-revoke')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('rule-approve'));
    await waitFor(() => {
      const approve = fetchMock.mock.calls.find(([u]) =>
        String(u).endsWith('/api/factories/f1/rules/r2:approve'),
      );
      expect(approve).toBeTruthy();
      expect((approve![1] as RequestInit).method).toBe('POST');
    });
  });

  it('starts a generation with the chosen parameters and opens the Generation tab', async () => {
    const fetchMock = stubFetch();
    renderPage(<FactoryDetailPage factoryId="f1" />);
    await screen.findByText('Amounts in SAR');
    await userEvent.click(screen.getByTestId('generate'));
    const dialog = await screen.findByTestId('generate-dialog');
    expect(within(dialog).getByTestId('generate-estimate').textContent).toMatch(
      /120 base items \(v3\), up to 360 generated items, 1 official rule/,
    );
    const layers = within(dialog).getByRole('textbox', { name: 'Max layers' });
    await userEvent.clear(layers);
    await userEvent.type(layers, '2');
    await userEvent.click(screen.getByTestId('factory-dialog-submit'));
    await waitFor(() => {
      const start = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/api/factories/f1/jobs') && (i as RequestInit).method === 'POST',
      );
      expect(start).toBeTruthy();
      const sent = JSON.parse(String((start![1] as RequestInit).body)) as {
        kind: string;
        params: Record<string, unknown>;
      };
      expect(sent.kind).toBe('generation');
      expect(sent.params).toMatchObject({
        max_layers: 2,
        branching: 3,
        max_items: 500,
        official_only: true,
        group_values: null,
        dataset_name: null,
      });
    });
    expect(await screen.findByTestId('generation-tab')).toBeInTheDocument();
    expect(await screen.findByTestId('job-dataset')).toHaveTextContent('Faq generated 1');
    expect(screen.getByText(/6 items of at most 500 · layer 2 of 2/)).toBeInTheDocument();
  });

  it('hides every change control for a viewer and shows the running job line', async () => {
    const job: FactoryJob = {
      ...JOB,
      id: 'j3',
      status: 'running',
      progress: { message: 'Layer 1 of 2: 4 item(s) generated' },
    };
    stubFetch({
      detail: {
        ...detail,
        active_job: job,
        permissions: { ...detail.permissions, access_level: 'view', can_modify: false, can_approve: false },
      },
    });
    renderPage(<FactoryDetailPage factoryId="f1" />, { readOnly: true, viewer: true });
    await screen.findByText('Amounts in SAR');
    expect(screen.queryByTestId('generate')).toBeNull();
    expect(screen.queryByTestId('analyze')).toBeNull();
    expect(screen.queryByTestId('add-rule')).toBeNull();
    expect(screen.queryByTestId('rule-approve')).toBeNull();
    const notice = screen.getByTestId('active-job');
    expect(notice).toHaveTextContent('Generation running.');
    expect(notice).toHaveTextContent('Layer 1 of 2: 4 item(s) generated');
    expect(screen.queryByTestId('cancel-job')).toBeNull();
  });
});
