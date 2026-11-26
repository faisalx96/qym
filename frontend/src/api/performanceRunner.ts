/** The Runner page: the runner's status, the key that receives the tokens, and the runner's problems. */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/http';
import {
  PERFORMANCE_POLL_ACTIVE_MS,
  PERFORMANCE_POLL_IDLE_MS,
  performanceApiPath,
  performanceRead,
  performanceKeys,
  usePerformanceMutation,
  type PerformanceReceived,
  type PerformanceRunnerEvents,
  type PerformanceRunnerEventsFilters,
  type PerformanceRunnerRead,
  type SetRunnerKeyRequest,
  type SetRunnerKeyResponse,
} from './performance';

/** `GET B/runner`: every 15 s, every 5 s while a run is queued or active; not in a hidden tab. */
export function performanceRunnerQueryOptions(slug: string) {
  return queryOptions({
    queryKey: performanceKeys.runner(slug),
    queryFn: async (): Promise<PerformanceReceived<PerformanceRunnerRead>> => {
      const data = await performanceRead<PerformanceRunnerRead>(performanceApiPath(slug, '/runner'));
      // The client clock when the answer arrived, to read server times without trusting both clocks to agree.
      return { ...data, received_at: Date.now() };
    },
    refetchInterval: (query) =>
      query.state.data?.active_run ? PERFORMANCE_POLL_ACTIVE_MS : PERFORMANCE_POLL_IDLE_MS,
    refetchIntervalInBackground: false,
  });
}

export function usePerformanceRunner(slug: string) {
  return useQuery(performanceRunnerQueryOptions(slug));
}

/**
 * `GET B/runner/events`: the runner's problems and notes, newest first; every 15 s. The previous page
 * stays while the next one loads, unless the level filter changed.
 */
export function performanceRunnerEventsQueryOptions(
  slug: string,
  filters: PerformanceRunnerEventsFilters = {},
) {
  const queryKey = performanceKeys.runnerEvents(slug, filters);
  const clean = queryKey[5];
  return queryOptions({
    queryKey,
    queryFn: () =>
      performanceRead<PerformanceRunnerEvents>(performanceApiPath(slug, '/runner/events', clean)),
    placeholderData: (previous, query) => {
      const before = query?.queryKey[5] as PerformanceRunnerEventsFilters | undefined;
      return query?.queryKey[1] === slug &&
        JSON.stringify(before?.level ?? []) === JSON.stringify(clean.level ?? [])
        ? previous
        : undefined;
    },
    refetchInterval: PERFORMANCE_POLL_IDLE_MS,
    refetchIntervalInBackground: false,
  });
}

export function usePerformanceRunnerEvents(slug: string, filters: PerformanceRunnerEventsFilters = {}) {
  return useQuery(performanceRunnerEventsQueryOptions(slug, filters));
}

/** `PUT B/runner/key`: choose the API key that receives the tokens; null removes the choice. Manager only. */
export function useSetPerformanceRunnerKey(slug: string) {
  return usePerformanceMutation(slug, (api_key_id: string | null) => {
    const body: SetRunnerKeyRequest = { api_key_id };
    return api.put<SetRunnerKeyResponse>(performanceApiPath(slug, '/runner/key'), body);
  });
}
