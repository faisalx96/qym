/**
 * /projects/:slug/overview — KPI band, Trend, then two panels (round 10): Live and Recent runs together, and Pending
 * reviews beside Approved runs (brief 03 J8).
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useKpis, usePendingCorrections, useRunsPage, useTrend } from '@/api/dashboard';
import type { DashboardFilters, PendingCorrection, RunRow } from '@/api/dashboardTypes';
import {
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  RunName,
  RunStatusBadge,
  SegmentedControl,
  Select,
  Skeleton,
  StatStrip,
  Tag,
  TaskTag,
  Text,
  Card as UiCard,
  type Column,
} from '@/ui';
import { constrained, useDocumentTitle, useProjectContext } from '@/features/shell';
import { projectPath, runPath } from '@/app/routes';
import { kpiEntries, kpiScope } from '@/lib/kpis';
import { formatPercentValue, formatRelative } from '@/lib/format';
import { textDirAttrs } from '@/lib/text';
import { useSearchParamsState } from '@/lib/url-state';
import { ModelCell, Mono, OwnerCell, StatusCell } from './cells';
import { modelKeyOf } from './model';
import { TrendChart } from './TrendChart';
import { pendingIssue } from './pendingReview';
import { isActiveRun } from './polling';
import { RunsCtx, type RunsCtxValue } from './context';
import { trendFormat, trendFormatDelta, trendIsRate } from './trendModel';
// Recharts is ~100 kB: load it only with the Overview page.
import styles from './OverviewPage.module.css';

const LIVE = ['RUNNING', 'PENDING'];
const NON_LIVE = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'COMPLETED', 'FAILED', 'STOPPED'];
type Origin = 'all' | 'official' | 'local';
type Days = '7' | '30' | '90';

export function OverviewPage() {
  const { slug, project, readOnly } = useProjectContext();
  useDocumentTitle('Dashboard');
  const { params, replaceUrlQuery } = useSearchParamsState();
  const origin = (
    ['official', 'local'].includes(params.get('origin') ?? '') ? params.get('origin') : 'all'
  ) as Origin;
  const rangeParam = params.get('range');
  const days = (rangeParam === '30d' ? '30' : rangeParam === '90d' ? '90' : '7') as Days;
  const task = params.get('task');
  const dataset = params.get('dataset');
  const filters = useMemo<DashboardFilters>(() => (origin === 'all' ? {} : { origins: [origin] }), [origin]);

  const kpisQ = useKpis(slug, filters, { refetchInterval: 30_000 });
  const kpis = kpisQ.data?.kpis;
  const updating = Boolean(kpisQ.data?.freshness.updating);

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
  // Model colours follow first appearance across the lists on this page (the overview has no frequency index).
  const modelIndex = useMemo(() => {
    const index: Record<string, number> = {};
    for (const r of [
      ...(live.data?.rows ?? []),
      ...(recent.data?.rows ?? []),
      ...(approved.data?.rows ?? []),
    ]) {
      const key = modelKeyOf(r);
      if (!(key in index)) index[key] = Object.keys(index).length;
    }
    return index;
  }, [live.data?.rows, recent.data?.rows, approved.data?.rows]);
  const ctx = useMemo<RunsCtxValue>(
    () => ({ slug, listContext: '', metricTypes: {}, modelIndex, owners: {} }),
    [slug, modelIndex],
  );
  const scope = kpiScope(kpis);
  const approvedCount = approved.data?.total_runs;
  const entries = kpiEntries(kpis);
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
              title="Couldn’t load project KPIs"
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
          ) : kpisQ.isPending ? (
            <Skeleton kind="cards" count={5} label="Loading KPIs" reserve />
          ) : null}
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
                  onChange={(v) => replaceUrlQuery({ range: v === '7' ? null : `${v}d` })}
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
                  <TrendChart trend={trend} />
                </>
              )
            ) : trendQ.isPending ? (
              <Skeleton kind="chart" label="Loading trend" />
            ) : null}
          </Card>
          {/* Activity: what runs now, then what finished last (one panel, round 10) */}
          <UiCard compact flush data-testid="overview-activity">
            <div className={styles.group}>
              <Part
                title="Live runs"
                to={`${projectPath(slug)}?status=RUNNING&status=PENDING`}
                query={live}
                empty={liveRows.length ? undefined : updating ? 'Updating live runs…' : 'No live runs'}
              >
                <RunsList slug={slug} rows={liveRows} kind="live" label="Live runs" />
              </Part>
              <Part title="Recent runs" to={projectPath(slug)} query={recent}>
                <RunsList slug={slug} rows={recent.data?.rows ?? []} kind="recent" label="Recent runs" />
              </Part>
            </div>
          </UiCard>
          {/* Review: what waits for a reviewer next to what was approved (one panel, two columns) */}
          <UiCard compact flush data-testid="overview-review">
            <div className={styles.group} data-pair="">
              {readOnly ? null : (
                <Part
                  title="Pending reviews"
                  description="Corrections waiting for a reviewer"
                  to={projectPath(slug, 'reviews')}
                  query={pending}
                >
                  {pendingItems.length ? (
                    <ul className={styles.reviews}>
                      {pendingItems.map((c) => (
                        <li key={c.id} className={styles.review}>
                          <Link
                            to={`${projectPath(slug, 'reviews')}?status=pending&id=${encodeURIComponent(String(c.id))}`}
                            className={styles.reviewLink}
                            title={`Open review #${c.id}`}
                          >
                            #{String(c.id)}
                          </Link>
                          <PendingReviewText c={c} />
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
                </Part>
              )}
              <Part title="Approved runs" to={`${projectPath(slug)}?status=APPROVED`} query={approved}>
                {approved.data?.rows.length ? (
                  <RunsList slug={slug} rows={approved.data.rows} kind="approved" label="Approved runs" />
                ) : (
                  <EmptyState
                    compact
                    title="No approved runs"
                    body="Runs appear here once a reviewer approves them."
                  />
                )}
              </Part>
            </div>
          </UiCard>
        </div>
      </div>
    </RunsCtx.Provider>
  );
}

function PendingReviewText({ c }: { c: PendingCorrection }) {
  const issue = pendingIssue(c);
  return (
    <span className={styles.reviewBody}>
      <Text variant="sm" tone="secondary" as="span" className={styles.reviewText}>
        {issue ? (
          <>
            {issue.category ? (
              <Text as="span" variant="sm" weight={600}>
                {issue.category}
              </Text>
            ) : null}
            {issue.category && issue.finding ? ' · ' : null}
            {issue.finding}
          </>
        ) : (
          '—'
        )}
      </Text>
      {c.input_preview ? (
        <Text variant="sm" tone="muted" as="span" className={styles.reviewText} title={c.input_preview}>
          {c.input_preview}
        </Text>
      ) : null}
    </span>
  );
}

function RunLink({ slug, row }: { slug: string; row: RunRow }) {
  const link = (
    <RunName
      to={runPath(slug, row.run_id)}
      name={row.external_run_id || row.run_name}
      runId={row.run_id}
      {...textDirAttrs(row.external_run_id || row.run_name)}
    />
  );
  if (row.origin !== 'official') return link;
  return (
    <span className={styles.runLine}>
      {link}
      <Tag kind="accent" title="Run launched by an official experiment">
        Official
      </Tag>
    </span>
  );
}

/** Items done out of total (a repeat run prefixes the pass); this is progress, not successes. */
function itemProgress(r: RunRow): string {
  const done = `${r.progress_completed}/${r.progress_total ?? r.total_items}`;
  if (r.samples <= 1) return done;
  const pass = Math.min((r.last_completed_pass ?? 0) + (isActiveRun(r) ? 1 : 0), r.samples);
  return `pass ${pass}/${r.samples} · ${done}`;
}

/**
 * One line per run (round 10: the task, dataset and model tags under the name read as clutter): the name, then a column
 * each for task and model, the owner, the status and the date. The columns fit their content. Approved runs sit in a
 * half-width column, so they keep the name, the user and the date.
 */
function RunsList({
  slug,
  rows,
  kind,
  label,
}: {
  slug: string;
  rows: RunRow[];
  kind: 'live' | 'recent' | 'approved';
  label: string;
}) {
  const wide = kind !== 'approved';
  const columns: Column<RunRow>[] = [
    {
      id: 'run',
      header: 'Run',
      type: 'id',
      flex: true,
      minWidth: 140,
      priority: 1,
      cell: (r) => <RunLink slug={slug} row={r} />,
    },
    ...(wide
      ? [
          {
            id: 'task',
            header: 'Task',
            priority: 2 as const,
            cell: (r: RunRow) => <TaskTag name={r.task_name} />,
          },
          {
            id: 'model',
            header: 'Model',
            priority: 3 as const,
            cell: (r: RunRow) => <ModelCell row={r} />,
          },
        ]
      : []),
    {
      id: 'owner',
      header: kind === 'live' ? 'Owner' : 'User',
      priority: 3,
      cell: (r) => <OwnerCell row={r} />,
    },
    ...(wide
      ? [
          {
            id: 'status',
            header: 'Status',
            type: 'status' as const,
            priority: 1 as const,
            cell: (r: RunRow) =>
              kind === 'live' ? <StatusCell row={r} /> : <RunStatusBadge status={r.status} />,
          },
          {
            id: 'items',
            header: 'Items',
            type: 'number' as const,
            priority: 3 as const,
            cell: (r: RunRow) => <Mono>{itemProgress(r)}</Mono>,
          },
        ]
      : []),
    {
      id: 'date',
      header: kind === 'live' ? 'Updated' : 'Date',
      type: 'date',
      priority: 2,
      cell: (r) => formatRelative(kind === 'live' ? r.last_event_at : r.timestamp),
    },
  ];
  return (
    <DataTable<RunRow>
      aria-label={label}
      rows={rows}
      rowKey={(r) => r.run_id}
      variant="embedded"
      density="compact"
      densityLocked
      columns={columns}
    />
  );
}

/** One part of a panel: a title line (title, description, controls, View all), then its body or one empty line. */
function Part({
  title,
  description,
  to,
  query,
  empty,
  children,
}: {
  title: string;
  description?: string;
  to: string;
  query?: { isError: boolean; isPending: boolean; error: unknown; refetch: () => unknown; data?: unknown };
  /** No rows: the title line says it (e.g. "No live runs") and the part has no body. */
  empty?: string;
  children: ReactNode;
}) {
  const failed = query?.isError && !query.data;
  const loading = query?.isPending && !query.data;
  return (
    <section aria-label={title} className={styles.part}>
      <header className={styles.partHead}>
        <div className={styles.cardTitle}>
          <Text variant="lg" as="h2">
            {title}
          </Text>
          {description ? (
            <Text variant="sm" tone="muted" as="p">
              {description}
            </Text>
          ) : null}
        </div>
        {empty && !failed && !loading ? (
          <Text variant="sm" tone="muted" as="span" className={styles.partEmpty}>
            {empty}
          </Text>
        ) : null}
        <Link to={to} className={styles.viewAll}>
          View all →<span className={styles.srOnly}> {title}</span>
        </Link>
      </header>
      {failed ? (
        <ErrorState
          compact
          error={query.error}
          title={`Couldn’t load ${title.toLowerCase()}`}
          onRetry={() => query.refetch()}
        />
      ) : loading ? (
        <Skeleton kind="lines" rows={3} label={`Loading ${title.toLowerCase()}`} />
      ) : empty ? null : (
        <div className={styles.partBody}>{children}</div>
      )}
    </section>
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
    <UiCard
      as="section"
      compact
      aria-label={title}
      header={
        <header className={styles.cardHead}>
          <div className={styles.cardTitle}>
            <Text variant="lg" as="h2">
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
      }
    >
      <div className={styles.cardBody}>
        {query?.isError && !query.data ? (
          <ErrorState
            compact
            error={query.error}
            title={`Couldn’t load ${title.toLowerCase()}`}
            onRetry={() => query.refetch()}
          />
        ) : query?.isPending && !query.data ? (
          <Skeleton kind="lines" rows={3} label={`Loading ${title.toLowerCase()}`} />
        ) : (
          children
        )}
      </div>
    </UiCard>
  );
}
