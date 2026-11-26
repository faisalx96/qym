/** Performance home: the runner in one line, the run in progress, the capacity of one target, and every run. */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Key } from 'react-aria-components';
import {
  isPerformanceSwitchedOff,
  performanceRunsQueryOptions,
  type PerformanceHome,
  type PerformanceRunsFilters,
  type PerformanceTestType,
} from '@/api/performance';
import { useMixedPerformanceHome, isPlatformTarget, isPlatformRun } from '@/api/performancePlatform';
import { MixedHome } from './components/platform/PlatformHome';
import { performancePath } from '@/app/routes';
import { readOnlyReason, useOptionalProject } from '@/features/shell/ProjectContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useSearchParamsState } from '@/lib/url-state';
import { Card, EmptyState, ErrorState, Icon, InlineNotice, LinkButton, PageHeader, StaleBanner } from '@/ui';
import { ActiveRunCard } from './components/home/ActiveRunCard';
import { CapacityBlock, CapacityFrame } from './components/home/CapacityBlock';
import { FirstRunCard } from './components/home/FirstRunCard';
import { RunnerLine } from './components/home/RunnerLine';
import { SwitchedOff } from './components/home/SwitchedOff';
import { ALL_TARGETS, RunsTable } from './components/home/RunsTable';
import { RUNS_PAGE_SIZE, defaultTargetId } from './components/home/model';
import { span } from './lib/format';
import styles from './components/home/home.module.css';

const TESTS: PerformanceTestType[] = ['breakpoint', 'smoke', 'soak'];
const NO_TESTS = new Set<Key>();
const DESCRIPTION =
  'Load tests of Insightor: how many users it takes before answers get too slow or start to fail.';

function Header({
  slug,
  canStart,
  reason,
  noStart,
}: {
  slug: string;
  canStart?: boolean;
  reason?: string;
  /** The area is switched off: no run can exist, so there is no New run at all. */
  noStart?: boolean;
}) {
  return (
    <PageHeader
      title="Performance"
      description={DESCRIPTION}
      actions={
        noStart ? undefined : (
          <LinkButton
            variant="primary"
            icon={<Icon name="plus" size={12} />}
            to={performancePath(slug, 'new')}
            isDisabled={!canStart}
            disabledReason={reason ?? 'The page is loading'}
          >
            New run
          </LinkButton>
        )
      }
    />
  );
}

export function PerformanceHomePage({ slug }: { slug: string }) {
  useDocumentTitle('Performance');
  const query = useMixedPerformanceHome(slug);
  if (query.isError && isPerformanceSwitchedOff(query.error))
    return (
      <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
        <Header slug={slug} noStart />
        <div className={styles.body}>
          <SwitchedOff />
        </div>
      </div>
    );
  if (!query.data)
    return (
      <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
        <Header slug={slug} />
        <div className={styles.body}>
          {query.isError ? (
            // The first read failed: nothing was shown yet, so the page is the error (§3.7).
            <ErrorState
              error={query.error}
              title="Couldn’t load the performance tests"
              onRetry={() => void query.refetch()}
            />
          ) : (
            // The loaded layout with skeleton values (§7): the runner line, the capacity block, the runs table.
            <div className={styles.frame} data-performance-loading="home">
              <RunnerLine slug={slug} />
              <div className={styles.sections}>
                <CapacityFrame />
                <RunsTable
                  slug={slug}
                  rows={undefined}
                  total={0}
                  allTotal={0}
                  page={1}
                  onPage={() => undefined}
                  targets={[]}
                  active={null}
                  tests={NO_TESTS}
                  onTests={() => undefined}
                  target={ALL_TARGETS}
                  onTarget={() => undefined}
                  search=""
                  onSearch={() => undefined}
                  loading
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  if (query.data.targets.some(isPlatformTarget) || query.data.runs.rows.some(isPlatformRun))
    return (
      <MixedHome
        slug={slug}
        home={query.data}
        staleSince={query.isError ? new Date(query.dataUpdatedAt) : null}
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <Home
      slug={slug}
      home={query.data as PerformanceHome}
      // A refresh that failed after the page was shown: the last read stays, dimmed, under a StaleBanner (§3.7).
      staleSince={query.isError ? new Date(query.dataUpdatedAt) : null}
      onRetry={() => void query.refetch()}
    />
  );
}

function Home({
  slug,
  home,
  staleSince,
  onRetry,
}: {
  slug: string;
  home: PerformanceHome;
  staleSince: Date | null;
  onRetry: () => void;
}) {
  const project = useOptionalProject();
  // The view lives in the address (?capacity=…&test=…&target=…&page=…): Back from a run returns to the same view.
  const { params, replaceUrlQuery } = useSearchParamsState();
  const tests = useMemo(
    () => new Set<Key>(params.getAll('test').filter((key) => TESTS.includes(key as PerformanceTestType))),
    [params],
  );
  const target = params.get('target') ?? ALL_TARGETS;
  const search = params.get('q') ?? '';
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const chosen = params.get('capacity');

  const runner = home.runner;
  const active = home.active_run;
  // Why a run cannot be started from here, in the order a person can do something about it.
  const blocked = !runner
    ? 'No runner is connected yet'
    : !runner.fresh
      ? 'The runner is not connected'
      : home.can.start
        ? undefined
        : project?.readOnly
          ? readOnlyReason(project)
          : 'Your role in this project cannot start a run';
  // Stop is open to every member, also in an archived project; a viewer sees it locked with the reason (§3.1). The
  // API has the last word.
  const stopLocked = home.can.start || !(project?.viewer ?? false) ? undefined : 'Viewers cannot stop a run';

  // The first page of the whole list comes with the Home read; any other view is its own request.
  const narrowed = tests.size > 0 || target !== ALL_TARGETS || search !== '';
  const first = !narrowed && page === 1;
  const filters: PerformanceRunsFilters = {
    page,
    page_size: RUNS_PAGE_SIZE,
    test_type: [...tests].map(String) as PerformanceTestType[],
    target: target === ALL_TARGETS ? undefined : target,
    q: search || undefined,
  };
  const runs = useQuery({ ...performanceRunsQueryOptions(slug, filters), enabled: !first });
  const shown = first ? home.runs : runs.data;

  const capacityTarget =
    chosen && home.targets.some((item) => item.id === chosen && !item.archived)
      ? chosen
      : defaultTargetId(home);

  return (
    <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
      <Header slug={slug} canStart={blocked === undefined} reason={blocked} />
      <div className={styles.body}>
        {staleSince ? <StaleBanner since={staleSince} filtersApplied onRetry={onRetry} /> : null}
        {runner && !runner.fresh ? (
          <InlineNotice tone="danger" lead="Not connected." data-testid="performance-runner-notice">
            {runner.info.location ? `The runner in ${runner.info.location}` : 'The runner'} has not reported
            {runner.seconds_since_heartbeat === null
              ? ''
              : ` for ${span(runner.seconds_since_heartbeat)}`}.{' '}
            {/* From 30 s (not fresh); once stale (120 s) a run in progress is ended: the stronger words. */}
            {runner.stale ? 'A run in progress is ended and cannot continue. ' : ''}New runs cannot start
            until it reports again. Finished runs and their reports are not affected.
          </InlineNotice>
        ) : null}
        {runner ? (
          <RunnerLine slug={slug} home={home} runner={runner} />
        ) : (
          <Card data-performance-block="no-runner">
            <EmptyState
              title="No runner is connected yet"
              body="A runner is the program that sends the load to Insightor and reports back to this page. An operator starts it once with this project's key; then runs can be started here."
              action={<LinkButton to={performancePath(slug, 'runner')}>Open the Runner page</LinkButton>}
            />
          </Card>
        )}
        {active ? (
          <ActiveRunCard
            slug={slug}
            active={active}
            row={home.runs.rows.find((run) => run.id === active.id)}
            stopLocked={stopLocked}
          />
        ) : null}
        {runner && !home.runs.total ? <FirstRunCard /> : null}
        {home.runs.total ? (
          <div className={styles.sections}>
            {capacityTarget ? (
              <CapacityBlock
                slug={slug}
                home={home}
                targetId={capacityTarget}
                onTargetChange={(id) =>
                  replaceUrlQuery({ capacity: id === defaultTargetId(home) ? null : id })
                }
                canStart={blocked === undefined}
                cannotStartReason={blocked}
              />
            ) : null}
            <RunsTable
              slug={slug}
              rows={shown?.rows}
              total={shown?.total ?? 0}
              allTotal={home.runs.total}
              page={page}
              onPage={(next) => replaceUrlQuery({ page: next === 1 ? null : next })}
              targets={home.targets}
              active={active}
              tests={tests}
              onTests={(keys) => replaceUrlQuery({ test: [...keys].map(String), page: null })}
              target={target}
              onTarget={(key) => replaceUrlQuery({ target: key === ALL_TARGETS ? null : key, page: null })}
              loading={!first && runs.isPending}
              refreshing={staleSince !== null || (!first && runs.isPlaceholderData)}
              error={first ? undefined : (runs.error ?? undefined)}
              onRetry={() => void runs.refetch()}
              // The runs this page will hold, known from the Home read's total; unknown for a narrowed list.
              expected={narrowed ? undefined : Math.max(0, home.runs.total - (page - 1) * RUNS_PAGE_SIZE)}
              search={search}
              onSearch={(text) => replaceUrlQuery({ q: text.trim() ? text : null, page: null })}
              onClear={() => replaceUrlQuery({ test: null, target: null, q: null, page: null })}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
