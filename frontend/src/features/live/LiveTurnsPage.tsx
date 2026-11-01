import { liveTurnsCsvUrl, parseLiveFilters, useLiveOverview, useLiveTurns } from '@/api/live';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { ErrorState, Icon, LinkButton, PageHeader, Skeleton, Tag, Text } from '@/ui';
import { TurnFilters } from './components/TurnFilters';
import { TurnsTable } from './components/TurnsTable';
import { filterChips } from './lib/filters';
import styles from './turns.module.css';

export function LiveTurnsPage({ slug, source }: { slug: string; source: string }) {
  const { project } = useProjectContext();
  useDocumentTitle(`Turns · Live · ${project.name}`);
  const { params } = useSearchParamsState();
  const filters = { ...parseLiveFilters(params), page_size: 50 };
  const turns = useLiveTurns(slug, filters, source);
  const overview = useLiveOverview(slug, { source, day: filters.day });
  const pending = turns.isPending || overview.isPending;
  const showSkeleton = useDelayedPending(pending);
  const error = turns.isError ? turns.error : overview.isError ? overview.error : null;
  const dateChips = filterChips({ day: filters.day, from: filters.from, to: filters.to }, undefined, []);
  const dayLabel = dateChips.find((chip) => chip.key === 'day')?.label;
  const rangeLabel = dateChips.find((chip) => chip.key === 'from')?.label;
  const description = turns.data
    ? dayLabel && overview.data
      ? `${turns.data.total} of ${overview.data.day.in_qym} turns on ${dayLabel}`
      : `${turns.data.total} turns${rangeLabel ? ` · ${rangeLabel}` : ''}`
    : undefined;

  return (
    <div className={`${fullWidth} ${styles.page}`}>
      <div data-live-block="header">
        <PageHeader
          title="Turns"
          description={description}
          meta={[
            <Tag key="source" kind="data" dir="auto">
              {overview.data?.status.name ?? source}
            </Tag>,
            <Text key="environment" variant="sm" tone="muted" dir="auto">
              {overview.data?.status.environment}
            </Text>,
          ]}
          actions={
            <LinkButton
              href={liveTurnsCsvUrl(slug, filters, source)}
              download
              icon={<Icon name="download" size={14} />}
              data-live-block="export"
            >
              Export CSV
            </LinkButton>
          }
        />
      </div>
      {error ? (
        <ErrorState
          error={error}
          title="Couldn’t load live turns"
          onRetry={() => {
            void turns.refetch();
            void overview.refetch();
          }}
        />
      ) : pending ? (
        <div className={styles.loading} data-live-block="turns-table">
          {showSkeleton ? (
            <Skeleton kind="table" rows={6} label="Loading live turns" className={styles.loading} />
          ) : null}
        </div>
      ) : turns.data && overview.data ? (
        <>
          <TurnFilters filters={filters} facets={turns.data.facets} specs={overview.data.specs} />
          <TurnsTable
            slug={slug}
            source={source}
            filters={filters}
            data={turns.data}
            specs={overview.data.specs}
            refreshing={turns.isFetching}
          />
        </>
      ) : null}
    </div>
  );
}
