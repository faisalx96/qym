import { useCallback, useContext, useSyncExternalStore } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import type { LiveSourceInfo } from '@/api/live';

/** Reuse the page's source query, including late arrival, until its shell passes zone directly. No extra request. */
export function useTurnZone(sourceId: string, zone?: string) {
  const client = useContext(QueryClientContext);
  const subscribe = useCallback(
    (notify: () => void) => client?.getQueryCache().subscribe(notify) ?? (() => {}),
    [client],
  );
  const snapshot = useCallback(() => {
    if (zone !== undefined) return zone;
    return client
      ?.getQueriesData<{ sources: LiveSourceInfo[] }>({
        predicate: (query) => query.queryKey[2] === 'live' && query.queryKey[3] === 'sources',
      })
      .flatMap(([, value]) => value?.sources ?? [])
      .find((source) => source.id === sourceId)?.day_key_timezone;
  }, [client, sourceId, zone]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
