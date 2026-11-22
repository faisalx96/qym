/**
 * Data factory API (`/api/projects/{slug}/factories`, `/api/factories/{id}/…`): a connected dataset, its rule
 * categories, the rules the agent extracted (official once approved), the factory's own access and the analysis /
 * generation jobs the workers run. Session cookie auth (UI).
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/http';

export type FactoryLevel = 'none' | 'view' | 'modify' | 'approve' | 'manage';
export type FactoryGrantLevel = 'view' | 'modify' | 'approve';
export type FactoryAccessMode = 'project' | 'restricted';
export type FactoryJobKind = 'analysis' | 'generation';
export type FactoryJobStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled';
export type RuleStatusFilter = 'all' | 'official' | 'proposed';
/** A plain rule constrains an item; a bridge extends it into other categories (a join, a cross-sell). */
export type RuleKind = 'rule' | 'bridge';
export type RuleKindFilter = 'all' | RuleKind;

export const ACTIVE_JOB_STATUSES: FactoryJobStatus[] = ['queued', 'running', 'cancel_requested'];

export interface FactoryUser {
  id: string;
  display_name: string;
  email: string;
}

export interface FactoryDatasetBrief {
  id: string;
  name: string;
  slug: string;
  deleted: boolean;
}

export interface FactoryPermissions {
  access_level: FactoryLevel;
  can_modify: boolean;
  can_approve: boolean;
  can_manage_access: boolean;
  can_disconnect: boolean;
  is_creator: boolean;
}

export interface FactoryCounts {
  categories: number;
  rules: number;
  official_rules: number;
  jobs: number;
  active_jobs: number;
}

export interface Factory {
  id: string;
  project_id: string;
  project_slug: string;
  dataset: FactoryDatasetBrief | null;
  group_metadata_key: string | null;
  llm_connection: { id: string; name: string; model: string } | null;
  access_mode: FactoryAccessMode;
  analysis_instructions: string;
  generation_instructions: string;
  created_by: FactoryUser | null;
  last_analyzed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  counts: FactoryCounts;
  permissions: FactoryPermissions;
}

export interface FactoryCategory {
  id: string;
  factory_id: string;
  key: string;
  name: string;
  description: string;
  json_schema: Record<string, unknown> | null;
  position: number;
  rule_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface MetadataKeyChoice {
  key: string;
  /** scalar: one group per item; list: an item belongs to every value it lists; mixed: both occur. */
  kind: 'scalar' | 'list' | 'mixed';
  values: string[];
  value_count: number;
  truncated: boolean;
}

export interface LlmConnectionOption {
  id: string;
  name: string;
  model: string;
  is_default: boolean;
  has_api_key: boolean;
}

export interface SourceVersion {
  id: string;
  version: string;
  name: string;
  item_count: number;
  status: string | null;
  published_at: string | null;
}

export interface GenerationDefaults {
  max_layers: number;
  branching: number;
  max_items: number;
  official_only: boolean;
}

export interface FactoryDetail extends Factory {
  categories: FactoryCategory[];
  source_version: SourceVersion | null;
  metadata_keys: MetadataKeyChoice[];
  llm_connections: LlmConnectionOption[];
  active_job: FactoryJob | null;
  generation_limits: {
    max_layers: number;
    max_branching: number;
    max_items: number;
    defaults: GenerationDefaults;
  };
}

export interface FactoryCategoryRef {
  id: string;
  key: string;
  name: string;
}

export interface FactoryRule {
  id: string;
  factory_id: string;
  /** The primary category: its schema binds the body. `categories` lists it first, then the further ones. */
  category_id: string;
  category_key: string | null;
  category_name: string | null;
  categories: FactoryCategoryRef[];
  kind: RuleKind;
  /** The categories a bridge opens for the next generation layer; empty on a plain rule. */
  bridge_to: FactoryCategoryRef[];
  group_value: string;
  title: string;
  description: string;
  body: Record<string, unknown> | null;
  official: boolean;
  source: 'agent' | 'manual';
  evidence: string[];
  job_id: string | null;
  created_by: FactoryUser | null;
  approved_by: FactoryUser | null;
  approved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface RuleGroupCount {
  value: string;
  count: number;
  official: number;
}

export interface FactoryRulesList {
  factory_id: string;
  total: number;
  rules: FactoryRule[];
  groups: RuleGroupCount[];
}

export interface FactoryJob {
  id: string;
  factory_id: string;
  kind: FactoryJobKind;
  status: FactoryJobStatus;
  params: Record<string, unknown>;
  progress: Record<string, unknown> & { message?: string };
  error: string | null;
  output_dataset: FactoryDatasetBrief | null;
  requested_by: FactoryUser | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
  log?: string;
}

export interface AccessPerson {
  id: string;
  name: string;
  email: string;
}

export interface FactoryGrant {
  user: AccessPerson;
  level: FactoryGrantLevel;
  granted_by: AccessPerson | null;
  created_at: string | null;
}

export interface FactoryAccess {
  access_mode: FactoryAccessMode;
  grants: FactoryGrant[];
  can_manage_access: boolean;
  candidates: AccessPerson[];
  your_level: Exclude<FactoryLevel, 'none'>;
  levels: FactoryGrantLevel[];
}

export interface FactoryList {
  project_id: string;
  project_slug: string;
  connected_dataset_ids: string[];
  factories: Factory[];
}

export interface RuleFilters {
  group?: string | null;
  category_id?: string | null;
  kind?: RuleKindFilter;
  status?: RuleStatusFilter;
  q?: string;
}

export interface RuleWrite {
  category_id: string;
  category_ids: string[];
  kind: RuleKind;
  bridge_to_category_ids: string[];
  group_value: string;
  title: string;
  description: string;
  body: Record<string, unknown> | null;
}

export interface CategoryWrite {
  name: string;
  description: string;
  json_schema: Record<string, unknown> | null;
}

export interface FactoryPatch {
  group_metadata_key?: string | null;
  llm_connection_id?: string | null;
  analysis_instructions?: string;
  generation_instructions?: string;
}

export interface GenerationParams {
  max_layers: number;
  branching: number;
  max_items: number;
  official_only: boolean;
  group_values?: string[] | null;
  dataset_name?: string | null;
}

export const factoryKeys = {
  all: ['factory'] as const,
  list: (slug: string) => ['factory', 'list', slug] as const,
  detail: (id: string) => ['factory', 'detail', id] as const,
  rules: (id: string, filters: RuleFilters) =>
    [
      'factory',
      'rules',
      id,
      filters.group ?? null,
      filters.category_id ?? null,
      filters.kind ?? 'all',
      filters.status ?? 'all',
      filters.q ?? '',
    ] as const,
  jobs: (id: string) => ['factory', 'jobs', id] as const,
  job: (id: string, jobId: string) => ['factory', 'job', id, jobId] as const,
  access: (id: string) => ['factory', 'access', id] as const,
};

const enc = encodeURIComponent;

export function isActiveJob(job: FactoryJob | null | undefined): boolean {
  return Boolean(job && ACTIVE_JOB_STATUSES.includes(job.status));
}

export function useFactories(slug: string) {
  return useQuery({
    queryKey: factoryKeys.list(slug),
    queryFn: () => api.get<FactoryList>(`/api/projects/${enc(slug)}/factories`),
    staleTime: 10_000,
  });
}

/** The refetch interval while a job is queued or running (the page keeps its progress line current). */
export const JOB_REFRESH_MS = 3000;

export function useFactory(id: string, options: { liveWhileActive?: boolean } = {}) {
  return useQuery({
    queryKey: factoryKeys.detail(id),
    queryFn: () => api.get<FactoryDetail>(`/api/factories/${enc(id)}`),
    refetchInterval: options.liveWhileActive
      ? (query) => (isActiveJob(query.state.data?.active_job) ? JOB_REFRESH_MS : false)
      : false,
  });
}

export function useFactoryRules(id: string, filters: RuleFilters, enabled = true) {
  const params = new URLSearchParams();
  if (filters.group !== null && filters.group !== undefined) params.set('group', filters.group);
  if (filters.category_id) params.set('category_id', filters.category_id);
  if (filters.kind && filters.kind !== 'all') params.set('kind', filters.kind);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  const qs = params.toString();
  return useQuery({
    queryKey: factoryKeys.rules(id, filters),
    queryFn: () => api.get<FactoryRulesList>(`/api/factories/${enc(id)}/rules${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useFactoryJobs(id: string, options: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: factoryKeys.jobs(id),
    queryFn: () =>
      api.get<{ factory_id: string; jobs: FactoryJob[] }>(`/api/factories/${enc(id)}/jobs?limit=50`),
    refetchInterval: options.refetchInterval ?? false,
  });
}

export function useFactoryJob(
  id: string,
  jobId: string | null,
  options: { refetchInterval?: number | false } = {},
) {
  return useQuery({
    queryKey: factoryKeys.job(id, jobId ?? ''),
    queryFn: () => api.get<FactoryJob>(`/api/factories/${enc(id)}/jobs/${enc(jobId ?? '')}`),
    enabled: Boolean(jobId),
    refetchInterval: options.refetchInterval ?? false,
  });
}

export function useFactoryAccess(id: string, enabled = true) {
  return useQuery({
    queryKey: factoryKeys.access(id),
    queryFn: () => api.get<FactoryAccess>(`/api/factories/${enc(id)}/access`),
    enabled,
  });
}

function useInvalidate(id?: string) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: factoryKeys.all });
    if (id) await qc.invalidateQueries({ queryKey: factoryKeys.detail(id) });
  };
}

export function useConnectDataset(slug: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: {
      dataset_ref: string;
      group_metadata_key?: string | null;
      llm_connection_id?: string | null;
    }) => api.post<FactoryDetail>(`/api/projects/${enc(slug)}/factories`, body),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateFactory(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FactoryPatch) => api.patch<FactoryDetail>(`/api/factories/${enc(id)}`, body),
    onSuccess: (detail) => {
      qc.setQueryData(factoryKeys.detail(id), detail);
      void qc.invalidateQueries({ queryKey: ['factory', 'list'] });
    },
  });
}

export function useDisconnectFactory(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.delete<{ ok: boolean }>(`/api/factories/${enc(id)}`),
    onSuccess: () => void invalidate(),
  });
}

export function useSaveFactoryAccess(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      access_mode: FactoryAccessMode;
      grants: { user_id: string; level: FactoryGrantLevel }[];
    }) => api.put<FactoryAccess>(`/api/factories/${enc(id)}/access`, body),
    onSuccess: (access) => {
      qc.setQueryData(factoryKeys.access(id), access);
      void qc.invalidateQueries({ queryKey: factoryKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ['factory', 'list'] });
    },
  });
}

export function useCreateCategory(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: (body: CategoryWrite) =>
      api.post<FactoryCategory>(`/api/factories/${enc(id)}/categories`, body),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateCategory(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: ({ categoryId, body }: { categoryId: string; body: Partial<CategoryWrite> }) =>
      api.patch<FactoryCategory>(`/api/factories/${enc(id)}/categories/${enc(categoryId)}`, body),
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteCategory(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: (categoryId: string) =>
      api.delete<{ ok: boolean; rules_removed: number }>(
        `/api/factories/${enc(id)}/categories/${enc(categoryId)}`,
      ),
    onSuccess: () => void invalidate(),
  });
}

export function useCreateRule(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: (body: RuleWrite) => api.post<FactoryRule>(`/api/factories/${enc(id)}/rules`, body),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateRule(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: ({ ruleId, body }: { ruleId: string; body: Partial<RuleWrite> }) =>
      api.patch<FactoryRule>(`/api/factories/${enc(id)}/rules/${enc(ruleId)}`, body),
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteRule(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: (ruleId: string) =>
      api.delete<{ ok: boolean }>(`/api/factories/${enc(id)}/rules/${enc(ruleId)}`),
    onSuccess: () => void invalidate(),
  });
}

export function useSetRuleOfficial(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: ({ ruleId, official }: { ruleId: string; official: boolean }) =>
      api.post<FactoryRule>(
        `/api/factories/${enc(id)}/rules/${enc(ruleId)}:${official ? 'approve' : 'revoke'}`,
      ),
    onSuccess: () => void invalidate(),
  });
}

export function useStartJob(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: (
      body:
        | { kind: 'analysis'; params?: Record<string, never> }
        | { kind: 'generation'; params: GenerationParams },
    ) => api.post<FactoryJob>(`/api/factories/${enc(id)}/jobs`, body),
    onSuccess: () => void invalidate(),
  });
}

export function useCancelJob(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<FactoryJob>(`/api/factories/${enc(id)}/jobs/${enc(jobId)}:cancel`),
    onSuccess: () => void invalidate(),
  });
}
