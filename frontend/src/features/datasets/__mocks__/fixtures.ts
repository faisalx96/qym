/* Static fixtures for the datasets / reviews / trash design mocks (brief 07 §4 shapes). */

export interface User {
  id: number;
  email: string;
  display_name: string;
}
export interface Version {
  id: number;
  version: string;
  name: string;
  status: 'draft' | 'published';
  item_count: number;
  run_count: number;
  aliases: string[];
  created_by: User | null;
  published_by: User | null;
  created_at: string;
  published_at: string | null;
  parent_version_id: number | null;
}
export interface Dataset {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  tags: string[];
  private_test_set: boolean;
  items_visible: boolean;
  run_count: number;
  created_by: User | null;
  updated_at: string;
  production_version: Version | null;
  latest_version: Version | null;
  permissions: { can_manage: boolean; can_delete: boolean; can_set_production: boolean };
}
export interface Item {
  id: number;
  item_id: string;
  index: number;
  input: unknown;
  expected_output: unknown;
  metadata: Record<string, unknown>;
  labels: string[];
  updated_at: string;
  created_at: string;
  run_count: number;
  edit_count: number;
  result_summary: {
    run_count: number;
    avg_latency_ms: number | null;
    metrics: Record<string, { avg: number | null }>;
  } | null;
}
export interface Issue {
  category: string;
  subcategory?: string;
  finding: string;
  category_reason?: string;
  confidence?: number;
}
export interface Correction {
  id: number;
  item_id: string;
  run_id: string;
  run_name: string;
  task: string;
  dataset: string;
  model: string;
  has_reasoning: boolean;
  metric_name: string | null;
  pass_number: number | null;
  project_slug: string;
  project_name: string;
  status: 'pending' | 'approved' | 'rejected';
  ai_confidence: number | null;
  ai_root_cause_issues: Issue[];
  human_root_cause_issues: Issue[];
  corrected_by: User | null;
  created_at: string;
  reviewed_by: User | null;
  reviewed_at: string | null;
  review_comment: string | null;
  self_reviewed: boolean;
  review_block: string | null;
  input_preview: string;
  expected_preview: string;
  output_preview: string;
  scores_snapshot: Record<string, number>;
  item_metadata: Record<string, unknown>;
}
export interface TrashRow {
  id: string;
  run_name: string;
  task: string;
  dataset: string;
  model: string;
  has_reasoning: boolean;
  status: 'completed' | 'failed' | 'stopped';
  deleted_at: string;
  deleted_by_name: string;
  purge_at: string | null;
  purge_paused: boolean;
  project_archived: boolean;
  project_id: number;
  project_name: string;
  project_slug: string;
}

export const dev: User = { id: 1, email: 'dev@local', display_name: 'Dev User' };
export const sara: User = { id: 2, email: 'sara@acme.example', display_name: 'Sara Al-Harbi' };
export const omar: User = { id: 3, email: 'omar@acme.example', display_name: 'Omar Haddad' };

export const versions: Version[] = [
  {
    id: 3,
    version: 'v3',
    name: 'refund policy fixes',
    status: 'draft',
    item_count: 322,
    run_count: 0,
    aliases: [],
    created_by: sara,
    published_by: null,
    created_at: '2026-10-10T14:02:00Z',
    published_at: null,
    parent_version_id: 2,
  },
  {
    id: 2,
    version: 'v2',
    name: 'arabic expansion',
    status: 'published',
    item_count: 320,
    run_count: 1,
    aliases: [],
    created_by: dev,
    published_by: dev,
    created_at: '2026-10-03T09:12:00Z',
    published_at: '2026-10-04T08:00:00Z',
    parent_version_id: 1,
  },
  {
    id: 1,
    version: 'v1',
    name: 'initial import',
    status: 'published',
    item_count: 300,
    run_count: 1,
    aliases: ['production'],
    created_by: dev,
    published_by: dev,
    created_at: '2026-09-20T10:00:00Z',
    published_at: '2026-09-20T10:30:00Z',
    parent_version_id: null,
  },
];

export const dataset: Dataset = {
  id: 11,
  name: 'Support QA',
  slug: 'support-qa',
  description: 'Customer support questions with gold answers. Mixed Arabic/English.',
  tags: ['support', 'rag'],
  private_test_set: false,
  items_visible: true,
  run_count: 2,
  created_by: dev,
  updated_at: '2026-10-11T07:40:00Z',
  production_version: versions[2]!,
  latest_version: versions[0]!,
  permissions: { can_manage: true, can_delete: true, can_set_production: true },
};

export const privateDataset: Dataset = {
  ...dataset,
  id: 12,
  name: 'Hidden eval set',
  slug: 'hidden-eval-set',
  description: 'Held-out test set. Item contents are visible to admins only.',
  tags: ['holdout'],
  private_test_set: true,
  items_visible: false,
  run_count: 1,
  permissions: { can_manage: false, can_delete: false, can_set_production: false },
};

export const metricNames = ['exact_match', 'fuzzy_match'];

const AR_Q = [
  'ما هي سياسة الاسترجاع للطلب رقم',
  'كيف يمكنني تغيير عنوان الشحن للطلب',
  'هل يمكنني إلغاء الاشتراك قبل نهاية الشهر',
];
const AR_A = ['يمكنك إرجاع المنتج خلال 30 يوماً', 'يمكن تغيير العنوان قبل الشحن فقط', 'نعم، الإلغاء متاح في أي وقت'];
const TOPICS = ['refunds', 'shipping', 'billing'];

function makeItem(i: number): Item {
  const arabic = i % 5 === 0 && i > 0;
  const json = i % 7 === 3;
  const idx = i % 3;
  const input = json
    ? { question: `What is the refund policy for order #${i}?`, context: 'RAG context: returns accepted within 30 days…' }
    : arabic
      ? `${AR_Q[idx]} ${i}؟`
      : `What is the refund policy for order #${i}?`;
  const expected = arabic ? AR_A[idx]! : `Refunds within 30 days for order #${i}.`;
  const em = i % 4 === 0 ? 0 : 1;
  const fm = Math.max(0, Math.min(1, 0.55 + ((i * 37) % 45) / 100));
  return {
    id: 1000 + i,
    item_id: `q-${String(i).padStart(3, '0')}`,
    index: i,
    input,
    expected_output: i === 4 ? '42' : expected,
    metadata: { topic: TOPICS[idx], difficulty: (i % 3) + 1 },
    labels: i % 6 === 0 ? ['golden'] : [],
    updated_at: '2026-10-10T14:02:00Z',
    created_at: '2026-09-20T10:00:00Z',
    run_count: 2,
    edit_count: i === 4 ? 1 : 0,
    result_summary: {
      run_count: 2,
      avg_latency_ms: 180 + ((i * 53) % 400),
      metrics: { exact_match: { avg: em }, fuzzy_match: { avg: fm } },
    },
  };
}

export const items: Item[] = Array.from({ length: 24 }, (_, i) => makeItem(i));
export const itemsTotal = 322;

export const draftVersion = versions[0]!;
export const productionVersion = versions[2]!;

const runName = 'support-claude-3-5-sonnet-20261011';

function correction(
  id: number,
  partial: Partial<Correction> & Pick<Correction, 'item_id' | 'status' | 'ai_root_cause_issues' | 'human_root_cause_issues'>,
): Correction {
  return {
    id,
    run_id: 'b1f5c2d4-8e7a-4f6b-9c3d-2a1e0f9b8c7d',
    run_name: runName,
    task: 'main.<locals>.task',
    dataset: 'Support QA',
    model: 'claude-3-5-sonnet',
    has_reasoning: false,
    metric_name: 'exact_match',
    pass_number: 1,
    project_slug: 'acme',
    project_name: 'Acme Support',
    ai_confidence: 0.62,
    corrected_by: sara,
    created_at: '2026-10-11T19:18:00Z',
    reviewed_by: null,
    reviewed_at: null,
    review_comment: null,
    self_reviewed: false,
    review_block: null,
    input_preview: `question: What is the refund policy for order #${id}? · context: RAG context RAG context…`,
    expected_preview: `Refunds within 30 days for order #${id}.`,
    output_preview: 'I do not know. citations: [1, 2]',
    scores_snapshot: { exact_match: 0, fuzzy_match: 0.31 },
    item_metadata: { topic: 'refunds', difficulty: 2 },
    ...partial,
  };
}

export const corrections: Correction[] = [
  correction(1, {
    item_id: 'q-000',
    status: 'pending',
    ai_confidence: 0.41,
    ai_root_cause_issues: [
      {
        category: 'Generation',
        subcategory: 'Hallucination',
        finding: 'The model answered without citing the refund policy passage.',
        category_reason: 'Output contradicts the retrieved context.',
        confidence: 0.41,
      },
    ],
    human_root_cause_issues: [
      {
        category: 'Retrieval',
        subcategory: 'Missing context',
        finding: 'The retriever returned no passage about refunds (item 0).',
      },
    ],
    input_preview: 'question: ما هي سياسة الاسترجاع للطلب رقم ٠؟ · context: RAG context RAG context…',
    expected_preview: 'يمكنك إرجاع المنتج خلال 30 يوماً',
  }),
  correction(2, {
    item_id: 'q-003',
    status: 'pending',
    ai_confidence: null,
    ai_root_cause_issues: [],
    human_root_cause_issues: [
      { category: 'Retrieval', subcategory: 'Missing context', finding: 'No passage about order #3 was retrieved.' },
    ],
  }),
  correction(3, {
    item_id: 'q-005',
    status: 'pending',
    ai_confidence: 0.88,
    corrected_by: dev,
    review_block: 'You submitted this correction; project rules require a different reviewer.',
    ai_root_cause_issues: [
      { category: 'Generation', subcategory: 'Format', finding: 'Answer is in English although the question is Arabic.', confidence: 0.88 },
    ],
    human_root_cause_issues: [
      { category: 'Generation', subcategory: 'Format', finding: 'Answer is in English although the question is Arabic.' },
    ],
    input_preview: 'question: كيف يمكنني تغيير عنوان الشحن للطلب ٥؟',
    expected_preview: 'يمكن تغيير العنوان قبل الشحن فقط',
    output_preview: 'You can change the address before shipping.',
  }),
  correction(4, {
    item_id: 'q-008',
    status: 'pending',
    ai_confidence: 0.73,
    ai_root_cause_issues: [
      { category: 'Retrieval', subcategory: 'Ranking', finding: 'Correct passage ranked 4th; only top-3 used.', confidence: 0.73 },
    ],
    human_root_cause_issues: [
      { category: 'Retrieval', subcategory: 'Ranking', finding: 'Correct passage ranked 4th; only top-3 used.' },
      { category: 'Prompt', subcategory: 'Instructions', finding: 'Prompt does not ask the model to say "I do not know" when unsure.' },
    ],
  }),
  correction(5, {
    item_id: 'q-010',
    status: 'pending',
    ai_confidence: 0.35,
    corrected_by: omar,
    created_at: '2026-09-25T11:00:00Z',
    ai_root_cause_issues: [
      { category: 'Generation', subcategory: 'Truncation', finding: 'Output stops mid-sentence.', confidence: 0.35 },
    ],
    human_root_cause_issues: [
      { category: 'Generation', subcategory: 'Truncation', finding: 'الإجابة توقفت في منتصف الجملة بسبب حد الرموز.' },
    ],
    input_preview: 'question: هل يمكنني إلغاء الاشتراك قبل نهاية الشهر؟',
    expected_preview: 'نعم، الإلغاء متاح في أي وقت',
    output_preview: 'نعم، يمكنك إلغاء الاشتراك في',
  }),
  correction(6, {
    item_id: 'q-012',
    status: 'pending',
    ai_confidence: 0.57,
    ai_root_cause_issues: [
      { category: 'Evaluation', subcategory: 'Metric', finding: 'exact_match penalises a correct paraphrase.', confidence: 0.57 },
    ],
    human_root_cause_issues: [
      { category: 'Evaluation', subcategory: 'Metric', finding: 'exact_match penalises a correct paraphrase.' },
    ],
  }),
  correction(7, {
    item_id: 'q-014',
    status: 'pending',
    ai_confidence: 0.66,
    ai_root_cause_issues: [
      { category: 'Retrieval', subcategory: 'Chunking', finding: 'Policy table split across two chunks.', confidence: 0.66 },
    ],
    human_root_cause_issues: [
      { category: 'Retrieval', subcategory: 'Chunking', finding: 'Policy table split across two chunks.' },
    ],
  }),
  correction(8, {
    item_id: 'q-001',
    status: 'approved',
    reviewed_by: dev,
    reviewed_at: '2026-10-11T19:40:00Z',
    review_comment: 'Agreed, retrieval gap.',
    ai_root_cause_issues: [
      { category: 'Retrieval', subcategory: 'Missing context', finding: 'No refund passage retrieved.', confidence: 0.8 },
    ],
    human_root_cause_issues: [
      { category: 'Retrieval', subcategory: 'Missing context', finding: 'No refund passage retrieved.' },
    ],
  }),
  correction(9, {
    item_id: 'q-002',
    status: 'approved',
    reviewed_by: omar,
    reviewed_at: '2026-10-11T19:42:00Z',
    review_comment: null,
    self_reviewed: true,
    ai_root_cause_issues: [],
    human_root_cause_issues: [{ category: 'Prompt', finding: 'System prompt lacks the refund window.' }],
  }),
  correction(10, {
    item_id: 'q-006',
    status: 'rejected',
    reviewed_by: dev,
    reviewed_at: '2026-10-11T19:50:00Z',
    review_comment: 'The AI diagnosis was right; the human one blames the prompt without evidence.',
    ai_root_cause_issues: [
      { category: 'Generation', subcategory: 'Hallucination', finding: 'Invented a 60-day window.', confidence: 0.9 },
    ],
    human_root_cause_issues: [{ category: 'Prompt', finding: 'Prompt is ambiguous.' }],
  }),
];

export const reviewFacets = {
  tasks: [{ key: 'main.<locals>.task', label: 'main.<locals>.task', count: 10 }],
  datasets: [
    { key: 'Support QA', label: 'Support QA', count: 9 },
    { key: 'Hidden eval set', label: 'Hidden eval set', count: 1 },
  ],
  models: [
    { key: 'claude-3-5-sonnet', label: 'claude-3-5-sonnet', count: 8 },
    { key: 'gpt-4o-mini', label: 'gpt-4o-mini', count: 2 },
  ],
  runs: [
    { key: runName, label: runName, count: 8 },
    { key: 'nightly-gpt-4o-mini-20261010', label: 'nightly-gpt-4o-mini-20261010', count: 2 },
  ],
};

export const trashRows: TrashRow[] = [
  {
    id: '1ddfd307-e06a-46cd-adfc-2c1b9d0e4f11',
    run_name: 'doomed-run-b-gpt-4o-mini-20261011',
    task: 'task',
    dataset: 'Support QA',
    model: 'gpt-4o-mini',
    has_reasoning: false,
    status: 'completed',
    deleted_at: '2026-10-11T08:12:00Z',
    deleted_by_name: 'Dev User',
    purge_at: '2026-10-13T08:12:00Z',
    purge_paused: false,
    project_archived: false,
    project_id: 1,
    project_name: 'Acme Support',
    project_slug: 'acme',
  },
  {
    id: '46244094-3b4b-4abe-8334-0d2e7a9c5b60',
    run_name: 'doomed-run-a-gpt-4o-mini-20261011',
    task: 'task',
    dataset: 'Support QA',
    model: 'gpt-4o-mini',
    has_reasoning: false,
    status: 'failed',
    deleted_at: '2026-10-11T08:10:00Z',
    deleted_by_name: 'Sara Al-Harbi',
    purge_at: '2026-11-10T08:10:00Z',
    purge_paused: false,
    project_archived: false,
    project_id: 1,
    project_name: 'Acme Support',
    project_slug: 'acme',
  },
  {
    id: '9a0c1e2f-3b4d-4c5e-8f6a-7b8c9d0e1f22',
    run_name: 'support-sonnet-sweep-20261009',
    task: 'main.<locals>.task',
    dataset: 'Hidden eval set',
    model: 'claude-3-5-sonnet',
    has_reasoning: true,
    status: 'completed',
    deleted_at: '2026-10-11T09:00:00Z',
    deleted_by_name: 'Omar Haddad',
    purge_at: '2026-10-11T20:00:00Z',
    purge_paused: false,
    project_archived: false,
    project_id: 1,
    project_name: 'Acme Support',
    project_slug: 'acme',
  },
  {
    id: 'b5ad8bb6-30ed-40f2-95f3-6c7d8e9f0a33',
    run_name: 'legacy nightly-gpt-4o-mini-20261001',
    task: 'main.<locals>.task',
    dataset: 'Legacy QA',
    model: 'gpt-4o-mini',
    has_reasoning: false,
    status: 'completed',
    deleted_at: '2026-10-02T08:00:00Z',
    deleted_by_name: 'Dev User',
    purge_at: null,
    purge_paused: true,
    project_archived: true,
    project_id: 2,
    project_name: 'Legacy Bot',
    project_slug: 'legacy',
  },
];

export const trashProjects = [
  { id: 1, name: 'Acme Support', slug: 'acme', archived: false, deleted_runs: 3 },
  { id: 2, name: 'Legacy Bot', slug: 'legacy', archived: true, deleted_runs: 1 },
];

export const NOW = new Date('2026-10-11T10:00:00Z');
