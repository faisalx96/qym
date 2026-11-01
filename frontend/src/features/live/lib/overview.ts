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

/** Measured impl frames: seven services, fourteen day rows; each extra day is 40px. */
export function overviewFrames(overview: LiveOverview | undefined, daysPage: number): Record<string, string> {
  const services = overview?.day.services.length ?? 7;
  const rows = overview
    ? Math.min(
        overview.days.page_size,
        Math.max(0, overview.days.total - (daysPage - 1) * overview.days.page_size),
      )
    : 14;
  const wide = Math.ceil(services / 7);
  const medium = Math.ceil(services / 3);
  const narrow = Math.ceil(services / 2);
  // Fixed chrome includes the canary line at the measured column width. Wrapping names
  // can still change it: preserve loaded data during day switches instead of estimating again.
  return {
    '--live-services-wide': `${126 + wide * 66}px`,
    '--live-services-medium': `${154 + medium * 66 + Math.max(0, medium - 1) * 14}px`,
    '--live-services-narrow': `${266 + narrow * 66 + Math.max(0, narrow - 1) * 14}px`,
    '--live-days-wide': `${116 + rows * 40}px`,
    '--live-days-medium': `${128 + rows * 40}px`,
    '--live-days-narrow': `${156 + rows * 40}px`,
    '--live-trend-wide': '330px',
    '--live-trend-medium': '330px',
    '--live-trend-narrow': '427px',
  };
}
