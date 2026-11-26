import { APP_LOCALE } from '@/lib/dates';
import { isPerformanceRunActive } from '@/api/performance';
import type { PlatformRunRead } from '@/api/performancePlatform';
import {
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  InlineNotice,
  KeyValueGrid,
  StateTag,
  StatStrip,
  StatusMark,
  type Column,
} from '@/ui';
import { Legend, LineChart, PlotCard, Quantity, Stepladder } from '../shared';
import type { LevelOutcome } from '../../lib/status';
import { count, pct, secs, span } from '../../lib/format';
import { REASON_WORDS } from './words';
import styles from './platform.module.css';

const PREFLIGHT = [
  ['certificate_check', 'Checking the target certificate'],
  ['sign_in', 'Checking sign-in'],
  ['discovery', 'Finding dashboards, charts and filters'],
  ['plan_check', 'Checking the test plan'],
  ['starting_k6', 'Starting the test'],
] as const;
export function PlatformPreflight({ read }: { read: PlatformRunRead }) {
  const progress = read.progress;
  const step = PREFLIGHT.findIndex(([key]) => key === progress?.step);
  const counts = progress?.discovery_counts;
  const ended = ['stopped', 'interrupted', 'failed', 'finished'].includes(read.effective_status);
  return (
    <Card
      header={
        <CardTitle
          title={
            ended
              ? 'Test preparation ended'
              : read.effective_status === 'queued'
                ? 'Waiting for the runner'
                : 'Preparing the test'
          }
          description={
            progress?.message || 'The runner will check sign-in and find the dashboards before sending load.'
          }
        />
      }
    >
      <div className={styles.stack}>
        {PREFLIGHT.map(([key, message], index) => (
          <StatusMark
            key={key}
            tone={index < step ? 'success' : index === step ? 'info' : 'neutral'}
            shape={index < step ? 'check' : index === step ? 'orbit' : 'ring'}
            label={message}
          />
        ))}
        {counts ? (
          <KeyValueGrid
            items={[
              { key: 'Dashboards found', value: count(counts.dashboards_discovered), mono: true },
              { key: 'Charts found', value: count(counts.charts_found), mono: true },
              { key: 'Filters found', value: count(counts.filters_found), mono: true },
              { key: 'Elapsed', value: span(progress?.preflight_elapsed_s), mono: true },
            ]}
          />
        ) : null}
        <p className={styles.note}>
          {ended
            ? 'No load was sent after preparation ended.'
            : 'Counts are still growing. Load starts after discovery finishes.'}
        </p>
      </div>
    </Card>
  );
}
export function PlatformProgress({ read }: { read: PlatformRunRead }) {
  const { summary, progress, config } = read;
  const active = isPerformanceRunActive(read.effective_status);
  if (!summary && (!progress || progress.phase === 'preflight')) return <PlatformPreflight read={read} />;
  const resolved = summary?.plan ?? read.discovery?.resolved_plan;
  const planned = resolved?.levels ?? progress?.levels.map((l) => l.level) ?? [];
  const outcomes: Record<number, LevelOutcome> = {};
  const rows = planned.map((level) => {
    const final = summary?.levels.find((l) => l.level === level);
    const live = progress?.levels.find((l) => l.level === level);
    const outcome =
      final?.result === 'pass'
        ? 'pass'
        : final?.result === 'break'
          ? 'break'
          : final?.result === 'auth'
            ? 'not_counted'
            : live?.state === 'running'
              ? active
                ? 'measuring'
                : 'not_finished'
              : 'waiting';
    outcomes[level] = outcome;
    return {
      level,
      result: final
        ? final.result === 'pass'
          ? 'Passed'
          : final.result === 'break'
            ? 'Broke a limit'
            : final.result === 'auth'
              ? 'Not valid: sign-in'
              : 'No measurement'
        : live?.state === 'running'
          ? active
            ? 'Measuring'
            : 'Measured; no final result'
          : live
            ? active
              ? 'Measured; result pending'
              : 'Measured; no final result'
            : 'Not reached',
      tone: final
        ? final.result === 'pass'
          ? 'success'
          : final.result === 'break'
            ? 'danger'
            : 'warning'
        : live
          ? 'info'
          : 'neutral',
      opens: final?.dashboards_opened ?? live?.dashboard_opens ?? null,
      p50: final ? final.open_p50_ms : live?.open_p50_ms,
      p95: final ? final.open_p95_ms : live?.open_p95_ms,
      filter: final ? final.filter_p95_ms : live?.filter_p95_ms,
      errors: final?.error_rate_pct,
      duration: final?.actual_duration_s ?? live?.hold_elapsed_s,
      percent: final?.hold_elapsed_pct ?? live?.hold_elapsed_pct,
    };
  });
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { id: 'users', header: 'Users', type: 'number', accessor: (r) => r.level },
    {
      id: 'result',
      header: 'Result',
      cell: (r) => (
        <StateTag tone={r.tone as 'neutral' | 'success' | 'danger' | 'warning' | 'info'}>{r.result}</StateTag>
      ),
    },
    { id: 'opens', header: 'Opens', type: 'number', cell: (r) => count(r.opens) },
    { id: 'p50', header: 'Open p50', headerCase: 'as-written', type: 'number', cell: (r) => secs(r.p50) },
    { id: 'p95', header: 'Open p95', headerCase: 'as-written', type: 'number', cell: (r) => secs(r.p95) },
    {
      id: 'filter',
      header: 'Filter p95',
      headerCase: 'as-written',
      type: 'number',
      cell: (r) => secs(r.filter),
    },
    { id: 'errors', header: 'Errors', type: 'number', cell: (r) => pct(r.errors) },
    { id: 'duration', header: 'Measured time', type: 'number', cell: (r) => span(r.duration) },
  ];
  const thresholds =
    summary?.thresholds.filter(
      (t) =>
        t.scope === (summary.headline.breaking_level_users ? 'level' : 'run') &&
        (t.scope === 'run' || t.level === summary.headline.breaking_level_users),
    ) ?? [];
  return (
    <div className={styles.stack}>
      {resolved && config.test_type === 'breakpoint' ? (
        <PlotCard
          title="Users over time"
          caption="Load time, after discovery."
          legend={
            <Legend
              items={[
                { label: 'Passed', tone: 'success' },
                { label: 'Broke a limit', tone: 'danger' },
                ...(active ? [{ label: 'Measuring', tone: 'info' as const }] : []),
                { label: 'Not reached', tone: 'neutral' },
              ]}
            />
          }
        >
          <Stepladder
            stages={resolved.stages}
            baseline={'baseline_users' in config.plan ? config.plan.baseline_users : 1}
            outcomes={outcomes}
            endedS={summary?.headline.duration_s ?? (active ? undefined : progress?.elapsed_s)}
            nowS={active ? progress?.elapsed_s : undefined}
          />
        </PlotCard>
      ) : (
        <Card
          header={
            <CardTitle title="Smoke coverage" description="One user opens each runnable dashboard once." />
          }
        >
          <StatStrip
            items={[
              {
                key: 'opens',
                label: 'Dashboards opened',
                value: (
                  <Quantity
                    value={count(
                      summary?.coverage_counts.dashboards_exercised ??
                        progress?.coverage_counts.dashboards_exercised,
                    )}
                    unit={`of ${count(summary?.coverage_counts.dashboards_selected ?? progress?.coverage_counts.dashboards_selected)}`}
                  />
                ),
              },
              { key: 'users', label: 'Users', value: 1 },
              {
                key: 'charts',
                label: 'Charts usable',
                value: (
                  <Quantity
                    value={count(
                      summary?.coverage_counts.charts_usable ?? progress?.coverage_counts.charts_usable,
                    )}
                    unit={`of ${count(summary?.coverage_counts.charts_found ?? progress?.coverage_counts.charts_found)}`}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
      <Card
        flush
        header={
          <CardTitle
            title="Limits"
            description="Dashboard open time and request errors decide the result. Filter time is a reference only."
          />
        }
      >
        {thresholds.length ? (
          <DataTable
            aria-label="Limits"
            variant="embedded"
            rows={thresholds}
            rowKey={(r) => r.metric}
            columns={[
              {
                id: 'limit',
                header: 'Limit',
                cell: (r) =>
                  r.metric.includes('ready')
                    ? `Dashboard open p95 under ${secs(config.plan.limit_ms)}`
                    : `Errors under ${config.plan.max_error_rate_pct}%`,
              },
              {
                id: 'where',
                header: 'Where',
                cell: (r) => (r.level == null ? 'Whole run' : `Level ${r.level}`),
              },
              {
                id: 'measured',
                header: 'Measured',
                type: 'number',
                cell: (r) =>
                  r.metric.includes('ready')
                    ? secs(r.measured)
                    : pct(r.measured == null ? null : r.measured * 100),
              },
              {
                id: 'result',
                header: 'Result',
                cell: (r) => (
                  <StateTag tone={r.ok === null ? 'neutral' : r.ok ? 'success' : 'danger'}>
                    {r.ok === null ? 'No measurement' : r.ok ? 'Kept' : 'Broken'}
                  </StateTag>
                ),
              },
            ]}
            responsive="scroll"
          />
        ) : (
          <InlineNotice tone="info">
            Dashboard open p95 under {secs(config.plan.limit_ms)}; request errors under{' '}
            {config.plan.max_error_rate_pct}%. Final limits are checked when the run ends.
          </InlineNotice>
        )}
      </Card>
      {config.test_type === 'breakpoint' ? (
        <Card
          flush
          header={
            <CardTitle
              title="Levels"
              description={
                summary
                  ? 'Each measured level keeps its actual duration.'
                  : 'Completed opens so far. Results and request error rates arrive when the run ends.'
              }
            />
          }
        >
          <DataTable
            aria-label="Levels"
            variant="embedded"
            stripe="report"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.level}
            responsive="scroll"
          />
        </Card>
      ) : null}
    </div>
  );
}
const chartNumber = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 2 });

export function PlatformCharts({ read }: { read: PlatformRunRead }) {
  const levels = read.summary?.levels ?? read.progress?.levels ?? [];
  const xs = levels.map((l) => String(l.level));
  const errors = read.summary?.overall.errors_by_class ?? read.progress?.errors_by_class;
  const charts = (
    [
      ['open_p95_ms', 'Dashboard open time'],
      ['filter_p95_ms', 'Filter time'],
    ] as const
  ).filter(([key]) => levels.some((l) => l[key] != null));
  const errorsPresent = errors && Object.values(errors).some((value) => value > 0);
  if (!charts.length && !errorsPresent)
    return (
      <EmptyState
        compact
        title="No chart measurements yet"
        body="Charts appear when completed dashboard opens or filters are reported."
      />
    );
  return (
    <div className={styles.stack}>
      {charts.map(([key, title]) => {
        const values = levels.map((l) => (l[key] == null ? null : l[key]! / 1000));
        return (
          <PlotCard key={key} title={title} caption="p95 in seconds, by users">
            <LineChart
              label={`${title} by level`}
              xs={xs}
              series={[{ name: title, series: key === 'open_p95_ms' ? 1 : 2, values }]}
              yMax={
                Math.max(
                  1,
                  ...values.map((v) => v ?? 0),
                  key === 'open_p95_ms' ? read.config.plan.limit_ms / 1000 : 0,
                ) * 1.15
              }
              unit="s"
              formatY={(value) => chartNumber.format(value)}
              xTitle="users"
              limit={
                key === 'open_p95_ms'
                  ? {
                      value: read.config.plan.limit_ms / 1000,
                      label: `Open limit ${secs(read.config.plan.limit_ms)}`,
                    }
                  : undefined
              }
            />
          </PlotCard>
        );
      })}
      {errorsPresent ? (
        <PlotCard title="Errors by class" caption="Recorded failed request outcomes">
          <LineChart
            label="Errors by class"
            xs={Object.keys(errors).map((key) => REASON_WORDS[key] ?? 'Other request error')}
            series={[{ name: 'Errors', tone: 'danger', values: Object.values(errors) }]}
            yMax={Math.ceil(Math.max(4, ...Object.values(errors)) / 4) * 4}
          />
        </PlotCard>
      ) : null}
    </div>
  );
}
