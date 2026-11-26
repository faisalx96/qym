import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Key } from 'react-aria-components';
import type { PerformanceHome, PerformanceRunRow, PerformanceTestType } from '@/api/performance';
import {
  isPlatformRun,
  isPlatformTarget,
  useMixedPerformanceRuns,
  type MixedPerformanceHome,
  type MixedPerformanceRunRow,
  type PlatformActiveRun,
  type PlatformCapacityCard,
} from '@/api/performancePlatform';
import { performancePath, performanceRunPath } from '@/app/routes';
import { useOptionalProject } from '@/features/shell/ProjectContext';
import { fullWidth } from '@/features/shell/layout';
import { useSearchParamsState } from '@/lib/url-state';
import { formatTableDate, formatShortDay } from '@/lib/dates';
import {
  Button,
  Card,
  Icon,
  CardTitle,
  DataTable,
  EmptyState,
  InlineNotice,
  LinkButton,
  MultiSelect,
  PageHeader,
  SearchField,
  Select,
  Section,
  SegmentedControl,
  StateTag,
  StatStrip,
  StaleBanner,
  TextLink,
  type Column,
} from '@/ui';
import { Legend, LineChart, PlotCard, RunStatus, Verdict } from '../shared';
import { RunnerLine } from '../home/RunnerLine';
import { ActiveRunCard } from '../home/ActiveRunCard';
import { FirstRunCard } from '../home/FirstRunCard';
import { CapacityBlock } from '../home/CapacityBlock';
import { count, secs, span, TEST_NAME } from '../../lib/format';
import styles from '../home/home.module.css';
import { PlatformVerdict, PlatformUsers } from './PlatformMarks';
import platformStyles from './platform.module.css';
import { platformCount, invalidCapacity } from './words';
import { SIGN_IN_SAVED, useSignInSaved } from './useSignInSaved';
import type { PlatformTokenHint } from '@/api/performancePlatform';
import { PlatformStopDialog } from './PlatformStopDialog';

function PlatformActiveCard({
  slug,
  active,
  canStop,
  tokens,
}: {
  slug: string;
  active: PlatformActiveRun;
  canStop: boolean;
  tokens: PlatformTokenHint[];
}) {
  const [stopping, setStopping] = useState(false);
  const progress = active.progress;
  const signIn = useSignInSaved(slug, active.id, progress, tokens);
  return (
    <Card
      header={
        <CardTitle
          title={<TextLink to={performanceRunPath(slug, active.id)}>Run {active.number}</TextLink>}
          description={`${TEST_NAME[active.test_type]} · Estishraf platform · ${active.target.name}`}
        />
      }
    >
      <div className={styles.stack}>
        <div className={styles.row}>
          <RunStatus status={active.status} />
          {canStop ? (
            <Button
              variant="danger"
              icon={<Icon name="stop" size={12} />}
              onPress={() => setStopping(true)}
              isDisabled={active.stop_requested || active.status === 'stopping'}
              disabledReason="Stop was already asked for"
            >
              Stop run
            </Button>
          ) : null}
          {active.token_needed || progress?.waiting_for_token
            ? signIn.saved
              ? SIGN_IN_SAVED
              : 'Sign-in needed. Open the run to save a new sign-in.'
            : progress?.phase === 'preflight'
              ? progress.message
              : progress?.message.replace(/holding/gi, 'Measuring').replace(/\bhold\b/gi, 'level')}
        </div>
        <StatStrip
          live
          items={[
            { key: 'users', label: 'Current users', value: count(progress?.users) },
            { key: 'opens', label: 'Dashboards opened', value: count(progress?.dashboard_opens) },
            { key: 'p95', label: 'Open p95 so far', value: secs(progress?.open_p95_ms) },
            { key: 'elapsed', label: 'Elapsed', value: span(progress?.elapsed_s) },
          ]}
        />
        {progress?.phase === 'preflight' && progress.discovery_counts ? (
          <p className={styles.note}>
            {platformCount(progress.discovery_counts.dashboards_discovered, 'dashboard')} found ·{' '}
            {platformCount(progress.discovery_counts.charts_usable, 'chart')} usable
          </p>
        ) : null}
      </div>
      {canStop ? (
        <PlatformStopDialog slug={slug} runId={active.id} open={stopping} onOpenChange={setStopping} />
      ) : null}
    </Card>
  );
}
function PlatformCapacity({
  slug,
  card,
  home,
  onTarget,
}: {
  slug: string;
  card: PlatformCapacityCard;
  home: MixedPerformanceHome;
  onTarget: (id: string) => void;
}) {
  const result = card.result && !invalidCapacity(card.result.verdict) ? card.result : null;
  const points = home.platform_safe_load_trend.filter((point) => point.target_id === card.target.id);
  return (
    <Section
      title="Latest capacity result"
      description="What the last Breakpoint run that gave a result says about one target."
      wrap
      bodyClassName={styles.stack}
      actions={
        <div className={styles.aside}>
          <SegmentedControl
            label="Target"
            value={card.target.id ?? ''}
            onChange={onTarget}
            options={home.targets.map((target) => ({ value: target.id, label: target.name }))}
          />
          <StateTag
            tone={home.targets.find((t) => t.id === card.target.id)?.sign_in_ready ? 'success' : 'warning'}
          >
            {home.targets.find((t) => t.id === card.target.id)?.sign_in_ready
              ? 'Sign-in saved'
              : 'No sign-in saved'}
          </StateTag>
          {home.can.start ? (
            <LinkButton
              to={`${performancePath(slug, 'new')}?target=${encodeURIComponent(card.target.id ?? '')}`}
            >
              Run on this target
            </LinkButton>
          ) : null}
        </div>
      }
    >
      {result ? (
        <div className={styles.stack}>
          <StatStrip
            pairs
            items={[
              {
                key: 'safe',
                label: 'Safe load',
                value: <PlatformUsers value={result.safe_load_users} />,
              },
              {
                key: 'break',
                label: 'Breaks at',
                value:
                  result.breaking_level_users == null ? (
                    <span className={platformStyles.words}>Not reached</span>
                  ) : (
                    <PlatformUsers value={result.breaking_level_users} />
                  ),
              },
              {
                key: 'recommended',
                label: 'Recommended',
                value: <PlatformUsers value={result.recommended_max_users} />,
              },
              { key: 'p95', label: card.label, value: secs(result.p95_at_safe_load_ms) },
              {
                key: 'measured',
                label: 'Measured',
                value: <span className={styles.words}>{formatShortDay(result.finished_at)}</span>,
                sub: <TextLink to={performanceRunPath(slug, result.run_id)}>Run {result.number}</TextLink>,
              },
            ]}
          />
          {result.coverage === 'incomplete' ? (
            <InlineNotice tone="warning">
              Coverage incomplete. Timings cover the charts that could be loaded.
            </InlineNotice>
          ) : null}
        </div>
      ) : (
        <EmptyState
          compact
          title="No capacity result for this target"
          body="Start with Smoke, then run Breakpoint to find the safe load."
        />
      )}
      {points.length ? (
        <PlotCard
          title="Capacity over time"
          legend={
            <Legend
              items={[
                { label: 'Safe load', tone: 'success' },
                { label: 'Breaks at', tone: 'danger' },
              ]}
            />
          }
          caption={`${card.target.name} · users · one point per Breakpoint result`}
        >
          <LineChart
            label="Platform capacity over time"
            xs={points.map((point) => `Run ${point.number}`)}
            yMax={Math.max(1, ...points.map((point) => point.breaking_level_users ?? point.safe_load_users))}
            series={[
              { name: 'Safe load', tone: 'success', values: points.map((point) => point.safe_load_users) },
              {
                name: 'Breaks at',
                tone: 'danger',
                dash: true,
                values: points.map((point) => point.breaking_level_users),
              },
            ]}
          />
        </PlotCard>
      ) : null}
    </Section>
  );
}
export function MixedHome({
  slug,
  home,
  staleSince,
  onRetry,
}: {
  slug: string;
  home: MixedPerformanceHome;
  staleSince: Date | null;
  onRetry: () => void;
}) {
  const project = useOptionalProject();
  const canStop = home.can.start || !(project?.viewer ?? false);
  const { params, replaceUrlQuery } = useSearchParamsState();
  const [tests, setTests] = useState<Set<Key>>(new Set(params.getAll('test')));
  const targetId = params.get('capacity') ?? home.capacity_cards?.[0]?.target.id ?? home.targets[0]?.id ?? '';
  const target = params.get('target') ?? 'all';
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const runs = useMixedPerformanceRuns(slug, {
    page,
    page_size: 25,
    q: search || undefined,
    target: target === 'all' ? undefined : target,
    test_type: [...tests] as PerformanceTestType[],
  });
  const shown = !search && target === 'all' && tests.size === 0 && page === 1 ? home.runs : runs.data;
  const card = home.capacity_cards?.find((item) => item.target.id === targetId);
  const chatHome = {
    ...home,
    targets: home.targets.filter((item) => !('kind' in item) || item.kind !== 'estishraf_platform'),
    active_run: home.active_run && !isPlatformRun(home.active_run) ? home.active_run : null,
    runs: { ...home.runs, rows: home.runs.rows.filter((row) => !isPlatformRun(row)) },
  } as PerformanceHome;
  const columns: Column<MixedPerformanceRunRow>[] = [
    {
      id: 'run',
      header: 'Run',
      type: 'id',
      primary: true,
      cell: (r) => (
        <Link to={performanceRunPath(slug, r.id)} data-link="name">
          Run {r.number}
        </Link>
      ),
    },
    { id: 'kind', header: 'Kind', cell: (r) => (isPlatformRun(r) ? 'Estishraf platform' : 'Insightor chat') },
    { id: 'test', header: 'Test', cell: (r) => TEST_NAME[r.test_type] },
    { id: 'target', header: 'Target', wrap: true, cell: (r) => r.target.name },
    {
      id: 'status',
      header: 'Result',
      cell: (r) =>
        r.verdict ? (
          isPlatformRun(r) ? (
            <PlatformVerdict run={r} />
          ) : (
            <Verdict run={r} />
          )
        ) : (
          <RunStatus status={r.status} />
        ),
    },
    {
      id: 'safe',
      header: 'Safe load',
      type: 'number',
      cell: (r) => count(isPlatformRun(r) && invalidCapacity(r.verdict) ? null : r.safe_load_users),
    },
    {
      id: 'break',
      header: 'Breaks at',
      type: 'number',
      cell: (r) => count(isPlatformRun(r) && invalidCapacity(r.verdict) ? null : r.breaking_level_users),
    },
    {
      id: 'p95',
      header: 'p95',
      headerCase: 'as-written',
      type: 'number',
      cell: (r) => secs(isPlatformRun(r) ? r.open_p95_ms : r.p95_ms),
      hint: 'Dashboard open time for platform tests; response time for chat tests.',
    },
    {
      id: 'dashboards',
      header: 'Dashboards',
      type: 'number',
      cell: (r) => (isPlatformRun(r) ? count(r.coverage_counts?.dashboards_exercised) : '–'),
    },
    {
      id: 'coverage',
      header: 'Coverage',
      cell: (r) =>
        isPlatformRun(r)
          ? r.coverage === 'incomplete'
            ? 'Incomplete'
            : r.coverage === 'complete'
              ? 'Complete'
              : '–'
          : '–',
    },
    { id: 'length', header: 'Length', type: 'duration', cell: (r) => span(r.duration_s) },
    {
      id: 'when',
      header: 'Started',
      type: 'date',
      cell: (r) => formatTableDate(r.started_at ?? r.requested_at),
    },
  ];
  return (
    <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
      <PageHeader
        title="Performance"
        description="Load tests: safe load, where it breaks, and a recommended maximum."
        actions={
          home.can.start ? (
            <LinkButton variant="primary" to={performancePath(slug, 'new')}>
              New run
            </LinkButton>
          ) : undefined
        }
      />
      <div className={styles.body}>
        {staleSince ? <StaleBanner since={staleSince} filtersApplied onRetry={onRetry} /> : null}
        {home.runner ? (
          <RunnerLine slug={slug} home={home} runner={home.runner} />
        ) : (
          <InlineNotice tone="warning">
            No runner is connected yet.{' '}
            <TextLink to={performancePath(slug, 'runner')}>Open the Runner page</TextLink>
          </InlineNotice>
        )}
        {home.active_run ? (
          isPlatformRun(home.active_run) ? (
            <PlatformActiveCard
              slug={slug}
              active={home.active_run}
              canStop={canStop}
              tokens={
                home.targets
                  .filter(isPlatformTarget)
                  .find((target) => target.id === home.active_run?.target.id)?.tokens ?? []
              }
            />
          ) : (
            <ActiveRunCard
              slug={slug}
              active={home.active_run}
              stopLocked={canStop ? undefined : 'Viewers cannot stop a run'}
              row={
                home.runs.rows.find((row) => row.id === home.active_run?.id) as PerformanceRunRow | undefined
              }
            />
          )
        ) : null}
        {!home.runs.total ? (
          home.targets.every((item) => 'kind' in item && item.kind === 'estishraf_platform') ? (
            <Card
              header={
                <CardTitle
                  title="No runs yet"
                  description="Start with Smoke, then run Breakpoint to find the safe load."
                />
              }
            >
              <ol className={styles.steps}>
                <li>
                  <strong>1. Set up sign-in</strong>
                  <span>Choose a platform target and save its session cookie.</span>
                </li>
                <li>
                  <strong>2. Choose dashboards</strong>
                  <span>
                    Choose how many to use and the filters to try. The list is found when the run starts.
                  </span>
                </li>
                <li>
                  <strong>3. Start Smoke</strong>
                  <span>One user opens every runnable dashboard once.</span>
                </li>
              </ol>
            </Card>
          ) : (
            <FirstRunCard />
          )
        ) : null}
        <div className={styles.sections}>
          {card?.kind !== 'estishraf_platform' ? (
            <Select
              label="Capacity target"
              value={targetId}
              onChange={(id) => replaceUrlQuery({ capacity: String(id) })}
              items={home.targets.map((item) => ({ key: item.id, label: item.name }))}
            />
          ) : null}
          {card?.kind === 'estishraf_platform' ? (
            <PlatformCapacity
              slug={slug}
              home={home}
              card={card}
              onTarget={(id) => replaceUrlQuery({ capacity: id })}
            />
          ) : targetId ? (
            <CapacityBlock
              slug={slug}
              home={chatHome}
              targetId={targetId}
              onTargetChange={(id) => replaceUrlQuery({ capacity: id })}
              canStart={home.can.start}
            />
          ) : null}
          <DataTable
            aria-label="Performance runs"
            rows={shown?.rows ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            rowHref={(r) => performanceRunPath(slug, r.id)}
            responsive="scroll"
            loading={!shown}
            error={runs.error}
            errorTitle="Couldn’t load the runs"
            onRetry={() => void runs.refetch()}
            empty={<EmptyState compact title="No matching runs" />}
          >
            <DataTable.Toolbar
              search={
                <SearchField
                  label="Find a run"
                  placeholder="Find a run"
                  value={search}
                  onChange={(q) => replaceUrlQuery({ q, page: null })}
                />
              }
              filters={
                <>
                  <Select
                    label="Target"
                    triggerVariant="bar"
                    value={target}
                    onChange={(id) =>
                      replaceUrlQuery({ target: id === 'all' ? null : String(id), page: null })
                    }
                    items={[
                      { key: 'all', label: 'All targets' },
                      ...home.targets.map((item) => ({ key: item.id, label: item.name })),
                    ]}
                  />
                  <MultiSelect
                    label="Test"
                    triggerVariant="bar"
                    emptyMeansAll
                    value={tests}
                    onChange={(value) => {
                      setTests(value);
                      replaceUrlQuery({ test: [...value].map(String), page: null });
                    }}
                    items={(['smoke', 'breakpoint', 'soak'] as const).map((key) => ({
                      key,
                      label: TEST_NAME[key],
                    }))}
                  />
                </>
              }
            />
            <DataTable.Footer
              pagination={{
                total: shown?.total ?? 0,
                page,
                pageSize: 25,
                onPageChange: (value) => replaceUrlQuery({ page: value === 1 ? null : value }),
                noun: platformCount(shown?.total ?? 0, 'run', true),
              }}
            />
          </DataTable>
        </div>
      </div>
    </div>
  );
}
