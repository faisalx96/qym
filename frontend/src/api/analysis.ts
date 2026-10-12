/**
 * Auto-analysis (analyzer workspace) API: typed TanStack Query hooks for the
 * run- and project-scoped analysis routes (brief 08 §4). Run scope uses
 * `/api/runs/{id}/...`, project scope `/api/projects/{slug}/...`; the server
 * resolves both to the same project. LLM-calling routes (preview/test/jobs)
 * exist for runs only.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api, ApiError } from '@/lib/http';
import { usePollingInterval } from '@/lib/polling';

export interface AnalysisScope {
  slug: string;
  /** Present for run scope; absent for the project workspace. */
  runId?: string;
}

const enc = (value: string) => value.split('/').map(encodeURIComponent).join('/');

export function scopeBase(scope: AnalysisScope): string {
  return scope.runId ? `/api/runs/${enc(scope.runId)}` : `/api/projects/${encodeURIComponent(scope.slug)}`;
}
export const scopeKey = (scope: AnalysisScope) =>
  scope.runId ? `run:${scope.runId}` : `project:${scope.slug}`;

/** `{code, message, ...}` object details (409 conflicts) that apiFetch keeps on `body.detail`. */
export function errorDetail(
  error: unknown,
): { code?: string; message?: string; [k: string]: unknown } | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { detail?: unknown } | null;
  const detail = body && typeof body === 'object' ? body.detail : null;
  return detail && typeof detail === 'object' ? (detail as { code?: string; message?: string }) : null;
}

/* ───────────────────────── types ───────────────────────── */

export interface LlmConnection {
  id: string;
  name: string;
  llm_model: string;
  is_default: boolean;
  llm_api_key_set: boolean;
}

export interface TaxonomyEntry {
  description?: string;
  when_to_use?: string;
}

export interface RuleItem {
  id?: string;
  title: string;
  instruction: string;
  inferred_from?: string;
  explanation?: string;
}

export interface RuleVersion {
  id: string;
  version: number;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  rules: RuleItem[];
  rule_count: number;
  source: string;
  parent_version_id: string | null;
  base_version_id: string | null;
  merge_parent_ids: string[];
  aliases: string[];
  is_active: boolean;
  is_deleted: boolean;
  created_by: { id: string; display_name: string } | null;
  created_at: string | null;
  updated_at: string | null;
  published_at: string | null;
  activated_at: string | null;
}

export interface ApprovedExample {
  id: number;
  item_id?: string;
  metric_name?: string;
  pass_number?: number | null;
  run_name?: string;
  dataset?: string;
  model?: string;
  root_cause_issues?: Array<{ category?: string; subcategory?: string; finding?: string }>;
  detail?: string;
  note?: string;
  solution?: string;
  solution_note?: string;
  input?: unknown;
  expected?: unknown;
  output?: unknown;
  created_at?: string;
}

export interface CategoryCatalog {
  id?: string;
  version: number;
  categories: string[];
  category_details_map?: Record<string, string[]>;
  category_taxonomy?: Record<string, TaxonomyEntry>;
  subcategory_taxonomy?: Record<string, Record<string, TaxonomyEntry>>;
  max_root_cause_categories?: number;
  can_manage?: boolean;
}

export interface AnalysisConfig {
  llm_configured: boolean;
  model: string | null;
  llm_connections: LlmConnection[];
  default_connection_id: string | null;
  analysis_rules: RuleItem[];
  analysis_rule_version: RuleVersion | null;
  can_manage_analysis_rules: boolean;
  can_operate_analyzer: boolean;
  can_manage_category_catalog: boolean;
  total_items: number;
  items_with_root_cause: number;
  correction_bank_size: number;
  approved_example_count: number;
  enabled_document_count: number;
  analysis_limits: {
    document_upload_bytes: number | null;
    rule_writer_document_characters: number | null;
    rule_writer_example_characters: number | null;
    rule_writer_prompt_characters: number | null;
  } & Record<string, number | boolean | null>;
  analysis_defaults: {
    request_timeout_seconds: number;
    max_timeout_seconds: number;
    max_timeout_retries: number;
  };
  default_system_prompt: string;
  default_categories: string[];
  max_root_cause_categories: number;
  category_details_map: Record<string, string[]>;
  category_taxonomy: Record<string, TaxonomyEntry>;
  subcategory_taxonomy: Record<string, Record<string, TaxonomyEntry>>;
  category_example_counts: Record<string, number>;
  category_examples: Record<string, ApprovedExample[]>;
  category_catalog_version: number;
  category_catalog_version_id: string | null;
  category_catalog: CategoryCatalog | null;
}

export interface AnalysisDocument {
  id: string;
  name: string;
  content?: string;
  characters: number;
  source_characters?: number;
  truncated?: boolean;
  selected: boolean;
  content_over_limit?: boolean;
  created_at?: string;
}

export interface RuleVersionsResponse {
  versions: RuleVersion[];
  can_delete: boolean;
  can_activate: boolean;
  can_restore: boolean;
  production_version_id: string | null;
}

export type JobStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
export type JobPhase = 'queued' | 'analyzing' | 'retrying' | 'aggregating' | 'completed' | 'failed';

export interface AnalysisJobProgress {
  phase: JobPhase;
  completed: number;
  total: number;
  errors: number;
  retries: number;
  item_id?: string;
  metric_name?: string;
  retry_reason?: string;
  retry_attempt?: number;
  retry_max_attempts?: number;
  retry_timeout_seconds?: number;
}

export interface RootCauseIssue {
  category?: string;
  subcategory?: string;
  finding?: string;
  category_reason?: string;
  confidence?: number | null;
}

export interface AnalysisResultPayload {
  item_id: string;
  metric_name?: string;
  root_cause?: string;
  root_causes?: string[];
  root_cause_issues?: RootCauseIssue[];
  root_cause_detail?: string;
  root_cause_note?: string;
  confidence?: number | null;
  error?: string | null;
  error_code?: string;
  retry_count?: number;
  retry_reason?: string;
  warning?: string;
  messages?: Array<{ role: string; content: string }>;
}

export interface AnalysisJobResult {
  total_analyzed?: number;
  total_attempted?: number;
  total_analysis_failed?: number;
  results?: AnalysisResultPayload[];
  categories?: Record<string, number>;
  aggregated?: number;
  aggregation_error?: string | null;
  errors?: number;
  retries?: number;
  [k: string]: unknown;
}

export interface AnalysisJob<R = AnalysisJobResult> {
  job_id: string;
  run_id: string;
  pass_number: number | null;
  status: JobStatus;
  progress: AnalysisJobProgress;
  result: R | null;
  error: string | null;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  created?: boolean;
}

export const isJobTerminal = (status: JobStatus | undefined) =>
  status === 'completed' || status === 'cancelled' || status === 'failed';

export interface RuleJobResult {
  analysis_rules: RuleItem[];
  rule_version: RuleVersion;
  mode: string;
  created_new_version: boolean;
  generated_rule_count: number;
  inference_stats?: { writer_calls?: number; patching_used?: boolean; total_patches?: number };
  changes?: { added: number; removed: number; changed: number; unchanged: number };
  documents_used?: number;
  examples_used?: number;
}
export type RuleJobPhase = 'queued' | 'preparing' | 'generating' | 'persisting' | 'completed';
export interface RuleJob extends Omit<AnalysisJob<RuleJobResult>, 'progress'> {
  progress: { phase: RuleJobPhase | string; completed?: number; total?: number; message?: string };
}

/** Request body shared by preview / test / jobs (PlaygroundConfig, brief 08 §4). */
export interface PlaygroundConfigPayload {
  include_project_rules?: boolean;
  include_project_documents?: boolean;
  additional_instructions?: string;
  max_root_cause_categories?: number;
  include_fields?: Record<string, boolean>;
  metadata_fields?: string[];
  field_mapping?: Record<string, string | string[]>;
  custom_variable_mapping?: Record<string, string | string[]>;
}

export interface PassGuard {
  pass_number?: number;
  expected_pass_version?: number;
}

export interface PreviewResponse {
  messages: Array<{ role: string; content: string }>;
  metric_name: string;
  prompt_characters: number;
  prompt_limit: number | null;
  prompt_at_limit?: boolean;
  prompt_truncated?: boolean;
}

export interface TestResponse {
  results: AnalysisResultPayload[];
  categories?: string[];
  aggregation_error?: string | null;
  retries?: number;
}

/* ───────────────────────── run data ───────────────────────── */

export interface MetricSpecInfo {
  direction?: string;
  pass_threshold?: number | null;
  score_type?: string;
  schema_version?: number;
}

export interface RunSummary {
  run: {
    run_id: string;
    run_name?: string;
    task_name?: string;
    model_name?: string;
    dataset_name?: string;
    metric_names?: string[];
    metric_specs?: Record<string, MetricSpecInfo>;
    samples?: number;
    status?: string;
    metadata?: { pass_revision?: number; has_repeat_pass_context?: boolean; [k: string]: unknown };
    project?: { id: string; slug: string; name: string; archived?: boolean } | null;
  };
}

export interface CompactRow {
  index: number;
  item_id: string;
  status?: string;
  error?: string;
  metric_values?: unknown[];
  metric_meta?: Record<string, Record<string, unknown>>;
  item_metadata?: Record<string, unknown> | null;
  input_preview?: string;
  input?: unknown;
  input_full?: unknown;
  expected?: unknown;
  expected_full?: unknown;
  output?: unknown;
  output_full?: unknown;
  pass_scores?: Record<string, unknown[]> | null;
  pass_metric_meta?: Record<string, unknown[]> | null;
  pass_metric_analyses?: Record<string, unknown[]> | null;
  pass_attempts?: Array<Record<string, unknown>> | null;
  [k: string]: unknown;
}

export interface RunCompact extends RunSummary {
  snapshot: {
    metric_names: string[];
    metric_specs: Record<string, MetricSpecInfo>;
    rows: CompactRow[];
  };
}

export interface RunPasses {
  run_id: string;
  samples: number;
  metrics: string[];
  passes: Array<{ pass_number: number; status: string; items_scored: number; items_total: number }>;
}

export const runSummaryKey = (runId: string) => ['run', 'summary', runId] as const;
export const runPassesKey = (runId: string) => ['run', 'passes', runId] as const;
export const runCompactKey = (runId: string, pass: number | null) => ['run', 'compact', runId, pass] as const;

export function useRunSummary(runId: string | undefined) {
  return useQuery({
    queryKey: runSummaryKey(runId ?? ''),
    queryFn: () => api.get<RunSummary>(`/api/runs/${enc(runId ?? '')}?view=summary`),
    enabled: Boolean(runId),
    staleTime: 15_000,
  });
}

export function useRunPasses(runId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: runPassesKey(runId ?? ''),
    queryFn: () => api.get<RunPasses>(`/api/runs/${enc(runId ?? '')}/passes`),
    enabled: Boolean(runId) && enabled,
  });
}

export function useRunCompact(runId: string | undefined, pass: number | null, enabled = true) {
  return useQuery({
    queryKey: runCompactKey(runId ?? '', pass),
    queryFn: () =>
      api.get<RunCompact>(`/api/runs/${enc(runId ?? '')}?view=compact${pass ? `&pass_number=${pass}` : ''}`),
    enabled: Boolean(runId) && enabled,
    staleTime: 15_000,
  });
}

export function useItemDetails(runId: string | undefined, itemIds: string[], enabled: boolean) {
  const key = itemIds.join('|');
  return useQuery({
    queryKey: ['run', 'item-details', runId ?? '', key],
    queryFn: () =>
      api.post<{ rows: CompactRow[] }>(`/api/runs/${enc(runId ?? '')}/items/details`, { item_ids: itemIds }),
    enabled: Boolean(runId) && enabled && itemIds.length > 0,
    staleTime: 60_000,
  });
}

/* ───────────────────────── config / catalog ───────────────────────── */

export const analysisConfigKey = (scope: AnalysisScope) => ['analysis', 'config', scopeKey(scope)] as const;

export function useAnalysisConfig(scope: AnalysisScope) {
  return useQuery({
    queryKey: analysisConfigKey(scope),
    queryFn: () => api.get<AnalysisConfig>(`${scopeBase(scope)}/analysis-config`),
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export interface CatalogUpdate {
  categories: string[];
  category_details_map: Record<string, string[]>;
  category_taxonomy: Record<string, TaxonomyEntry>;
  subcategory_taxonomy: Record<string, Record<string, TaxonomyEntry>>;
  max_root_cause_categories: number;
  base_revision: number;
}

export function useSaveCategoryCatalog(slug: string, scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CatalogUpdate) =>
      api.put<{ catalog: CategoryCatalog; created: boolean }>(
        `/api/projects/${encodeURIComponent(slug)}/analysis-category-catalog`,
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: analysisConfigKey(scope) }),
  });
}

/* ───────────────────────── documents ───────────────────────── */

export const documentsKey = (scope: AnalysisScope) => ['analysis', 'documents', scopeKey(scope)] as const;

export function useAnalysisDocuments(scope: AnalysisScope, enabled = true) {
  return useQuery({
    queryKey: documentsKey(scope),
    queryFn: () => api.get<{ documents: AnalysisDocument[] }>(`${scopeBase(scope)}/analysis-documents`),
    enabled,
  });
}

function invalidateDocs(qc: QueryClient, scope: AnalysisScope) {
  void qc.invalidateQueries({ queryKey: documentsKey(scope) });
  void qc.invalidateQueries({ queryKey: analysisConfigKey(scope) });
}

export function useUploadDocument(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, full }: { file: File; full?: boolean }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('large_document_action', full ? 'full' : 'ask');
      return api.post<{ document: AnalysisDocument }>(`${scopeBase(scope)}/analysis-documents`, form);
    },
    onSuccess: () => invalidateDocs(qc, scope),
  });
}

export function useToggleDocument(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, selected }: { id: string; selected: boolean }) =>
      api.patch<{ document: AnalysisDocument }>(
        `${scopeBase(scope)}/analysis-documents/${encodeURIComponent(id)}`,
        { selected },
      ),
    onMutate: async ({ id, selected }) => {
      await qc.cancelQueries({ queryKey: documentsKey(scope) });
      const previous = qc.getQueryData<{ documents: AnalysisDocument[] }>(documentsKey(scope));
      if (previous) {
        qc.setQueryData(documentsKey(scope), {
          documents: previous.documents.map((d) => (d.id === id ? { ...d, selected } : d)),
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(documentsKey(scope), ctx.previous);
    },
    onSettled: () => invalidateDocs(qc, scope),
  });
}

export function useDeleteDocument(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: boolean }>(`${scopeBase(scope)}/analysis-documents/${encodeURIComponent(id)}`),
    onSuccess: () => invalidateDocs(qc, scope),
  });
}

/* ───────────────────────── rule versions ───────────────────────── */

export const ruleVersionsKey = (scope: AnalysisScope) =>
  ['analysis', 'rule-versions', scopeKey(scope)] as const;

export function useRuleVersions(scope: AnalysisScope, enabled = true) {
  return useQuery({
    queryKey: ruleVersionsKey(scope),
    queryFn: () =>
      api.get<RuleVersionsResponse>(`${scopeBase(scope)}/analysis-rule-versions?include_deleted=true`),
    enabled,
  });
}

function invalidateRules(qc: QueryClient, scope: AnalysisScope): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ruleVersionsKey(scope) }),
    qc.invalidateQueries({ queryKey: analysisConfigKey(scope) }),
  ]);
}

export function useCreateDraft(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fromVersion: string) =>
      api.post<{ version: RuleVersion }>(`${scopeBase(scope)}/analysis-rule-versions`, {
        from_version: fromVersion,
      }),
    onSuccess: () => invalidateRules(qc, scope),
  });
}

/** Autosave of an open draft (PATCH analysis-context); does not refetch on success. */
export function useSaveRules(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rules, versionId }: { rules: RuleItem[]; versionId: string }) =>
      api.patch<{ analysis_rules: RuleItem[]; rule_version: RuleVersion }>(
        `${scopeBase(scope)}/analysis-context`,
        {
          analysis_rules: rules.map((r) => ({ id: r.id, title: r.title, instruction: r.instruction })),
          create_new_version: false,
          rule_version_id: versionId,
        },
      ),
    onSuccess: (data) => {
      qc.setQueryData<RuleVersionsResponse>(ruleVersionsKey(scope), (cur) =>
        cur
          ? {
              ...cur,
              versions: cur.versions.map((v) => (v.id === data.rule_version.id ? data.rule_version : v)),
            }
          : cur,
      );
    },
  });
}

export function usePublishVersion(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ version, production }: { version: number; production: boolean }) =>
      api.post<{ version: RuleVersion }>(`${scopeBase(scope)}/analysis-rule-versions/${version}:publish`, {
        set_alias: production ? 'production' : null,
      }),
    onSuccess: () => invalidateRules(qc, scope),
  });
}

export function usePromoteVersion(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      api.post<{ active_version: RuleVersion }>(
        `${scopeBase(scope)}/analysis-rule-versions/${encodeURIComponent(versionId)}/activate`,
      ),
    onSuccess: () => invalidateRules(qc, scope),
  });
}

export function useDeleteVersion(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      api.delete<{ deleted_version_id: string }>(
        `${scopeBase(scope)}/analysis-rule-versions/${encodeURIComponent(versionId)}`,
      ),
    onSuccess: () => invalidateRules(qc, scope),
  });
}

export interface RuleCompare {
  base: RuleVersion;
  target: RuleVersion;
  summary: { added: number; removed: number; changed: number; unchanged: number };
  added_rules: RuleItem[];
  removed_rules: RuleItem[];
  changed_rules: Array<{ id: string; before: RuleItem; after: RuleItem }>;
}

export function useCompareVersions(scope: AnalysisScope, target: number | null, base: number | null) {
  return useQuery({
    queryKey: ['analysis', 'rule-compare', scopeKey(scope), target, base],
    queryFn: () =>
      api.get<RuleCompare>(`${scopeBase(scope)}/analysis-rule-versions/${target}:compare?base=${base}`),
    enabled: target != null && base != null,
  });
}

export interface MergeConflict {
  key: string;
  target: RuleItem;
  source: RuleItem;
}
export interface MergeResponse {
  version?: RuleVersion;
  merge?: { created_new_draft?: boolean };
  preview?: {
    summary: { changed: number; added: number; removed: number; conflicts: number };
    conflicts: MergeConflict[];
  };
}
export type MergeResolution = 'target' | 'source' | { title: string; instruction: string };

export function useMergeVersions(scope: AnalysisScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      target,
      source,
      apply,
      resolutions,
    }: {
      target: number;
      source: number;
      apply: boolean;
      resolutions?: Record<string, MergeResolution>;
    }) =>
      api.post<MergeResponse>(`${scopeBase(scope)}/analysis-rule-versions/${target}:merge`, {
        source_version: String(source),
        apply,
        resolutions: resolutions ?? {},
      }),
    onSuccess: (_d, vars) => {
      if (vars.apply) void invalidateRules(qc, scope);
    },
  });
}

/* ───────────────────────── rule generation job ───────────────────────── */

export interface RuleJobRequest {
  include_documents: boolean;
  include_examples: boolean;
  approved_example_ids: number[];
  include_fields: Record<string, boolean>;
  mode: 'generate';
  rule_version_id: string | null;
  connection_id: string | null;
}

export function useStartRuleJob(scope: AnalysisScope) {
  return useMutation({
    mutationFn: (body: RuleJobRequest) => api.post<RuleJob>(`${scopeBase(scope)}/analysis-rule-jobs`, body),
  });
}

export function useActiveRuleJob(scope: AnalysisScope, enabled: boolean) {
  return useQuery({
    queryKey: ['analysis', 'active-rule-job', scopeKey(scope)],
    queryFn: () => api.get<{ job: RuleJob | null }>(`${scopeBase(scope)}/analysis-rule-jobs/active`),
    enabled,
    staleTime: 0,
  });
}

export function useRuleJob(scope: AnalysisScope, jobId: string | null) {
  const interval = usePollingInterval(1000);
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['analysis', 'rule-job', scopeKey(scope), jobId],
    queryFn: async () => {
      const job = await api.get<RuleJob>(`${scopeBase(scope)}/analysis-rule-jobs/${jobId}`);
      // Wait for the refreshed versions: the editor re-seeds from them as soon as the finished job is seen.
      if (isJobTerminal(job.status)) await invalidateRules(qc, scope);
      return job;
    },
    enabled: Boolean(jobId),
    refetchInterval: (q) => (isJobTerminal(q.state.data?.status) ? false : interval),
    staleTime: 0,
  });
}

export function useCancelRuleJob(scope: AnalysisScope) {
  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<RuleJob>(`${scopeBase(scope)}/analysis-rule-jobs/${jobId}/cancel`),
  });
}

/* ───────────────────────── approved examples ───────────────────────── */

export interface ExampleQuery {
  page: number;
  page_size: number;
  task: string[];
  dataset: string[];
  model: string[];
  run_name: string[];
  user_id: string[];
  source: 'ai_only' | 'human_only' | 'corrected' | null;
  conf_min?: number;
  conf_max?: number;
  search: string;
  selected_ids: number[];
  selected_only: boolean;
}

export interface ExampleRow {
  id: number;
  item_id: string;
  root_causes: string[];
  detail?: string;
  task?: string;
  dataset?: string;
  model?: string;
  run_name?: string;
  pass_number?: number | null;
  corrected_by?: { id: string; display_name: string } | null;
  reviewed_by?: { id: string; display_name: string } | null;
  confidence?: number | null;
  source?: 'AI' | 'Human' | 'Corrected' | 'Unknown';
  source_characters?: number;
}

export interface ExamplesResponse {
  examples: ExampleRow[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
  matching_ids: number[];
  matching_characters: number;
  selected_ids: number[];
  selected_count: number;
  selected_characters: number;
  facets: {
    tasks: string[];
    datasets: string[];
    models: string[];
    run_names: string[];
    users: Array<{ id: string; display_name: string; email?: string }>;
  };
  limits?: Record<string, number | null>;
}

export function useExamples(scope: AnalysisScope, query: ExampleQuery, enabled: boolean) {
  return useQuery({
    queryKey: ['analysis', 'examples', scopeKey(scope), query],
    queryFn: () => api.post<ExamplesResponse>(`${scopeBase(scope)}/analysis-examples`, query),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/* ───────────────────────── preview / test / jobs ───────────────────────── */

export interface PreviewRequest extends PassGuard {
  item_id: string;
  metric: string;
  config: PlaygroundConfigPayload;
  connection_id: string | null;
}

export function usePromptPreview(runId: string, body: PreviewRequest | null) {
  return useQuery({
    queryKey: ['analysis', 'preview', runId, body],
    queryFn: ({ signal }) =>
      api.post<PreviewResponse>(`/api/runs/${enc(runId)}/analyze-preview`, body, { signal }),
    enabled: body != null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

export interface TestRequest extends PassGuard {
  item_ids: string[];
  metric: string;
  config: PlaygroundConfigPayload;
  connection_id: string | null;
  timeout_seconds: number;
}

export function useTestItems(runId: string) {
  return useMutation({
    mutationFn: ({ body, signal }: { body: TestRequest; signal?: AbortSignal }) =>
      api.post<TestResponse>(`/api/runs/${enc(runId)}/analyze-test`, body, { signal }),
  });
}

export interface AnalyzeRequest extends PassGuard {
  metric: null;
  metrics: string[];
  item_filter: 'failed';
  max_score: number;
  only_unanalyzed: boolean;
  allow_human_overwrite: boolean;
  threshold: number;
  config: PlaygroundConfigPayload;
  connection_id: string | null;
  timeout_seconds: number;
  limit?: number;
}

export function useStartAnalysisJob(runId: string) {
  return useMutation({
    mutationFn: (body: AnalyzeRequest) =>
      api.post<AnalysisJob>(`/api/runs/${enc(runId)}/analysis-jobs`, body),
  });
}

export function useActiveAnalysisJob(runId: string, pass: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['analysis', 'active-job', runId, pass],
    queryFn: () =>
      api.get<{ job: AnalysisJob | null }>(
        `/api/runs/${enc(runId)}/analysis-jobs/active${pass ? `?pass_number=${pass}` : ''}`,
      ),
    enabled,
    staleTime: 0,
  });
}

/** Polls one job until terminal; keyed by pass so a sample switch drops stale responses. */
export function useAnalysisJob(runId: string, pass: number | null, jobId: string | null) {
  const interval = usePollingInterval(1000);
  return useQuery({
    queryKey: ['analysis', 'job', runId, pass, jobId],
    queryFn: () => api.get<AnalysisJob>(`/api/runs/${enc(runId)}/analysis-jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (q) => (isJobTerminal(q.state.data?.status) ? false : interval),
    staleTime: 0,
  });
}

export function useCancelAnalysisJob(runId: string) {
  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<AnalysisJob>(`/api/runs/${enc(runId)}/analysis-jobs/${jobId}/cancel`),
  });
}
