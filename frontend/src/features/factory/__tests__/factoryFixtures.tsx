/** Shared fixtures of the factory page tests: a factory, its rules, a generation attempt and its items. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { FactoryDetail, FactoryJob, FactoryList, FactoryRule, FactoryRulesList } from '@/api/factory';
import type { Project } from '@/api/types';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';
import { ToastProvider } from '@/ui';

export const project = {
  id: 'p1',
  name: 'Demo',
  slug: 'demo',
  is_active: true,
  role: 'MEMBER',
} as unknown as Project;

export const detail: FactoryDetail = {
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

export const RULES: FactoryRulesList = {
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

export const JOB: FactoryJob = {
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
  review: { pending: 4, approved: 2, rejected: 0, total: 6 },
};

/** The items of the attempt j1 (and of the j2 a test starts): three on layer 1, two on layer 2. */
export const ITEMS = {
  job_id: 'j1',
  factory_id: 'f1',
  total: 5,
  offset: 0,
  limit: 50,
  items: [
    ...['i1~L1.1', 'i1~L1.2', 'i2~L1.1'].map((id, n) => ({
      item_id: id,
      layer: 1,
      base_item_id: id.split('~')[0]!,
      parent_item_id: id.split('~')[0]!,
      rule: { id: n % 2 ? 'r2' : 'r1', title: n % 2 ? 'Greet back' : 'Amounts in SAR' },
      review: n === 0 ? 'approved' : 'pending',
      reviewed_by: n === 0 ? { id: 'mgr', display_name: 'Mgr', email: 'mgr@x.com' } : null,
      reviewed_at: n === 0 ? '2026-11-19T11:00:00Z' : null,
      created_at: '2026-11-19T10:01:00Z',
      missing: false,
      index: n,
      input: { question: `How do I pay in SAR? (${id})` },
      expected_output: `By card, in SAR (${id}).`,
      metadata: { topic: 'billing', factory: { layer: 1, rule_titles: [n % 2 ? 'Greet back' : 'Amounts in SAR'], note: 'Added the currency.' } },
      disabled: false,
    })),
    ...['i1~L1.1~L2.1', 'i1~L1.2~L2.1'].map((id, n) => ({
      item_id: id,
      layer: 2,
      base_item_id: 'i1',
      parent_item_id: id.slice(0, id.lastIndexOf('~')),
      rule: { id: n ? 'r1' : 'r2', title: n ? 'Amounts in SAR' : 'Greet back' },
      review: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      created_at: '2026-11-19T10:01:30Z',
      missing: false,
      index: 3 + n,
      input: { question: `Hello! How do I pay in SAR? (${id})` },
      expected_output: `Hello! By card, in SAR (${id}).`,
      metadata: { topic: 'billing', factory: { layer: 2, rule_titles: ['Amounts in SAR', 'Greet back'], note: 'Greeted back.' } },
      disabled: false,
    })),
  ],
  layers: [
    { layer: 1, pending: 2, approved: 1, rejected: 0, total: 3 },
    { layer: 2, pending: 2, approved: 0, rejected: 0, total: 2 },
  ],
  base_items: 2,
  review: { pending: 4, approved: 1, rejected: 0, total: 5 },
  dataset: { id: 'ds9', name: 'Faq generated 1', slug: 'faq-gen-1', deleted: false },
  dataset_version: { id: 'v9', version: 'v1', name: '', item_count: 5, status: 'draft', published_at: null },
  dataset_draft: true,
};

export const LIST: FactoryList = {
  project_id: 'p1',
  project_slug: 'demo',
  connected_dataset_ids: ['ds1'],
  factories: [detail],
};

export function stubFetch(
  over: { detail?: FactoryDetail; rules?: FactoryRulesList; list?: FactoryList; items?: typeof ITEMS } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/api/projects/demo/factories')) return body(over.list ?? LIST);
    if (/\/api\/factories\/f1\/rules\/r\d:(approve|revoke)$/.test(url))
      return body({ ...RULES.rules[1], official: url.endsWith(':approve') });
    if (/\/api\/factories\/f1\/rules\/r\d$/.test(url)) {
      const id = url.slice(url.lastIndexOf('/') + 1);
      const rule = (over.rules ?? RULES).rules.find((r) => r.id === id) ?? RULES.rules[0]!;
      return body({
        ...rule,
        evidence_items: rule.evidence.map((item_id) => ({
          item_id,
          input: { question: `Evidence ${item_id}: how do I pay?` },
          expected_output: `Evidence ${item_id}: by card.`,
          metadata: {},
          missing: false,
        })),
        source_version: detail.source_version,
      });
    }
    if (url.includes('/api/factories/f1/rules')) return body(over.rules ?? RULES);
    if (/\/api\/factories\/f1\/jobs\/j\d\/items:review$/.test(url)) {
      const sent = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return body({
        job_id: 'j1',
        review: sent.review,
        changed: Array.isArray(sent.item_ids) ? sent.item_ids.length : 4,
        applied_to_dataset: true,
        layers: ITEMS.layers,
        counts: ITEMS.review,
      });
    }
    if (/\/api\/factories\/f1\/jobs\/j\d\/items/.test(url)) return body(over.items ?? ITEMS);
    if (url.includes('/api/factories/f1/jobs') && init?.method === 'POST') {
      const sent = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return body({ ...JOB, id: 'j2', status: 'queued', kind: sent.kind, params: sent.params ?? {} }, 202);
    }
    if (/\/api\/factories\/f1\/jobs\/j\d$/.test(url)) return body({ ...JOB, id: url.slice(url.lastIndexOf('/') + 1) });
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

export function renderPage(
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
