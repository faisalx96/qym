/** Runs data for one view: filters → overview (facets, metrics, KPIs) + page + pinned rows, live cadence, revision sync. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOverview, useRunsPage, type RunsBody } from '@/api/dashboard';
import type { RunRow, RunsPage } from '@/api/dashboardTypes';
import { collatedColumn, collation, DEFAULT_SORT } from '@/lib/runs-order';
import { buildColumns, sortColumnVisible } from './columns';
import { useRefetchOnVisible, useRunsCadence } from './polling';
import { DEFAULT_VIEW, filterKey, PAGE_SIZE, viewToFilters, type RunsView } from './urlState';

export function useRunsData(
  slug: string,
  view: RunsView,
  visibleKeys: Set<string> | null,
  pinnedIds: string[],
) {
  const key = filterKey(view);
  const filters = useMemo(() => viewToFilters({ ...DEFAULT_VIEW, ...JSON.parse(key) } as RunsView), [key]);

  const overviewQ = useOverview(slug, filters);
  const overview = overviewQ.data;

  // Metrics/trace columns come from the overview; a hidden sort column falls back to time-desc.
  const traceWithData = useMemo(
    () =>
      new Set<string>(
        overview?.has_trace_stats
          ? ['avg_tokens', 'avg_llm_calls', 'avg_tool_calls', 'tool_success_rate']
          : [],
      ),
    [overview?.has_trace_stats],
  );
  const columnSet = useMemo(
    () => buildColumns(overview?.all_metrics ?? [], traceWithData, visibleKeys),
    [overview?.all_metrics, traceWithData, visibleKeys],
  );
  // A metric/trace sort waits for the overview (the column set is empty until it lands): no flash of time-desc.
  const needsColumns = /^(metric-|trace-)/.test(view.sort);
  const columnsKnown = !needsColumns || Boolean(overview);
  const sort = !columnsKnown || sortColumnVisible(view.sort, columnSet.visible) ? view.sort : DEFAULT_SORT;

  const column = collatedColumn(sort);
  const order = column
    ? collation(sort, overview?.sort_values?.[column as keyof NonNullable<typeof overview>['sort_values']])
    : null;
  const ready = (!column || Boolean(overview)) && columnsKnown;

  const body: RunsBody = {
    project_slug: slug,
    filters,
    sort,
    limit: PAGE_SIZE,
    offset: (view.page - 1) * PAGE_SIZE,
    ids: [],
    include_overview: false,
    collation: order,
  };
  const cadence = useRef<number | false>(60_000);
  const runsQ = useRunsPage(body, { enabled: ready, refetchInterval: () => cadence.current });
  // A failed page request keeps the last rows that did load (dimmed, under the stale banner)
  // instead of replacing the table with an error.
  const bodyKey = JSON.stringify(body);
  const [good, setGood] = useState<{ key: string; data: RunsPage; at: number } | null>(null);
  if (runsQ.data && !runsQ.isPlaceholderData && good?.data !== runsQ.data)
    setGood({ key: bodyKey, data: runsQ.data, at: runsQ.dataUpdatedAt || Date.now() });
  const failed = runsQ.isError;
  const data = runsQ.data ?? (failed ? good?.data : undefined);
  /** The request that failed asked for a different view than the rows on screen. */
  const viewNotApplied = failed && Boolean(good) && good!.key !== bodyKey;
  const refetch = runsQ.refetch;
  const onAnnounce = useCallback(() => void refetch(), [refetch]);
  const interval = useRunsCadence(
    { rows: data?.rows ?? [], freshness: data?.freshness, hasActiveRuns: overview?.has_active_runs },
    onAnnounce,
  );
  useEffect(() => {
    cadence.current = interval;
  }, [interval]);
  useRefetchOnVisible(onAnnounce);

  // The overview (facets, KPIs, metric list) is refetched only when the catalog revision moved.
  const rev = data?.catalog_revision ?? data?.revision;
  const overviewRev = overview?.catalog_revision ?? overview?.revision;
  const requestedRev = useRef<unknown>(undefined);
  const refetchOverview = overviewQ.refetch;
  useEffect(() => {
    if (rev === undefined || overviewRev === undefined || rev === overviewRev || requestedRev.current === rev)
      return;
    requestedRev.current = rev;
    void refetchOverview();
  }, [rev, overviewRev, refetchOverview]);

  // Off-page selected runs (Compare / Delete need their rows): one `ids` round trip, ≤100.
  const pageIds = useMemo(() => new Set((data?.rows ?? []).map((r) => r.run_id)), [data?.rows]);
  const offPage = useMemo(
    () =>
      pinnedIds
        .filter((id) => !pageIds.has(id))
        .slice(0, 100)
        .sort(),
    [pinnedIds, pageIds],
  );
  const pinnedQ = useRunsPage(
    { project_slug: slug, filters: {}, sort: DEFAULT_SORT, limit: 1, offset: 0, ids: offPage },
    { enabled: offPage.length > 0 && Boolean(data), keepPrevious: false },
  );
  const pinnedRows: RunRow[] = useMemo(() => pinnedQ.data?.pinned_rows ?? [], [pinnedQ.data]);

  return {
    filters,
    overviewQ,
    overview,
    runsQ,
    data,
    rows: data?.rows ?? [],
    total: data?.total_runs ?? 0,
    projectTotal: data?.total_count ?? overview?.total_count ?? 0,
    columnSet,
    sort,
    pinnedRows,
    pinnedReady: offPage.length === 0 || pinnedQ.isSuccess,
    offPageCount: offPage.length,
    refetch,
    viewNotApplied,
    updatedAt: runsQ.dataUpdatedAt
      ? new Date(runsQ.dataUpdatedAt)
      : failed && good
        ? new Date(good.at)
        : null,
  };
}
