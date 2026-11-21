import { useModelIndex } from '@/api/dashboard';
import { overviewFrames, useCachedOverview, useLiveOverview } from './lib/overview';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { formatShortDayKey } from '@/lib/dates';
import { useSearchParamsState } from '@/lib/url-state';
import { projectPath } from '@/app/routes';
import { ErrorState, InlineNotice, LinkButton, PageHeader, Skeleton } from '@/ui';
import { staleText } from './lib/stale';
import { SourceControl } from './components/SourceControl';
import { DaySwitcher } from './components/DaySwitcher';
import { StatusLine } from './components/StatusLine';
import { DayNumbers } from './components/DayNumbers';
import { DiagnosisMix } from './components/DiagnosisMix';
import { MetricMeans } from './components/MetricMeans';
import { ServiceHealth } from './components/ServiceHealth';
import { TrendChart } from './components/TrendChart';
import { DaysTable } from './components/DaysTable';
import { zoneToday } from './lib/zone';
import styles from './live.module.css';

export function LiveOverviewPage({
  slug,
  source,
  day,
  zone: sourceZone,
}: {
  slug: string;
  source: string;
  day: string;
  zone?: string;
}) {
  const { project } = useProjectContext();
  useDocumentTitle(`Live · ${project.name}`);
  const { get, replaceUrlQuery } = useSearchParamsState();
  const requestedTrendDays = Number(get('trend_days', '14'));
  const trendDays = [14, 30, 90].includes(requestedTrendDays) ? requestedTrendDays : 14;
  const requestedDaysPage = Number(get('days_page', '1'));
  const daysPage = Number.isSafeInteger(requestedDaysPage) && requestedDaysPage > 0 ? requestedDaysPage : 1;
  const query = useLiveOverview(slug, { source, day, trendDays, daysPage });
  const modelIndex = useModelIndex(slug);
  const showSkeleton = useDelayedPending(query.isPending);
  const overview = query.data;
  const zone = overview?.status.day_key_timezone ?? sourceZone;
  const today = overview?.status.today ?? zoneToday(zone);
  const period = day === today ? 'today' : `on ${formatShortDayKey(day)}`;
  const cachedOverview = useCachedOverview(slug, source);
  const linkTo = (filters: Record<string, string> = {}) =>
    `/projects/${encodeURIComponent(slug)}/live/turns?${new URLSearchParams({ day, source, ...filters })}`;

  return (
    <div className={`${fullWidth} ${styles.page}`}>
      <div className={styles.overviewHeader} data-live-block="header">
        <PageHeader
          title="Live evaluation"
          description="Every real user turn, evaluated as it happens"
          meta={[
            // cv5 Y4: the source and the day are controls side by side, one meta item: no "·" separator between them
            <span key="controls" className={styles.headerControls}>
              <SourceControl slug={slug} source={source} status={overview?.status} />
              <DaySwitcher day={day} today={today} />
            </span>,
          ]}
          actions={
            <LinkButton to={`${projectPath(slug, 'live/worker')}?${new URLSearchParams({ source })}`}>
              Manage worker
            </LinkButton>
          }
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
            <Skeleton kind="chart" height="var(--live-means-height)" label="Loading average scores" />
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
          {overview.status.stale ? (
            <InlineNotice tone="danger" lead="Stale." data-testid="live-stale-notice">
              {`${staleText(overview.status)}.`}
            </InlineNotice>
          ) : null}
          <StatusLine status={overview.status} slug={slug} source={source} modelIndex={modelIndex} />
          <DayNumbers overview={overview} linkTo={linkTo} period={period} />
          <div className={styles.mixRow}>
            <DiagnosisMix overview={overview} linkTo={linkTo} period={period} />
            <MetricMeans overview={overview} period={period} />
          </div>
          <ServiceHealth
            services={overview.day.services}
            canaries={overview.canaries}
            specs={overview.specs}
            linkTo={linkTo}
            period={period}
          />
          <TrendChart
            zone={zone}
            trend={overview.trend}
            specs={overview.specs}
            primaryMetric={overview.primary_metric}
            days={trendDays}
            onDays={(value) => replaceUrlQuery({ trend_days: value })}
          />
          <DaysTable
            zone={zone}
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
