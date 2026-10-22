/**
 * Shared bits of the eval-experiments API family (brief 06 §4): the error-envelope
 * readers (`{detail: string | {message, code, errors, ...} | [{loc, msg}]}`) and the
 * environment record every page needs.
 */
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/http';

export type EvalPriority = 'LOW' | 'NORMAL' | 'HIGH';
export const PRIORITIES: EvalPriority[] = ['LOW', 'NORMAL', 'HIGH'];
export type LatencyMinRole = 'member' | 'manager';

export interface ModelSlotsSummary {
  needs_confirmation: boolean;
  counts: { confirmed: number; proposed: number; stale: number };
}

export interface EvalEnvironment {
  id: string;
  project_id: string;
  name: string;
  description: string;
  base_url: string;
  api_key_set: boolean;
  api_key_hint: string | null;
  default_priority: EvalPriority;
  max_priority: EvalPriority;
  /** Who may launch latency-sensitive runs here: anyone in the project or managers only. */
  latency_sensitive_min_role: LatencyMinRole;
  allow_connection_keys: boolean;
  ranking_metric: string | null;
  ranking_k: number | null;
  current_schema_id: string | null;
  schema_hash: string | null;
  schema_fetched_at: string | null;
  evaluator_schema_status: string | null;
  current_evaluator_schema_id: string | null;
  evaluator_schema_hash: string | null;
  evaluator_schema_fetched_at: string | null;
  /** What the service accepts beyond guide v1.3, from its stored evaluator schema. */
  evaluator_capabilities?: { datasets: boolean; task: boolean };
  health_status: 'ok' | 'error' | 'unknown' | string | null;
  health_checked_at: string | null;
  health_error: string | null;
  is_active: boolean;
  model_slots: ModelSlotsSummary;
  official_preset_id: string | null;
  official_preset_version_id: string | null;
  official_preset_version: number | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export const evalEnvironmentsKey = (projectId: string, active?: boolean) =>
  ['eval-environments', projectId, { active: active ?? null }] as const;

export function useEvalEnvironments(projectId: string | undefined, opts: { active?: boolean } = {}) {
  return useQuery({
    queryKey: evalEnvironmentsKey(projectId ?? '', opts.active),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const qs = opts.active === undefined ? '' : `?active=${opts.active}`;
      const r = await api.get<{ environments: EvalEnvironment[] }>(
        `/v1/projects/${projectId}/eval-environments${qs}`,
      );
      return r.environments;
    },
  });
}

/** The parsed `detail` of an error response when it is an object (else null). */
export function errorDetail(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (body && typeof body === 'object') {
    const detail = (body as Record<string, unknown>).detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail))
      return detail as Record<string, unknown>;
  }
  return null;
}

/** `detail.code` (or a top-level `code`) of an error response. */
export function errorCode(error: unknown): string | undefined {
  const detail = errorDetail(error);
  if (detail && typeof detail.code === 'string') return detail.code;
  return error instanceof ApiError ? error.code : undefined;
}

/** One human sentence from any error envelope the platform produces. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  const detail = errorDetail(error);
  if (detail && typeof detail.message === 'string' && detail.message) return detail.message;
  const body = error.body as { detail?: unknown } | null;
  if (body && Array.isArray(body.detail)) {
    return body.detail
      .map((d) =>
        d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d),
      )
      .join('; ');
  }
  if (body && typeof body.detail === 'string') return body.detail;
  return error.detail || error.message;
}

/** A pointer-level server error (`detail.errors[]` of a launch / slot / preset call). */
export interface PointerError {
  pointer?: string;
  slot_key?: string;
  rule?: string;
  message: string;
  environment_id?: string;
  environment_name?: string;
  combo_index?: number;
}

export function errorList(error: unknown): PointerError[] {
  const detail = errorDetail(error);
  const list = detail?.errors;
  return Array.isArray(list) ? (list as PointerError[]) : [];
}
