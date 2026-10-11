/**
 * Compare API hooks (brief 05 §4). `GET /api/compare` returns the whole compact
 * snapshot of up to 20 runs; pass refs resolve to their base run server-side
 * (the slice happens in features/compare/lib/model.ts).
 */
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/http';
import type { ComparePayload } from '@/features/compare/lib/model';
import { MAX_COMPARE_RUNS } from '@/features/compare/lib/refs';

export const compareKeys = {
  all: ['compare'] as const,
  runs: (baseIds: string[]) => ['compare', 'runs', ...baseIds] as const,
};

export function compareUrl(baseIds: string[]): string {
  return `/api/compare?${baseIds.map((id) => `files=${encodeURIComponent(id)}`).join('&')}&view=compact`;
}

export async function fetchCompare(baseIds: string[]): Promise<ComparePayload> {
  if (baseIds.length > MAX_COMPARE_RUNS)
    throw new ApiError(422, `Compare at most ${MAX_COMPARE_RUNS} runs at once (${baseIds.length} requested)`);
  return api.get<ComparePayload>(compareUrl(baseIds));
}

/** Enabled once at least two refs are selected. */
export function useCompareQuery(baseIds: string[]) {
  return useQuery({
    queryKey: compareKeys.runs(baseIds),
    queryFn: () => fetchCompare(baseIds),
    enabled: baseIds.length >= 1,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export interface StepGroupLite {
  phase: string;
  step_type?: string;
  kind?: string;
  name?: string;
  n: number;
  mean_ms?: number | null;
  median_ms?: number | null;
  p95_ms?: number | null;
  error_count?: number;
}

export interface CompareStepLatency {
  groups_by_ref?: Record<string, StepGroupLite[]>;
}

/** `GET /api/runs/step-latency` for the compared columns: one lane per ref (a whole run pools its passes). */
export function useCompareStepLatency(refs: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['compare', 'steps', ...refs] as const,
    queryFn: () =>
      api.get<CompareStepLatency>(
        `/api/runs/step-latency?run_ids=${encodeURIComponent(refs.join(','))}&rollup=name&group_by=ref`,
      ),
    enabled: enabled && refs.length > 0,
    staleTime: 60_000,
    retry: false,
  });
}
