/**
 * Reviews (corrections) API (brief 07 §4): cursor-paged list with facets,
 * single/bulk decisions with concurrency guards, inline diagnosis edits.
 */
import { useInfiniteQuery, useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/http';
import type { DsUser } from './datasets';

export type CorrectionStatus = 'pending' | 'approved' | 'rejected';
export type ReviewSource = 'ai_only' | 'human_only' | 'corrected';
export type ReviewSort = 'newest' | 'oldest' | 'confidence';

export interface RootCauseIssue {
  issue_id?: string;
  category: string;
  subcategory?: string | null;
  finding?: string | null;
  category_reason?: string | null;
  confidence?: number | null;
  solution?: string | null;
}

export interface ReviewRules {
  correction_approvers: 'members' | 'managers';
  correction_require_different_reviewer: boolean;
}

export interface CorrectionRow {
  id: number;
  revision_id: string | null;
  run_id: string;
  item_id: string;
  metric_name: string | null;
  pass_number: number | null;
  pass_deleted_at: string | null;
  issue_id: string | null;
  task: string;
  dataset: string;
  model: string | null;
  has_reasoning: boolean;
  run_name: string;
  ai_root_cause: string | null;
  ai_root_causes: string[];
  ai_root_cause_issues: RootCauseIssue[];
  ai_category_taxonomy: unknown;
  ai_root_cause_detail: string | null;
  ai_root_cause_note: string | null;
  ai_confidence: number | null;
  ai_solution: string | null;
  ai_solution_note: string | null;
  human_root_cause: string | null;
  human_root_causes: string[];
  human_root_cause_issues: RootCauseIssue[];
  human_category_taxonomy: unknown;
  human_root_cause_detail: string | null;
  human_root_cause_note: string | null;
  human_solution: string | null;
  human_solution_note: string | null;
  corrected_by: DsUser | null;
  created_at: string;
  status: CorrectionStatus;
  is_active: boolean;
  reviewed_by: DsUser | null;
  reviewed_at: string | null;
  review_comment: string | null;
  self_reviewed: boolean;
  project_slug: string;
  project_name: string;
  review_rules: ReviewRules;
  review_block: string | null;
  scores_snapshot: Record<string, unknown> | null;
  // list rows
  input_preview?: string | null;
  expected_preview?: string | null;
  output_preview?: string | null;
  // detail rows
  input_snapshot?: unknown;
  expected_snapshot?: unknown;
  output_snapshot?: unknown;
  item_metadata?: Record<string, unknown> | null;
  history?: CorrectionHistoryEntry[];
}

export interface CorrectionHistoryEntry {
  revision_id: string;
  revision_number: number;
  actor_source: string;
  actor_user: DsUser | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  review: { status: CorrectionStatus; review_comment: string | null; pass_number: number | null } | null;
  created_at: string;
}

export interface CorrectionsStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface CorrectionsPage {
  corrections: CorrectionRow[];
  total: number;
  has_more: boolean;
  next_cursor: string | null;
  sort: ReviewSort;
  limit: number;
  stats: CorrectionsStats;
  tasks: string[];
  datasets: string[];
  models: string[];
  run_names: string[];
  facet_counts: {
    task: Record<string, number>;
    dataset: Record<string, number>;
    model: Record<string, number>;
    run_name: Record<string, number>;
  };
}

/** `null` = all values; `[]` = none (the `__none__` URL sentinel). */
export interface ReviewFilters {
  projectSlug: string | null;
  status: CorrectionStatus | 'all';
  source: ReviewSource | null;
  confMin: number;
  confMax: number;
  search: string;
  task: string[] | null;
  dataset: string[] | null;
  model: string[] | null;
  run: string[] | null;
  sort: ReviewSort;
}

export const REVIEWS_PAGE = 25;

export function correctionsQuery(f: ReviewFilters, limit: number, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (f.projectSlug) q.set('project_slug', f.projectSlug);
  if (f.status !== 'all') q.set('status', f.status);
  if (f.source) q.set('source', f.source);
  if (f.confMin > 0) q.set('conf_min', String(f.confMin));
  if (f.confMax < 100) q.set('conf_max', String(f.confMax));
  if (f.search) q.set('search', f.search);
  const multi: [string, string[] | null][] = [
    ['task', f.task],
    ['dataset', f.dataset],
    ['model', f.model],
    ['run_name', f.run],
  ];
  for (const [key, values] of multi) {
    // null and [] both send nothing (vanilla buildListParams); [] only differs in the URL (`__none__`).
    if (!values || values.length === 0) continue;
    for (const v of values) q.append(key, v);
  }
  q.set('sort', f.sort);
  q.set('limit', String(limit));
  if (cursor) q.set('cursor', cursor);
  return `/api/corrections?${q.toString()}`;
}

export const reviewKeys = {
  list: (f: ReviewFilters) => ['corrections', f] as const,
  counts: (slug: string | null) => ['corrections-counts', slug] as const,
  detail: (id: number) => ['correction', id] as const,
};

export function useCorrections(filters: ReviewFilters) {
  return useInfiniteQuery({
    queryKey: reviewKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      api.get<CorrectionsPage>(correctionsQuery(filters, REVIEWS_PAGE, pageParam), { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : null),
    retry: false,
  });
}

/** Cheap counts refresh after a decision (`limit=1`, same project scope). */
export function useCorrectionCounts(projectSlug: string | null) {
  return useQuery({
    queryKey: reviewKeys.counts(projectSlug),
    queryFn: () =>
      api.get<CorrectionsPage>(
        `/api/corrections?limit=1${projectSlug ? `&project_slug=${encodeURIComponent(projectSlug)}` : ''}`,
      ),
    select: (r) => r.stats,
    retry: false,
  });
}

export function useCorrection(id: number | null) {
  return useQuery({
    queryKey: reviewKeys.detail(id ?? 0),
    queryFn: () => api.get<CorrectionRow>(`/api/corrections/${id}`),
    enabled: id !== null,
    retry: false,
  });
}

export function fetchCorrection(id: number) {
  return api.get<CorrectionRow>(`/api/corrections/${id}`);
}

export function invalidateCorrections(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['corrections'] });
  void qc.invalidateQueries({ queryKey: ['corrections-counts'] });
}

export type DecisionAction = 'approve' | 'reject' | 'reset';

export function useDecide() {
  return useMutation({
    mutationFn: ({ id, action, comment }: { id: number; action: DecisionAction; comment?: string }) =>
      api.post<CorrectionRow>(
        `/api/corrections/${id}/${action}`,
        action === 'reset' ? {} : { comment: comment ?? '' },
      ),
  });
}

export function useDeleteCorrection() {
  return useMutation({
    mutationFn: (id: number) =>
      api.delete<{ ok: boolean; deleted_id: number; status: 'rejected' }>(`/api/corrections/${id}`),
  });
}

export interface HumanDiagnosisBody {
  human_root_cause_issues: RootCauseIssue[];
  human_root_causes: string[];
  human_root_cause: string;
  human_root_cause_detail: string;
  human_root_cause_note: string;
}

export function useEditDiagnosis() {
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: HumanDiagnosisBody }) =>
      api.put<CorrectionRow>(`/api/corrections/${id}`, body),
  });
}

export type BulkAction = DecisionAction | 'delete';

export interface BulkBody {
  ids: number[];
  action: BulkAction;
  comment?: string;
  expected_count?: number;
  expected_status?: CorrectionStatus;
}

export interface BulkResponse {
  ok: boolean;
  affected: number;
  corrections?: CorrectionRow[];
}

export function useBulkDecide() {
  return useMutation({
    mutationFn: (body: BulkBody) => api.post<BulkResponse>('/api/corrections/bulk', body),
  });
}
