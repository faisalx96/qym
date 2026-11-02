/** Feedback API hooks (`/v1/feedback*`, `/v1/admin/feedback-agent*`): spec-e section 6. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch } from '@/lib/http';

export type FeedbackStatus = 'draft' | 'new' | 'accepted' | 'planned' | 'done' | 'declined';
export type FeedbackPriority = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackComplexity = 'S' | 'M' | 'L' | 'XL';
export type FeedbackSubject = 'platform' | 'product';
export type RelatedKind = 'duplicate' | 'conflict' | 'related';
export type ChecklistState = 'open' | 'partial' | 'filled' | 'declined';
export type TargetKind = 'run' | 'experiment' | 'dataset';

export interface ProjectRef {
  id: string;
  name: string;
  slug: string;
}

export interface FeedbackRow {
  id: string;
  ref: string;
  number: number | null;
  title: string;
  summary: string;
  subject: FeedbackSubject;
  project: ProjectRef | null;
  priority: FeedbackPriority | null;
  complexity: FeedbackComplexity | null;
  status: FeedbackStatus;
  submitter: { id: string; name: string };
  created_at: string | null;
  confirmed_at: string | null;
  duplicate_of: string | null;
  possible_duplicate_of: string | null;
}

export interface FeedbackDraftRow {
  id: string;
  title: string;
  subject: FeedbackSubject;
  project: ProjectRef | null;
  message_count: number;
  last_activity_at: string;
  days_left: number;
}

export interface FeedbackList {
  items: FeedbackRow[];
  children: Record<string, FeedbackRow[]>;
  total: number;
  matching: number;
  page: number;
  page_size: number;
  facets: { projects: (ProjectRef & { count: number })[] };
  counts: { all: number; new: number; duplicate_pairs: number };
  drafts: FeedbackDraftRow[];
  draft_retention_days: number;
  configured: boolean;
}

export interface FeedbackListParams {
  status?: string;
  about?: string;
  project_id?: string;
  priority?: string;
  complexity?: string;
  q?: string;
  mine?: boolean;
  sort?: string;
  page?: number;
  page_size?: number;
}

export interface ChecklistItem {
  key: string;
  label: string;
  state: ChecklistState;
  value: string;
}

export interface ProposalRelated {
  request_id: string;
  kind: RelatedKind;
  note: string;
  title: string;
  status: FeedbackStatus;
}

export interface Proposal {
  seq: number;
  title: string;
  summary: string;
  description: string;
  business_need: string;
  justification: string;
  priority: { level: FeedbackPriority; reasoning: string };
  complexity: { level: FeedbackComplexity; reasoning: string };
  related: ProposalRelated[];
  open_gaps: string[];
  repaired: string[];
  superseded: boolean;
}

export interface FeedbackEvent {
  id: number;
  kind: 'submitted' | 'status' | 'priority' | 'complexity' | 'duplicate' | 'duplicate_cleared' | 'declined';
  actor: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  note: string;
  created_at: string;
}

export interface RelatedItem {
  kind: RelatedKind;
  note: string;
  direction: 'outgoing' | 'canonical' | 'duplicate';
  request: { id: string; ref: string; title: string; status: FeedbackStatus };
}

export interface FeedbackRequestDetail extends FeedbackRow {
  description: string;
  business_need: string;
  justification: string;
  decline_reason: string | null;
  target: { kind: TargetKind; id: string; accessible: boolean } | null;
  phase: 'asking' | 'thinking' | 'proposed' | null;
  agent: {
    priority: FeedbackPriority | null;
    complexity: FeedbackComplexity | null;
    priority_reasoning: string | null;
    complexity_reasoning: string | null;
  };
  updated_at: string | null;
}

export interface DraftInfo {
  retention_days: number;
  days_left: number;
  last_activity_at: string;
  user_message_count: number;
  max_user_messages: number;
  configured: boolean;
}

export interface FeedbackDetail {
  request: FeedbackRequestDetail;
  events: FeedbackEvent[];
  related: RelatedItem[];
  checklist: ChecklistItem[];
  proposal: Proposal | null;
  draft?: DraftInfo;
  new_events?: FeedbackEvent[];
}

export interface FeedbackMessage {
  id: number;
  seq: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name: string | null;
  ids: string[];
  kind: string | null;
  status: 'ok' | 'stopped' | 'interrupted';
  created_at: string;
}

export interface FeedbackMessages {
  messages: FeedbackMessage[];
  has_more: boolean;
  author: string;
  submitted_at: string | null;
}

export interface FeedbackStatusInfo {
  configured: boolean;
  encryption_ready: boolean;
  can_configure: boolean;
}

export const feedbackKeys = {
  all: ['feedback'] as const,
  status: ['feedback', 'status'] as const,
  list: (params: FeedbackListParams) => ['feedback', 'list', params] as const,
  detail: (ref: string) => ['feedback', 'detail', ref] as const,
  messages: (ref: string) => ['feedback', 'messages', ref] as const,
  agent: ['feedback', 'agent'] as const,
};

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    sp.set(k, v === true ? 'true' : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useFeedbackStatus() {
  return useQuery({
    queryKey: feedbackKeys.status,
    queryFn: () => api.get<FeedbackStatusInfo>('/v1/feedback/status'),
    staleTime: 10_000,
  });
}

export function useFeedbackList(params: FeedbackListParams) {
  return useQuery({
    queryKey: feedbackKeys.list(params),
    queryFn: () => api.get<FeedbackList>(`/v1/feedback${qs({ ...params })}`),
    placeholderData: keepPreviousData,
  });
}

export function useFeedbackRequest(ref: string) {
  return useQuery({
    queryKey: feedbackKeys.detail(ref),
    queryFn: () => api.get<FeedbackDetail>(`/v1/feedback/${encodeURIComponent(ref)}`),
  });
}

export function useFeedbackMessages(ref: string, enabled = true) {
  return useQuery({
    queryKey: feedbackKeys.messages(ref),
    queryFn: () => api.get<FeedbackMessages>(`/v1/feedback/${encodeURIComponent(ref)}/messages?limit=50`),
    enabled,
  });
}

export async function loadOlderMessages(ref: string, beforeSeq: number): Promise<FeedbackMessages> {
  return api.get<FeedbackMessages>(
    `/v1/feedback/${encodeURIComponent(ref)}/messages?limit=50&before_seq=${beforeSeq}`,
  );
}

export interface CreateDraftBody {
  subject: FeedbackSubject;
  project_id?: string;
  target?: { kind: TargetKind; id: string };
  message: string;
}

export function useCreateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDraftBody) => api.post<{ id: string; status: 'draft' }>('/v1/feedback', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'list'] }),
  });
}

export interface ConfirmBody {
  title: string;
  description: string;
  priority: FeedbackPriority;
  complexity: FeedbackComplexity;
  proposal_seq: number;
}

export function useConfirmFeedback(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfirmBody) =>
      api.post<FeedbackDetail>(`/v1/feedback/${encodeURIComponent(ref)}/confirm`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackKeys.all }),
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) => api.delete<void>(`/v1/feedback/${encodeURIComponent(ref)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackKeys.all }),
  });
}

export interface TriageBody {
  status?: FeedbackStatus;
  priority?: FeedbackPriority;
  complexity?: FeedbackComplexity;
  duplicate_of?: string | null;
  note?: string;
  decline_reason?: string;
  expected_updated_at: string;
}

export function useTriageFeedback(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TriageBody) =>
      api.patch<FeedbackDetail>(`/v1/feedback/${encodeURIComponent(ref)}/triage`, body),
    onSuccess: (data) => {
      qc.setQueryData(feedbackKeys.detail(ref), data);
      qc.invalidateQueries({ queryKey: ['feedback', 'list'] });
    },
  });
}

export async function stopTurn(ref: string): Promise<void> {
  await apiFetch<void>(`/v1/feedback/${encodeURIComponent(ref)}/stop`, { method: 'POST' });
}

// ── Export (administrators) ──────────────────────────────────────────────

export const EXPORT_FORMATS = [
  { id: 'csv', label: 'CSV' },
  { id: 'xlsx', label: 'Excel (.xlsx)' },
  { id: 'json', label: 'JSON' },
  { id: 'jsonl', label: 'JSON Lines' },
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number]['id'];

export function exportPath(format: ExportFormat, params: FeedbackListParams): string {
  const { status, about, project_id, priority, complexity, q, sort } = params;
  return `/v1/feedback/export${qs({ format, status, about, project_id, priority, complexity, q, sort })}`;
}

/** Download the current filter's rows. Returns the file name the server chose. */
export async function downloadExport(format: ExportFormat, params: FeedbackListParams): Promise<string> {
  const { platformUrl } = await import('@/lib/runtime');
  const response = await fetch(platformUrl(exportPath(format, params)), { credentials: 'same-origin' });
  if (!response.ok) {
    const { ApiError } = await import('@/lib/http');
    let detail = '';
    try {
      detail = String(((await response.json()) as { detail?: unknown }).detail ?? '');
    } catch {
      /* not JSON */
    }
    throw new ApiError(response.status, detail);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `feedback.${format}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

// ── Admin: the assistant's connection ────────────────────────────────────

export interface AgentAdmin {
  configured: boolean;
  encryption_ready: boolean;
  connection: { llm_base_url: string; llm_model: string; llm_api_key_set: boolean; llm_api_key_hint: string };
  behaviour: { draft_retention_days: number; max_user_messages: number };
  last_test: { at: string | null; ok: boolean | null; detail: string | null };
  counts: { requests: number; new: number; open_drafts: number; assistant_calls_7d: number };
  updated_at: string | null;
}

export interface AgentTestResult {
  ok: boolean;
  model: string;
  latency_ms: number;
  tool_call: boolean;
  detail: string;
}

export function useAgentAdmin(enabled = true) {
  return useQuery({
    queryKey: feedbackKeys.agent,
    queryFn: () => api.get<AgentAdmin>('/v1/admin/feedback-agent'),
    enabled,
  });
}

export interface AgentConnectionBody {
  llm_base_url?: string;
  llm_model?: string;
  llm_api_key?: string;
  draft_retention_days?: number;
  max_user_messages?: number;
}

export function useSaveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentConnectionBody) => api.put<AgentAdmin>('/v1/admin/feedback-agent', body),
    onSuccess: (data) => {
      qc.setQueryData(feedbackKeys.agent, data);
      qc.invalidateQueries({ queryKey: feedbackKeys.status });
    },
  });
}

export function useTestAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentConnectionBody) =>
      api.post<AgentTestResult>('/v1/admin/feedback-agent/test', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackKeys.agent }),
  });
}

export function useRemoveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>('/v1/admin/feedback-agent'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: feedbackKeys.agent });
      qc.invalidateQueries({ queryKey: feedbackKeys.status });
    },
  });
}

export function useFeedbackTargets(project: string, kind: TargetKind | 'none') {
  return useQuery({
    queryKey: ['feedback', 'targets', project, kind],
    queryFn: () =>
      api.get<{ items: { id: string; label: string }[] }>(
        `/v1/feedback/targets${qs({ project_id: project, kind })}`,
      ),
    enabled: Boolean(project) && kind !== 'none',
  });
}
