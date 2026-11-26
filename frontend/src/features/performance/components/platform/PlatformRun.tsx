import { useState } from 'react';
import { isPerformanceRunActive, performanceReportUrl, type PerformanceReceived } from '@/api/performance';
import {
  downloadPerformanceFile,
  usePlatformDashboards,
  usePlatformDiscovery,
  type PlatformRunRead,
} from '@/api/performancePlatform';
import { performancePath } from '@/app/routes';
import { formatTableDate } from '@/lib/dates';
import { fullWidth } from '@/features/shell/layout';
import {
  Button,
  Icon,
  InlineNotice,
  LinkButton,
  PageHeader,
  StatStrip,
  StaleBanner,
  Tabs,
  TabPanel,
  UserName,
  type StatStripItem,
} from '@/ui';
import { Quantity, RunStatus, TargetEnvironment } from '../shared';
import { LogTab } from '../run/LogTab';
import { useSecondsSince } from '../run/hooks';
import { count, pct, secs, span, TEST_NAME } from '../../lib/format';
import { PlatformDashboards } from './PlatformDashboards';
import { PlatformProgress, PlatformCharts } from './PlatformProgress';
import { PlatformSetupTab } from './PlatformSetup';
import { SessionDialog } from './SessionDialog';
import { SIGN_IN_SAVED, useSignInSaved } from './useSignInSaved';
import {
  PLATFORM_ERRORS,
  platformCount,
  invalidCapacity,
  platformResultExplanation,
  progressSentence,
} from './words';
import { PlatformUsers } from './PlatformMarks';
import platformStyles from './platform.module.css';
import { PlatformStopDialog } from './PlatformStopDialog';
import styles from '../run/run.module.css';

export function PlatformRun({
  slug,
  runId,
  read,
  stale,
  onRetry,
  now = Date.now,
}: {
  slug: string;
  runId: string;
  read: PerformanceReceived<PlatformRunRead>;
  stale?: boolean;
  onRetry: () => void;
  now?: () => number;
}) {
  const [tab, setTab] = useState('progress');
  const [dialog, setDialog] = useState<'stop' | 'sign-in' | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const active = isPerformanceRunActive(read.effective_status);
  usePlatformDashboards(slug, runId, { q: '', page: 1, page_size: 25, sort: 'title' }, { active });
  usePlatformDiscovery(slug, runId, { page: 1, page_size: 50 }, { active });
  const age = useSecondsSince(read.received_at, active, now);
  const { run, progress, summary } = read;
  const counts = summary?.coverage_counts ?? progress?.coverage_counts ?? run.coverage_counts;
  const coverage = summary?.coverage ?? progress?.coverage ?? run.coverage;
  const waiting =
    active && (read.token_needed === 'session_cookie' || progress?.waiting_for_token === 'session_cookie');
  const deadline = progress?.auth.wait_deadline_at;
  const secondsLeft = deadline
    ? Math.max(0, (Date.parse(deadline) - Date.parse(read.server_time)) / 1000 - age)
    : null;
  const headline = summary?.headline;
  const signIn = useSignInSaved(slug, runId, progress, read.tokens);
  const invalid = invalidCapacity(summary?.verdict);
  const explanation = summary ? platformResultExplanation(summary) : null;
  const items: StatStripItem[] =
    summary && run.test_type === 'breakpoint'
      ? [
          {
            key: 'safe',
            label: 'Safe load',
            value: <PlatformUsers value={invalid ? null : headline?.safe_load_users} />,
          },
          {
            key: 'break',
            label: 'Breaks at',
            value: invalid ? (
              '–'
            ) : headline?.breaking_level_users == null ? (
              <span className={platformStyles.words}>Not reached</span>
            ) : (
              <PlatformUsers value={headline.breaking_level_users} />
            ),
          },
          {
            key: 'recommended',
            label: 'Recommended',
            value: <PlatformUsers value={invalid ? null : headline?.recommended_max_users} />,
          },
          {
            key: 'open',
            label: 'Open p95 at safe load',
            value: secs(invalid ? null : headline?.p95_at_safe_load_ms),
          },
          { key: 'dashboards', label: 'Dashboards opened', value: count(counts?.dashboards_exercised) },
          { key: 'length', label: 'Run length', value: span(headline?.duration_s) },
        ]
      : summary
        ? [
            { key: 'users', label: 'Users', value: 1 },
            {
              key: 'opens',
              label: 'Dashboards opened',
              value: (
                <Quantity
                  value={count(counts?.dashboards_exercised)}
                  unit={`of ${count(counts?.dashboards_selected)}`}
                />
              ),
            },
            { key: 'open', label: 'Open p95', value: secs(headline?.open_p95_ms) },
            { key: 'errors', label: 'Errors', value: pct(headline?.error_rate_pct) },
            {
              key: 'charts',
              label: 'Charts usable',
              value: (
                <Quantity value={count(counts?.charts_usable)} unit={`of ${count(counts?.charts_found)}`} />
              ),
            },
            { key: 'length', label: 'Run length', value: span(headline?.duration_s) },
          ]
        : [
            {
              key: 'users',
              label: summary ? 'Users' : active ? 'Current users' : 'Last users',
              value: summary ? 1 : count(progress?.users),
              sub: !summary && progress?.users == null ? 'No fresh reading' : undefined,
            },
            {
              key: 'opens',
              label: 'Dashboard opens',
              value: count(headline?.opens_total ?? progress?.dashboard_opens),
            },
            {
              key: 'open',
              label: summary ? 'Open p95' : 'Open p95 so far',
              value: secs(summary ? headline?.open_p95_ms : progress?.open_p95_ms),
            },
            {
              key: 'filter',
              label: summary ? 'Filter p95' : 'Filter p95 so far',
              value: secs(summary ? headline?.filter_p95_ms : progress?.filter_p95_ms),
            },
            { key: 'dashboards', label: 'Dashboards opened', value: count(counts?.dashboards_exercised) },
            {
              key: 'length',
              label: summary ? 'Run length' : 'Elapsed',
              value: span(headline?.duration_s ?? progress?.elapsed_s),
            },
          ];
  const failure =
    read.status_reason?.message ??
    (progress?.error_code ? PLATFORM_ERRORS[progress.error_code] : null) ??
    run.error;
  return (
    <div
      className={`${fullWidth} ${styles.page}`}
      data-performance-block="content"
      data-performance-run={runId}
      data-performance-state={read.effective_status}
    >
      <PageHeader
        title={`Run ${run.number}`}
        meta={[
          <div key="facts" className={platformStyles.metadata} data-platform-meta="">
            <span>
              <RunStatus status={read.effective_status} />
            </span>
            <span>{TEST_NAME[run.test_type]}</span>
            <span>Estishraf platform</span>
            <span>{run.target.name}</span>
            {run.target.is_production ? (
              <span>
                <TargetEnvironment production />
              </span>
            ) : null}
            <span>{run.target.base_url}</span>
            <span>
              Started {formatTableDate(run.started_at ?? run.requested_at)} by{' '}
              <UserName id={run.requested_by_user_id} name={run.requested_by} />
              {run.finished_at ? `, ended ${formatTableDate(run.finished_at)}` : ''}
            </span>
          </div>,
        ]}
        actions={
          <>
            {waiting && read.can.hand_off_token ? (
              <Button variant={signIn.saved ? 'neutral' : 'primary'} onPress={() => setDialog('sign-in')}>
                Save a new sign-in
              </Button>
            ) : null}
            {read.can.stop ? (
              <Button
                variant="danger"
                onPress={() => setDialog('stop')}
                isDisabled={read.stop_requested}
                disabledReason="Stop already requested"
              >
                Stop run
              </Button>
            ) : null}
            {!active ? (
              <LinkButton
                to={`${performancePath(slug, 'new')}?target=${encodeURIComponent(read.config.target.id)}`}
              >
                Run again
              </LinkButton>
            ) : null}
            {read.report ? (
              <Button
                variant="accent"
                icon={<Icon name="download" size={12} />}
                onPress={() => {
                  setDownloadError(false);
                  void downloadPerformanceFile(performanceReportUrl(slug, runId)).catch(() =>
                    setDownloadError(true),
                  );
                }}
              >
                Download report
              </Button>
            ) : null}
          </>
        }
      />
      <div className={styles.body}>
        {stale ? (
          <StaleBanner
            since={new Date(read.received_at)}
            now={new Date(now())}
            filtersApplied
            onRetry={onRetry}
          />
        ) : null}
        {summary ? (
          <InlineNotice
            icon={summary.verdict === 'pass' || summary.verdict === 'not_reached' ? 'check' : undefined}
            tone={
              summary.verdict === 'pass' || summary.verdict === 'not_reached'
                ? 'neutral'
                : summary.verdict === 'breakpoint_found'
                  ? 'warning'
                  : 'danger'
            }
          >
            {summary.verdict === 'invalid_auth'
              ? 'Not valid: sign-in'
              : summary.verdict === 'invalid_no_data'
                ? 'Not valid: no measurement'
                : summary.verdict_reason.replace(/\b(\d+) users\b/g, (_, value: string) =>
                    platformCount(Number(value), 'user'),
                  )}
          </InlineNotice>
        ) : null}
        {explanation ? <p className={platformStyles.note}>{explanation}</p> : null}
        {failure ? <InlineNotice tone="danger">{failure}</InlineNotice> : null}
        {read.effective_status === 'stopped' ? (
          <InlineNotice tone="warning">
            Stopped. Results measured so far are kept. This run cannot continue.
          </InlineNotice>
        ) : null}
        {read.effective_status === 'interrupted' ? (
          <InlineNotice tone="danger">
            Interrupted. The runner stopped reporting. Results measured so far are kept.
          </InlineNotice>
        ) : null}
        {read.effective_status === 'stopping' ? (
          <InlineNotice tone="info">Stopping. Waiting for the runner to finish the run.</InlineNotice>
        ) : null}
        {waiting ? (
          <InlineNotice tone="warning" lead={signIn.saved ? undefined : 'Sign-in needed.'}>
            {signIn.saved ? SIGN_IN_SAVED : 'Paste a new session cookie to continue.'}{' '}
            {progress?.phase !== 'preflight' ? 'The test clock continues while sign-in is replaced. ' : ''}
            Time spent waiting is not counted in dashboard open times.{' '}
            {secondsLeft == null ? '' : `${span(secondsLeft)} left.`}
          </InlineNotice>
        ) : null}
        {active && !waiting && progress?.phase !== 'preflight' && progress?.message ? (
          <InlineNotice tone="info">
            {progressSentence(progress.message)} Results are not final yet.
          </InlineNotice>
        ) : null}
        {coverage === 'incomplete' && counts && (read.discovery || progress?.discovery_ready || summary) ? (
          <InlineNotice tone="warning" lead="Coverage incomplete.">
            {platformCount(counts.charts_unusable, 'chart')} could not be loaded. {counts.charts_usable} of{' '}
            {platformCount(counts.charts_found, 'chart')} {counts.charts_usable === 1 ? 'is' : 'are'} usable
            across {platformCount(counts.dashboards_selected, 'dashboard')}.{' '}
            {counts.dashboards_unexercised
              ? `${platformCount(counts.dashboards_unexercised, 'dashboard')} ${counts.dashboards_unexercised === 1 ? 'has' : 'have'} not been opened. `
              : ''}
            {counts.discovery_partial ? 'Discovery was incomplete. ' : ''}
            <Button onPress={() => setTab('setup')}>See charts</Button>
          </InlineNotice>
        ) : null}
        {downloadError ? (
          <InlineNotice tone="danger">Couldn’t download the report. Try again.</InlineNotice>
        ) : null}
        {read.report_expired ? (
          <InlineNotice tone="neutral">The report has expired. The summary is still available.</InlineNotice>
        ) : null}
        {summary?.measurements.source_complete === false || progress?.measurement.complete === false ? (
          <InlineNotice tone="warning">
            Some measurement records are missing. Unavailable timings are shown as –.
          </InlineNotice>
        ) : null}
        <StatStrip
          inlineLabels
          variant="compact-header"
          aria-label="The run in numbers"
          live={active}
          items={items}
        />
        <Tabs
          fitNarrow
          label="Run sections"
          selected={tab}
          onSelect={setTab}
          items={[
            { id: 'progress', label: 'Progress' },
            {
              id: 'dashboards',
              label: 'Dashboards',
              count: read.discovery ? read.dashboard_results.total : undefined,
            },
            { id: 'log', label: 'Log' },
            { id: 'charts', label: 'Charts' },
            { id: 'setup', label: 'Setup' },
          ]}
        >
          <TabPanel id={tab}>
            <div className={styles.stack}>
              {tab === 'progress' ? <PlatformProgress read={read} /> : null}
              {tab === 'dashboards' ? <PlatformDashboards slug={slug} runId={runId} active={active} /> : null}
              {tab === 'log' ? (
                <LogTab
                  slug={slug}
                  runId={runId}
                  read={read}
                  description="Run events and the runner’s log. Saved sign-in values are never shown."
                />
              ) : null}
              {tab === 'charts' ? <PlatformCharts read={read} /> : null}
              {tab === 'setup' ? <PlatformSetupTab slug={slug} runId={runId} read={read} /> : null}
            </div>
          </TabPanel>
        </Tabs>
        {dialog === 'sign-in' ? (
          <SessionDialog
            slug={slug}
            targetId={read.config.target.id}
            runId={runId}
            onHandedOff={signIn.acknowledge}
            onClose={() => setDialog(null)}
          />
        ) : null}
        <PlatformStopDialog
          slug={slug}
          runId={runId}
          open={dialog === 'stop'}
          onOpenChange={(open) => setDialog(open ? 'stop' : null)}
        />
      </div>
    </div>
  );
}
