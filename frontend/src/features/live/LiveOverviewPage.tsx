import { useMemo } from 'react';
import { useLiveOverview, useLiveSources } from '@/api/live';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { useTopbarStats } from '@/features/shell/TopbarStats';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { formatPercentValue } from '@/lib/format';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { ErrorState, PageHeader, Select, Skeleton, Tag } from '@/ui';
import { DaySwitcher } from './components/DaySwitcher';
import { StatusLine } from './components/StatusLine';
import { DayNumbers } from './components/DayNumbers';
import { DiagnosisMix } from './components/DiagnosisMix';
import { MetricMeans } from './components/MetricMeans';
import styles from './live.module.css';

export function LiveOverviewPage({ slug, source, day }: { slug: string; source: string; day: string }) {
  const { project } = useProjectContext();
  useDocumentTitle(`Live · ${project.name}`);
  const { replaceUrlQuery } = useSearchParamsState();
  const sourcesQuery = useLiveSources(slug);
  const query = useLiveOverview(slug, { source, day });
  const showSkeleton = useDelayedPending(query.isPending);
  const overview = query.data;
  const sources = sourcesQuery.data?.sources ?? [];
  const current = overview?.status ?? sources.find((item) => item.key === source || item.id === source);
  const stats = useMemo(() => {
    if (!overview) return null;
    const primary = overview.specs.find((spec) => spec.metric_name === overview.primary_metric);
    const mean = overview.day.metric_means.find(
      (metric) => metric.metric_name === overview.primary_metric,
    )?.mean;
    return [
      { label: 'turns', value: overview.day.row?.turns_seen ?? overview.day.in_qym },
      { label: primary?.label ?? 'Primary metric', value: formatPercentValue(mean, 0) },
    ];
  }, [overview]);
  useTopbarStats(stats);
  const linkTo = (filters: Record<string, string> = {}) =>
    `/projects/${encodeURIComponent(slug)}/live/turns?${new URLSearchParams({ day, source, ...filters })}`;

  return (
    <div className={`${fullWidth} ${styles.page}`}>
      <div data-live-block="header">
        <PageHeader
          title="Live evaluation"
          description="Every real user turn, evaluated as it happens"
          meta={[
            <span key="source" className={styles.inline} data-live-block="source">
              {sources.length > 1 ? (
                <Select
                  label="Live source"
                  hideLabel
                  items={sources.map((item) => ({ key: item.key, label: item.name }))}
                  value={current?.key ?? source}
                  onChange={(key) => {
                    if (key !== null) replaceUrlQuery({ source: String(key) });
                  }}
                  renderItem={(item) => <span dir="auto">{item.label}</span>}
                  renderValue={(item) => <span dir="auto">{item.label}</span>}
                />
              ) : (
                <Tag kind="data" dir="auto">
                  {current?.name ?? source}
                </Tag>
              )}
              {current?.environment ? (
                <Tag kind="data" dir="auto">
                  {current.environment}
                </Tag>
              ) : null}
            </span>,
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
      {query.isPending || showSkeleton ? (
        <div
          className={styles.loading}
          data-live-loading="true"
          data-visible={showSkeleton ? 'true' : 'false'}
        >
          <Skeleton kind="chart" height="var(--live-status-height)" label="Loading worker status" />
          <Skeleton kind="chart" height="var(--live-tiles-height)" label="Loading day numbers" />
          <div className={styles.mixRow}>
            <Skeleton kind="chart" height="var(--live-mix-height)" label="Loading diagnosis mix" />
            <Skeleton kind="chart" height="var(--live-means-height)" label="Loading metric means" />
          </div>
        </div>
      ) : overview ? (
        <>
          <StatusLine status={overview.status} />
          <DayNumbers overview={overview} linkTo={linkTo} />
          <div className={styles.mixRow}>
            <DiagnosisMix overview={overview} linkTo={linkTo} />
            <MetricMeans overview={overview} />
          </div>
        </>
      ) : null}
      <div data-live-block="more" />
    </div>
  );
}
