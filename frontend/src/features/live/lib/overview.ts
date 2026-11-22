import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { liveOverviewQueryOptions, type LiveOverview } from '@/api/live';

type OverviewOptions = Parameters<typeof liveOverviewQueryOptions>[1];

/** Keep day/window changes steady, without showing another source's numbers. */
export function useLiveOverview(slug: string, options: OverviewOptions) {
  return useQuery({
    ...liveOverviewQueryOptions(slug, options),
    placeholderData: (previous, query) =>
      (query?.queryKey[4] as OverviewOptions | undefined)?.source === options.source
        ? keepPreviousData(previous)
        : undefined,
  });
}

/** The most recently loaded overview for this source supplies first-load row counts. */
export function useCachedOverview(slug: string, source: string) {
  const client = useQueryClient();
  const queries = client.getQueryCache().findAll({ queryKey: ['project', slug, 'live', 'overview'] });
  const latest = queries
    .filter(
      (query) => (query.queryKey[4] as OverviewOptions | undefined)?.source === source && query.state.data,
    )
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];
  return latest?.state.data as LiveOverview | undefined;
}

/** First-load estimates for the services table, two chart panels and day rows (40px per row). */
export function overviewFrames(overview: LiveOverview | undefined, daysPage: number): Record<string, string> {
  const services = overview?.day.services.length ?? 7;
  const rows = overview
    ? Math.min(
        overview.days.page_size,
        Math.max(0, overview.days.total - (daysPage - 1) * overview.days.page_size),
      )
    : 14;
  // Names and captions may wrap; keep loaded data during day switches rather than replacing it with estimates.
  return {
    '--live-services-wide': `${100 + services * 40}px`,
    '--live-services-medium': `${100 + services * 40}px`,
    '--live-services-narrow': `${138 + services * 40}px`,
    '--live-days-wide': `${148 + rows * 40}px`,
    '--live-days-medium': `${148 + rows * 40}px`,
    '--live-days-narrow': `${180 + rows * 40}px`,
    '--live-trend-wide': '500px',
    '--live-trend-medium': '520px',
    '--live-trend-narrow': '620px',
  };
}
