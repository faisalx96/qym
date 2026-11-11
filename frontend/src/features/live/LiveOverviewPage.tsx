import { overviewFrames, useCachedOverview, useLiveOverview } from './lib/overview';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { ErrorState, PageHeader, Skeleton } from '@/ui';
import { SourceControl } from './components/SourceControl';
import { DaySwitcher } from './components/DaySwitcher';
import { StatusLine } from './components/StatusLine';
import { DayNumbers } from './components/DayNumbers';
import { DiagnosisMix } from './components/DiagnosisMix';
import { MetricMeans } from './components/MetricMeans';
import { ServiceHealth } from './components/ServiceHealth';
import { Canaries } from './components/Canaries';
import { TrendChart } from './components/TrendChart';
import { DaysTable } from './components/DaysTable';
import styles from './live.module.css';

export function LiveOverviewPage({ slug, source, day }: { slug: string; source: string; day: string }) {
  const { project } = useProjectContext();
  useDocumentTitle(`Live · ${project.name}`);
  const { get, replaceUrlQuery } = useSearchParamsState();
  const requestedTrendDays = Number(get('trend_days', '14'));
  const trendDays = [14, 30, 90].includes(requestedTrendDays) ? requestedTrendDays : 14;
  const requestedDaysPage = Number(get('days_page', '1'));
  const daysPage = Number.isSafeInteger(requestedDaysPage) && requestedDaysPage > 0 ? requestedDaysPage : 1;
  const query = useLiveOverview(slug, { source, day, trendDays, daysPage });
  const showSkeleton = useDelayedPending(query.isPending);
  const overview = query.data;
  const cachedOverview = useCachedOverview(slug, source);
  const linkTo = (filters: Record<string, string> = {}) =>
    `/projects/${encodeURIComponent(slug)}/live/turns?${new URLSearchParams({ day, source, ...filters })}`;

  return (
    <div className={`${fullWidth} ${styles.page}`}>
      <div data-live-block="header">
        <PageHeader
          title="Live evaluation"
          description="Every real user turn, evaluated as it happens"
          meta={[
            <SourceControl key="source" slug={slug} source={source} status={overview?.status} />,
            <DaySwitcher key="day" day={day} />,
          ]}
        />
      </div>
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Couldn’t load live evaluation"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {!query.isError && (query.isPending || showSkeleton) ? (
        <div
          className={styles.loading}
          style={overviewFrames(cachedOverview, daysPage)}
          data-live-loading="true"
          data-visible={showSkeleton ? 'true' : 'false'}
        >
          <Skeleton kind="chart" height="var(--live-status-height)" label="Loading worker status" />
          <Skeleton kind="chart" height="var(--live-tiles-height)" label="Loading day numbers" />
          <div className={styles.mixRow}>
            <Skeleton kind="chart" height="var(--live-mix-height)" label="Loading diagnosis mix" />
            <Skeleton kind="chart" height="var(--live-means-height)" label="Loading metric means" />
          </div>
          <Skeleton
            kind="chart"
            height="var(--live-services-height)"
            label="Loading service health and canaries"
          />
          <Skeleton kind="chart" height="var(--live-trend-height)" label="Loading turns over time" />
          <Skeleton kind="chart" height="var(--live-days-height)" label="Loading days" />
        </div>
      ) : overview ? (
        <>
          <StatusLine status={overview.status} slug={slug} source={source} />
          <DayNumbers overview={overview} linkTo={linkTo} />
          <div className={styles.mixRow}>
            <DiagnosisMix overview={overview} linkTo={linkTo} />
            <MetricMeans overview={overview} />
          </div>
          <ServiceHealth services={overview.day.services} specs={overview.specs} linkTo={linkTo}>
            <Canaries canaries={overview.canaries} specs={overview.specs} />
          </ServiceHealth>
          <TrendChart
            trend={overview.trend}
            specs={overview.specs}
            primaryMetric={overview.primary_metric}
            days={trendDays}
            onDays={(value) => replaceUrlQuery({ trend_days: value })}
          />
          <DaysTable
            days={overview.days}
            slug={slug}
            source={source}
            specs={overview.specs}
            primaryMetric={overview.primary_metric}
            stale={overview.status.stale}
          />
        </>
      ) : null}
    </div>
  );
}
