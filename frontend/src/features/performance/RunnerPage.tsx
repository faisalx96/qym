/** The Runner page: the runner's status, the key that receives the tokens, how to connect one, its problems. */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Key } from 'react-aria-components';
import {
  isPerformanceSwitchedOff,
  type PerformanceLogLevel,
  type PerformanceRunnerRead,
} from '@/api/performance';
import {
  performanceRunnerEventsQueryOptions,
  usePerformanceRunner,
  usePerformanceRunnerEvents,
} from '@/api/performanceRunner';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useSearchParamsState } from '@/lib/url-state';
import {
  Card,
  CardTitle,
  CopyButton,
  EmptyState,
  ErrorState,
  InlineNotice,
  KeyValueGrid,
  PageHeader,
  Skeleton,
  StaleBanner,
} from '@/ui';
import { EVENTS_PAGE_SIZE, EventsTable } from './components/runner/EventsTable';
import { SwitchedOff } from './components/home/SwitchedOff';
import { KeyCard, KeyFrame } from './components/runner/KeyCard';
import { StatusCard, StatusFrame } from './components/runner/StatusCard';
import { span } from './lib/format';
import styles from './components/runner/runner.module.css';

const LEVELS: PerformanceLogLevel[] = ['info', 'warning', 'error'];

const DESCRIPTION =
  'The program that sends the load. It asks this project for a run, runs it and reports back.';

/** How to connect a runner; skeleton values while the page loads (§7). */
function ConnectCard({ read }: { read?: PerformanceRunnerRead }) {
  return (
    <Card
      as="section"
      aria-label="Connect a runner"
      data-performance-block="runner-connect"
      header={
        <CardTitle
          title="Connect a runner"
          description="What an operator types into the runner's settings."
        />
      }
    >
      <KeyValueGrid
        columns={2}
        aria-label="Settings for the runner"
        items={[
          {
            key: 'project',
            label: 'Project id',
            value: read ? (
              <span className={styles.row}>
                <span className={styles.number}>{read.connect.project_id}</span>
                <CopyButton text={read.connect.project_id} label="Copy the project id" />
              </span>
            ) : (
              // The id and its copy button: one control-high line.
              <Skeleton
                kind="value"
                height="var(--control-height)"
                width="36ch"
                label="Loading: Project id"
              />
            ),
          },
          {
            key: 'path',
            label: 'Address path',
            value: read ? (
              <span className={styles.row}>
                <span className={styles.host}>{read.connect.runner_path}</span>
                <CopyButton text={read.connect.runner_path} label="Copy the address path" />
              </span>
            ) : (
              // The address path runs to two lines (three in a phone column), its copy button under it.
              <span className={styles.column}>
                <span className={styles.pathBone}>
                  <Skeleton kind="chart" height="100%" width="100%" label="Loading: Address path" />
                </span>
                <Skeleton
                  kind="chart"
                  height="var(--control-height)"
                  width="var(--control-height)"
                  label="Loading"
                />
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}

export function RunnerPage({ slug }: { slug: string }) {
  useDocumentTitle('Runner · Performance');
  const query = usePerformanceRunner(slug);
  // The list's view lives in the address (?level=…&q=…&page=…), like the runs list on Home.
  const { params, replaceUrlQuery } = useSearchParamsState();
  const levels = useMemo(
    () => new Set<Key>(params.getAll('level').filter((key) => LEVELS.includes(key as PerformanceLogLevel))),
    [params],
  );
  const search = params.get('q') ?? '';
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const setPage = (next: number) => replaceUrlQuery({ page: next === 1 ? null : next });
  const events = usePerformanceRunnerEvents(slug, {
    page,
    limit: EVENTS_PAGE_SIZE,
    level: [...levels].map(String) as PerformanceLogLevel[],
    q: search || undefined,
  });
  // While a level narrows the list, the footer says what it was filtered from: the first page of the whole list
  // (the same read the page makes with no filter, so it is usually in the cache already).
  const narrowed = levels.size > 0 || search !== '';
  const whole = useQuery({
    ...performanceRunnerEventsQueryOptions(slug, { page: 1, limit: EVENTS_PAGE_SIZE, level: [] }),
    enabled: narrowed,
  });
  const onLevels = (keys: Set<Key>) => replaceUrlQuery({ level: [...keys].map(String), page: null });
  const onSearch = (text: string) => replaceUrlQuery({ q: text.trim() ? text : null, page: null });
  const onClear = () => replaceUrlQuery({ level: null, q: null, page: null });
  // A page past the end (entries were cleaned up, or the filter left fewer): go to the last one that exists.
  const last = events.data ? Math.max(1, Math.ceil(events.data.total / EVENTS_PAGE_SIZE)) : null;
  const pastEnd = last !== null && !events.isPlaceholderData && page > last;
  useEffect(() => {
    if (pastEnd && last !== null) replaceUrlQuery({ page: last === 1 ? null : last });
  }, [pastEnd, last, replaceUrlQuery]);

  const read = query.data;
  if (query.isError && isPerformanceSwitchedOff(query.error))
    return (
      <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
        <PageHeader title="Runner" description={DESCRIPTION} />
        <div className={styles.body}>
          <SwitchedOff />
        </div>
      </div>
    );
  if (!read)
    return (
      <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
        <PageHeader title="Runner" description={DESCRIPTION} />
        <div className={styles.body}>
          {query.isError ? (
            // The first read failed: nothing was shown yet, so the page is the error (§3.7).
            <ErrorState
              error={query.error}
              title="Couldn’t load the runner"
              onRetry={() => void query.refetch()}
            />
          ) : (
            // The loaded layout with skeleton values (§7): status, key, how to connect, the problems and notes.
            <div className={styles.frame} data-performance-loading="runner">
              <StatusFrame />
              <KeyFrame />
              <ConnectCard />
              <EventsTable
                slug={slug}
                events={events.data?.events}
                total={events.data?.total ?? 0}
                page={page}
                onPage={setPage}
                levels={levels}
                onLevels={onLevels}
                search={search}
                onSearch={onSearch}
                onClear={onClear}
                active={null}
                loading={events.isPending}
              />
            </div>
          )}
        </div>
      </div>
    );
  const runner = read.runner;
  // The events keep their last page under the banner too; only a list never shown shows its own error.
  const stale = query.isError || (events.isError && events.data !== undefined);
  return (
    <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
      <PageHeader title="Runner" description={DESCRIPTION} />
      <div className={styles.body}>
        {/* A refresh that fails after the page was shown keeps the last read, dimmed, under the banner (§3.7). */}
        {stale ? (
          <StaleBanner
            since={new Date(Math.min(query.dataUpdatedAt, events.dataUpdatedAt || query.dataUpdatedAt))}
            filtersApplied={!events.isError}
            onRetry={() => {
              void query.refetch();
              void events.refetch();
            }}
          />
        ) : null}
        {runner && !runner.fresh ? (
          // From the moment the runner no longer counts as connected; the stronger words once a run would be ended.
          <InlineNotice tone="danger" lead="Not reporting." data-testid="performance-runner-notice">
            The runner has not reported
            {runner.seconds_since_heartbeat === null
              ? ''
              : ` for ${span(runner.seconds_since_heartbeat)}`}.{' '}
            {runner.stale
              ? `A run in progress is ended after ${span(read.settings.stale_after_s)} of silence and cannot continue. New runs cannot start until the runner reports again.`
              : `New runs cannot start until it reports again. If the silence reaches ${span(read.settings.stale_after_s)}, a run in progress is ended and cannot continue.`}
          </InlineNotice>
        ) : null}
        {runner ? (
          <StatusCard read={read} runner={runner} />
        ) : (
          <Card data-performance-block="runner-none">
            <EmptyState
              title="No runner is connected yet"
              body="Start a runner with the settings below. It appears here when it reports for the first time."
            />
          </Card>
        )}
        <KeyCard slug={slug} read={read} />
        <ConnectCard read={read} />
        <EventsTable
          slug={slug}
          events={events.data?.events}
          total={events.data?.total ?? 0}
          page={page}
          onPage={setPage}
          levels={levels}
          onLevels={onLevels}
          search={search}
          onSearch={onSearch}
          onClear={onClear}
          // The runner read counts the entries, so the loading rows follow the data (§7).
          expected={narrowed ? undefined : Math.max(0, read.events_total - (page - 1) * EVENTS_PAGE_SIZE)}
          wholeTotal={narrowed ? whole.data?.total : undefined}
          active={read.active_run}
          loading={events.isPending}
          refreshing={stale || events.isPlaceholderData}
          error={events.data ? undefined : (events.error ?? undefined)}
          onRetry={() => void events.refetch()}
        />
      </div>
    </div>
  );
}
