/** Performance home: what the last Breakpoint run with a result says about one target, and the trend over time. */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  performanceRunsQueryOptions,
  type PerformanceHome,
  type PerformanceRunRow,
  type PerformanceTargetSummary,
} from '@/api/performance';
import { performancePath, performanceRunPath } from '@/app/routes';
import { formatShortDay, formatTime } from '@/lib/dates';
import {
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  StatStrip,
  StateTag,
  UserName,
} from '@/ui';
import { P95_HINT, secs } from '../../lib/format';
import { Legend, LineChart, PlotCard, Quantity } from '../shared';
import { Seconds } from './Seconds';
import { tagShape } from './placeholders';
import {
  axisTop,
  capacityFilters,
  latestResult,
  leftOut,
  trendNames,
  trendOf,
  type TrendPoint,
} from './model';
import styles from './home.module.css';

/** Above this many targets the switch becomes a list. */
const SWITCH_LIMIT = 5;

function breakWords(run: PerformanceRunRow): string {
  if (run.breaking_level_users === null)
    return `no break up to ${run.safe_load_users ?? run.max_users} users`;
  if (run.breaking_reason === 'errors') return 'too many errors at this level';
  if (run.breaking_reason === 'both') return 'p95 went over the time limit, with too many errors';
  return 'p95 went over the time limit';
}

const TITLE = 'Latest capacity result';
const DESCRIPTION = 'What the last Breakpoint run that gave a result says about one target.';
/** The plot height of the trend (the frame keeps it while the page loads). */
const TREND_HEIGHT = 190;

/** A skeleton value in a stat cell (§7: the loading frame is the loaded layout, with no invented values). */
const pending = (label: string) => <Skeleton kind="value" label={`Loading: ${label}`} />;

/** The five numbers of the latest result; skeleton values while the result is on its way. */
function Numbers({
  slug,
  target,
  latest,
}: {
  slug: string;
  target?: PerformanceTargetSummary;
  latest?: PerformanceRunRow;
}) {
  const when = latest ? (latest.started_at ?? latest.requested_at) : null;
  return (
    <StatStrip
      aria-label={target ? `Capacity of ${target.name}` : 'Capacity'}
      pairs
      items={[
        {
          key: 'safe',
          label: 'Safe load',
          value: latest ? (
            <Quantity value={latest.safe_load_users ?? '–'} unit="users" />
          ) : (
            pending('Safe load')
          ),
          sub: 'highest level that passed',
        },
        {
          key: 'breaks',
          label: 'Breaks at',
          value: latest ? (
            <Quantity value={latest.breaking_level_users ?? '–'} unit="users" />
          ) : (
            pending('Breaks at')
          ),
          sub: latest ? breakWords(latest) : pending('why it broke'),
        },
        {
          key: 'recommended',
          label: 'Recommended maximum',
          value: latest ? (
            <Quantity value={latest.recommended_max_users ?? '–'} unit="users" />
          ) : (
            pending('Recommended maximum')
          ),
          sub: '80% of the safe load',
        },
        {
          key: 'p95',
          label: 'p95 at the safe load',
          help: P95_HINT,
          value: latest ? <Seconds ms={latest.p95_at_safe_load_ms} /> : pending('p95 at the safe load'),
          sub: latest ? `time limit ${secs(latest.limit_ms, 0)}` : pending('time limit'),
        },
        {
          key: 'measured',
          label: 'Measured',
          // A date is sans with tabular figures, never mono (§1 Font families).
          value: when ? <span className={styles.words}>{formatShortDay(when)}</span> : pending('Measured'),
          sub:
            latest && when ? (
              <span className={styles.row}>
                <span className={styles.figures}>{formatTime(when)}</span>
                {/* A name that opens a page: white at rest, green on hover (Q35 A). */}
                <Link to={performanceRunPath(slug, latest.id)} data-link="name">
                  Run {latest.number}
                </Link>
                {latest.requested_by ? (
                  <span className={styles.row}>
                    by <UserName id={latest.requested_by_user_id} name={latest.requested_by} />
                  </span>
                ) : null}
              </span>
            ) : (
              // The time, the run and the person: as tall as the person's disc.
              tagShape('Loading: when and by whom')
            ),
        },
      ]}
    />
  );
}

function TrendLegend() {
  return (
    <Legend
      items={[
        { label: 'Safe load', tone: 'success' },
        { label: 'Breaks at', tone: 'danger', line: true },
      ]}
    />
  );
}

function Trend({
  target,
  points,
  skipped,
}: {
  target: PerformanceTargetSummary;
  points: TrendPoint[];
  skipped: string[];
}) {
  const highest = Math.max(
    ...points.map((point) => Math.max(point.safe_load_users, point.breaking_level_users ?? 0)),
  );
  return (
    <PlotCard
      title="Capacity over time"
      caption={`${target.name} · users · one point per Breakpoint run that gave a result, in date order`}
      legend={<TrendLegend />}
    >
      <LineChart
        label={`Safe load and breaking level of ${target.name} over time`}
        xs={trendNames(points)}
        yMax={axisTop(highest)}
        height={TREND_HEIGHT}
        series={[
          {
            name: 'Breaks at',
            tone: 'danger',
            dash: true,
            values: points.map((point) => point.breaking_level_users),
          },
          { name: 'Safe load', tone: 'success', values: points.map((point) => point.safe_load_users) },
        ]}
      />
      {skipped.length ? <p className={styles.note}>Not charted: {skipped.join('; ')}.</p> : null}
    </PlotCard>
  );
}

export function CapacityBlock({
  slug,
  home,
  targetId,
  onTargetChange,
  canStart,
  cannotStartReason,
}: {
  slug: string;
  home: PerformanceHome;
  targetId: string;
  onTargetChange: (id: string) => void;
  canStart: boolean;
  cannotStartReason?: string;
}) {
  const targets = home.targets.filter((item) => !item.archived);
  const target = targets.find((item) => item.id === targetId);
  const query = useQuery(performanceRunsQueryOptions(slug, capacityFilters(targetId)));
  if (!target) return null;
  // The runs read keeps the page it showed before while the next one loads: never show it under another target.
  const rows = query.data && !query.isPlaceholderData ? query.data.rows : null;
  const latest = rows ? latestResult(rows) : null;
  const points = trendOf(home, targetId);
  return (
    <Section
      title={TITLE}
      description={DESCRIPTION}
      aria-label={TITLE}
      data-performance-block="capacity"
      bodyClassName={styles.stack}
      wrap
      actions={
        <div className={styles.aside}>
          {targets.length > SWITCH_LIMIT ? (
            <Select
              label="Target"
              hideLabel
              items={targets.map((item) => ({ key: item.id, label: item.name }))}
              value={targetId}
              onChange={(key) => (key === null ? undefined : onTargetChange(String(key)))}
            />
          ) : (
            <SegmentedControl
              label="Target"
              options={targets.map((item) => ({ value: item.id, label: item.name }))}
              value={targetId}
              onChange={onTargetChange}
            />
          )}
          <StateTag tone={target.sign_in_ready ? 'success' : 'warning'}>
            {target.sign_in_ready ? 'Sign-in saved' : 'No sign-in saved'}
          </StateTag>
          <LinkButton
            to={`${performancePath(slug, 'new')}?target=${encodeURIComponent(target.id)}`}
            isDisabled={!canStart}
            disabledReason={cannotStartReason}
          >
            Run on this target
          </LinkButton>
        </div>
      }
    >
      {rows === null && query.isError ? (
        <Card>
          <ErrorState
            compact
            error={query.error}
            title="Couldn’t load the capacity result"
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : rows === null || latest ? (
        // While the result is on its way: the same strip with skeleton values, and the trend (it comes with Home).
        <>
          <Numbers slug={slug} target={target} latest={latest ?? undefined} />
          {points.length ? (
            <Trend target={target} points={points} skipped={rows ? leftOut(rows, points) : []} />
          ) : null}
        </>
      ) : (
        <Card>
          <EmptyState
            compact
            title={`No capacity result for ${target.name} yet`}
            body="A capacity result needs a Breakpoint run that finishes."
          />
        </Card>
      )}
    </Section>
  );
}

/** The capacity block while the whole page loads: its title, the strip with skeleton values, the trend's frame. */
export function CapacityFrame() {
  return (
    <Section
      title={TITLE}
      description={DESCRIPTION}
      aria-label={TITLE}
      data-performance-block="capacity"
      bodyClassName={styles.stack}
      wrap
      actions={
        // The target switch, the sign-in tag and Run on this target, as bones of their own sizes.
        <div className={styles.aside}>
          <Skeleton kind="value" height="var(--control-height)" width="16em" label="Loading the targets" />
          <Skeleton kind="value" height="var(--badge-height)" width="7em" label="Loading the sign-in" />
          <Skeleton kind="value" height="var(--control-height)" width="10em" label="Loading" />
        </div>
      }
    >
      <Numbers slug="" />
      <PlotCard
        title="Capacity over time"
        caption={
          <>
            {pending('the target')} · users · one point per Breakpoint run that gave a result, in date order
          </>
        }
        legend={<TrendLegend />}
      >
        <Skeleton kind="chart" height={TREND_HEIGHT} label="Loading the capacity over time" />
      </PlotCard>
    </Section>
  );
}
