/** /projects/:slug/overview — KPI band, Live / Recent / Approved runs, Pending reviews, Trend (brief 03 J8). */
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useKpis, usePendingCorrections, useRunsPage, useTrend } from '@/api/dashboard';
import type { DashboardFilters, RunRow } from '@/api/dashboardTypes';
import {
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  RunStatusBadge,
  SegmentedControl,
  Select,
  Skeleton,
  StatStrip,
  Text,
} from '@/ui';
import { constrained, useDocumentTitle, useProjectContext } from '@/features/shell';
import { projectPath, runPath } from '@/app/routes';
import { kpiEntries, kpiScope } from '@/lib/kpis';
import { formatPercentValue, formatRelative } from '@/lib/format';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { Mono, OwnerCell, StatusCell } from './cells';
import { RunsCtx, type RunsCtxValue } from './context';
import { useKpiTopbar } from './kpiTopbar';
import { trendFormat, trendFormatDelta, trendIsRate } from './trendModel';
// Recharts is ~100 kB: load it only with the Overview page.
const TrendChart = lazy(() => import('./TrendChart').then((m) => ({ default: m.TrendChart })));
import styles from './OverviewPage.module.css';

const LIVE = ['RUNNING', 'PENDING'];
const NON_LIVE = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'COMPLETED', 'FAILED', 'STOPPED'];
type Origin = 'all' | 'official' | 'local';
type Days = '7' | '30' | '90';

export function OverviewPage() {
  const { slug, project } = useProjectContext();
  useDocumentTitle(project.name);
  const { params, replaceUrlQuery } = useSearchParamsState();
  const origin = (
    ['official', 'local'].includes(params.get('origin') ?? '') ? params.get('origin') : 'all'
  ) as Origin;
  const rangeParam = params.get('range');
  const days = (rangeParam === '7d' ? '7' : rangeParam === '90d' ? '90' : '30') as Days;
  const task = params.get('task');
  const dataset = params.get('dataset');
  const filters = useMemo<DashboardFilters>(() => (origin === 'all' ? {} : { origins: [origin] }), [origin]);

  const kpisQ = useKpis(slug, filters, { refetchInterval: 30_000 });
  const kpis = kpisQ.data?.kpis;
  const updating = Boolean(kpisQ.data?.freshness.updating);
  useKpiTopbar(kpis);

  const live = useRunsPage(
    {
      project_slug: slug,
      filters: { ...filters, statuses: LIVE },
      sort: 'activity-desc',
      limit: 8,
      offset: 0,
    },
    { refetchInterval: (): number => 10_000 },
  );
  const liveRows = live.data?.rows ?? [];
  const recent = useRunsPage(
    {
      project_slug: slug,
      filters: { ...filters, statuses: NON_LIVE },
      sort: 'created-desc',
      limit: 5,
      offset: 0,
    },
    { refetchInterval: updating ? 2000 : 60_000 },
  );
  const approved = useRunsPage(
    {
      project_slug: slug,
      filters: { ...filters, statuses: ['APPROVED'] },
      sort: 'created-desc',
      limit: 5,
      offset: 0,
    },
    { refetchInterval: updating ? 2000 : 60_000 },
  );
  const pending = usePendingCorrections(slug);
  const trendQ = useTrend(slug, Number(days) as 7 | 30 | 90, task, dataset, {
    refetchInterval: updating ? 2000 : 60_000,
  });
  const trend = trendQ.data;
  const ctx = useMemo<RunsCtxValue>(
    () => ({ slug, listContext: '', metricTypes: {}, modelIndex: {}, owners: {} }),
    [slug],
  );
  const scope = kpiScope(kpis);
  const approvedCount = approved.data?.total_runs;
  const entries = kpiEntries(kpis);
  const showSkeleton = useDelayedPending(kpisQ.isPending);
  const s = trend?.summary;
  const rate = trendIsRate(trend?.points.map((p) => p.metric_mean) ?? []);
  const deltaPts = s?.delta == null ? null : s.delta;
  const good =
    deltaPts === null || trend?.direction == null
      ? null
      : trend.direction === 'minimize'
        ? deltaPts < 0
        : deltaPts > 0;
  const emptyTrend = trend ? trend.points.every((p) => p.runs === 0) : false;
  const pendingItems = pending.data?.corrections ?? pending.data?.items ?? [];
  const pendingTotal = pending.data?.total ?? pendingItems.length;

  return (
    <RunsCtx.Provider value={ctx}>
      <div className={constrained} data-testid="overview-page">
        <PageHeader
          title={project.name}
          description="Project overview and recent activity."
          actions={
            <SegmentedControl<Origin>
              label="Origin"
              value={origin}
              onChange={(o) => replaceUrlQuery({ origin: o === 'all' ? null : o })}
              options={[
                { value: 'all', label: 'All' },
                { value: 'official', label: 'Official' },
                { value: 'local', label: 'Local' },
              ]}
            />
          }
        />
        <div className={styles.screen} style={{ padding: 0 }}>
          {kpisQ.isError && !kpis ? (
            <ErrorState
              error={kpisQ.error}
              title="Could not load project KPIs"
              onRetry={() => kpisQ.refetch()}
              compact
            />
          ) : kpis ? (
            <StatStrip
              aria-label="Project KPIs"
              items={entries.map((e) => ({
                key: e.key,
                label: e.name,
                value: e.value,
                tone:
                  e.key === 'runs'
                    ? 'accent'
                    : e.key === 'execution_success'
                      ? 'success'
                      : e.key === 'runs_with_errors' && kpis.runs_with_errors
                        ? 'danger'
                        : undefined,
                sub:
                  e.key === 'runs'
                    ? `${scope.label}${approvedCount !== undefined ? ` · ${approvedCount} approved` : ''}${updating ? ' · Updating…' : ''}`
                    : scope.label,
                help: e.title,
              }))}
            />
          ) : showSkeleton ? (
            <Skeleton kind="cards" count={5} label="Loading KPIs" />
          ) : null}
          <Card
            title="Live runs"
            description="Runs currently executing in this project"
            to={`${projectPath(slug)}?status=RUNNING&status=PENDING`}
            query={live}
          >
            {liveRows.length ? (
              <DataTable<RunRow>
                aria-label="Live runs"
                rows={liveRows}
                rowKey={(r) => r.run_id}
                stickyHeader={false}
                columns={[
                  {
                    id: 'run',
                    label: 'Run',
                    flex: true,
                    mono: true,
                    cell: (r) => <RunLink slug={slug} row={r} />,
                  },
                  { id: 'owner', label: 'Owner', width: 150, cell: (r) => <OwnerCell row={r} /> },
                  { id: 'status', label: 'Status', width: 230, cell: (r) => <StatusCell row={r} /> },
                  {
                    id: 'updated',
                    label: 'Updated',
                    width: 110,
                    mono: true,
                    cell: (r) => formatRelative(r.last_event_at),
                  },
                ]}
              />
            ) : (
              <EmptyState compact title="No live runs" />
            )}
          </Card>
          <div className={styles.twoUp}>
            <Card title="Recent runs" to={projectPath(slug)} query={recent}>
              <MiniRuns slug={slug} rows={recent.data?.rows ?? []} />
            </Card>
            <Card title="Approved runs" to={`${projectPath(slug)}?status=APPROVED`} query={approved}>
              <MiniRuns slug={slug} rows={approved.data?.rows ?? []} />
            </Card>
          </div>
          <div className={styles.twoUp}>
            <Card
              title="Pending reviews"
              description="Corrections waiting for a reviewer"
              to={projectPath(slug, 'reviews')}
              query={pending}
            >
              {pendingItems.length ? (
                <ul className={styles.reviews}>
                  {pendingItems.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`${projectPath(slug, 'reviews')}?status=pending&id=${encodeURIComponent(String(c.id))}`}
                        className={styles.runLink}
                        title={`Open review #${c.id}`}
                      >
                        #{String(c.id)}
                      </Link>{' '}
                      <Text variant="sm" tone="muted" as="span">
                        {String(c.ai_root_cause ?? c.human_root_cause ?? '—').slice(0, 90)}
                      </Text>
                    </li>
                  ))}
                  {pendingTotal > pendingItems.length ? (
                    <li>
                      <Text variant="sm" tone="muted" as="span">
                        + {pendingTotal - pendingItems.length} more pending
                      </Text>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <EmptyState
                  compact
                  title="No pending reviews"
                  body="Proposed corrections appear here until a reviewer decides."
                />
              )}
            </Card>
            <Card
              title="Trend"
              description={
                trend?.metric
                  ? `${trend.metric.replace(/_/g, ' ')} of ${trend.task} on ${trend.dataset}, per day over finished runs (the run means).`
                  : 'Daily mean over finished runs'
              }
              to={projectPath(slug)}
              hideViewAll
              query={trendQ}
              aside={
                <div className={styles.trendControls}>
                  {trend && trend.tasks.length > 1 ? (
                    <Select
                      label="Task · dataset"
                      hideLabel
                      items={trend.tasks.map((t) => ({
                        key: `${t.task}\u0000${t.dataset}`,
                        label: `${t.task} · ${t.dataset} (${t.runs})`,
                      }))}
                      value={trend.task ? `${trend.task}\u0000${trend.dataset}` : null}
                      onChange={(k) => {
                        if (!k) return;
                        const [t, d] = String(k).split('\u0000');
                        replaceUrlQuery({ task: t, dataset: d });
                      }}
                      width={240}
                      searchable={false}
                    />
                  ) : null}
                  <SegmentedControl<Days>
                    label="Trend range"
                    value={days}
                    onChange={(v) => replaceUrlQuery({ range: v === '30' ? null : `${v}d` })}
                    options={[
                      { value: '7', label: '7d' },
                      { value: '30', label: '30d' },
                      { value: '90', label: '90d' },
                    ]}
                  />
                </div>
              }
            >
              {trend ? (
                emptyTrend ? (
                  <EmptyState
                    compact
                    title={`No finished runs in the last ${days} days`}
                    body={
                      trend.latest_run_at
                        ? `The latest finished run is from ${formatRelative(trend.latest_run_at)}.`
                        : 'Finished runs will appear here.'
                    }
                  />
                ) : (
                  <>
                    <div className={styles.trendHead}>
                      <Text variant="xl" as="div" mono className={styles.trendValue}>
                        {trendFormat(s?.metric_mean ?? null, rate)}
                      </Text>
                      <Text
                        variant="sm"
                        as="span"
                        tone={
                          deltaPts === null
                            ? 'muted'
                            : good === null
                              ? 'secondary'
                              : good
                                ? 'success'
                                : 'danger'
                        }
                        weight={600}
                        mono
                      >
                        {deltaPts === null
                          ? 'no previous period'
                          : `${trendFormatDelta(deltaPts, rate) || '0'} vs previous ${days} days`}
                      </Text>
                      <Text variant="sm" tone="muted" as="span">
                        {s?.runs ?? 0} finished runs · execution success{' '}
                        {formatPercentValue(s?.execution_success ?? null)}
                      </Text>
                    </div>
                    <Suspense fallback={<Skeleton kind="chart" label="Loading chart" />}>
                      <TrendChart trend={trend} />
                    </Suspense>
                  </>
                )
              ) : trendQ.isPending ? (
                <Skeleton kind="chart" label="Loading trend" />
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </RunsCtx.Provider>
  );
}

function RunLink({ slug, row }: { slug: string; row: RunRow }) {
  return (
    <Link to={runPath(slug, row.run_id)} className={styles.runLink}>
      {row.external_run_id || row.run_name}
    </Link>
  );
}

function MiniRuns({ slug, rows }: { slug: string; rows: RunRow[] }) {
  if (!rows.length) return <EmptyState compact title="Nothing yet" />;
  return (
    <DataTable<RunRow>
      aria-label="Runs"
      rows={rows}
      rowKey={(r) => r.run_id}
      stickyHeader={false}
      columns={[
        { id: 'run', label: 'Run', flex: true, mono: true, cell: (r) => <RunLink slug={slug} row={r} /> },
        { id: 'status', label: 'Status', width: 110, cell: (r) => <RunStatusBadge status={r.status} /> },
        {
          id: 'items',
          label: 'Items',
          width: 80,
          align: 'end',
          cell: (r) => (
            <Mono>
              {r.success_count}/{r.total_items}
            </Mono>
          ),
        },
        {
          id: 'date',
          label: 'Date',
          width: 90,
          align: 'end',
          mono: true,
          cell: (r) => formatRelative(r.timestamp),
        },
      ]}
    />
  );
}

function Card({
  title,
  description,
  to,
  aside,
  query,
  hideViewAll,
  children,
}: {
  title: string;
  description?: string;
  to: string;
  aside?: ReactNode;
  query?: { isError: boolean; isPending: boolean; error: unknown; refetch: () => unknown; data?: unknown };
  hideViewAll?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.card} aria-label={title}>
      <header className={styles.cardHead}>
        <div className={styles.cardTitle}>
          <Text variant="md" as="h2">
            {title}
          </Text>
          {description ? (
            <Text variant="sm" tone="muted" as="p">
              {description}
            </Text>
          ) : null}
        </div>
        {aside}
        {!hideViewAll ? (
          <Link to={to} className={styles.viewAll}>
            View all →<span className={styles.srOnly}> {title}</span>
          </Link>
        ) : null}
      </header>
      <div className={styles.cardBody}>
        {query?.isError && !query.data ? (
          <ErrorState
            compact
            error={query.error}
            title={`Could not load ${title.toLowerCase()}`}
            onRetry={() => query.refetch()}
          />
        ) : query?.isPending && !query.data ? (
          <Skeleton kind="lines" rows={3} label={`Loading ${title.toLowerCase()}`} />
        ) : (
          children
        )}
      </div>
    </section>
  );
}
