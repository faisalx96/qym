import { PerformanceDownload } from '../PerformanceDownload';
/** Performance run page: the header (state, test, target, who and when, dataset) and its actions. */
import { isPerformanceRunActive, performanceDownloadUrl, type PerformanceRunRead } from '@/api/performance';
import { performancePath } from '@/app/routes';
import { formatTableDate, formatTime } from '@/lib/dates';
import { Button, DatasetTag, Icon, LinkButton, PageHeader, UserName } from '@/ui';
import { TEST_NAME } from '../../lib/format';
import { RunStatus, TargetEnvironment, Verdict } from '../shared';
import styles from './run.module.css';

const host = (baseUrl: string) => baseUrl.replace(/^https?:\/\//, '');

export function RunHeader({
  slug,
  read,
  onStop,
  onToken,
}: {
  slug: string;
  read: PerformanceRunRead;
  onStop: () => void;
  onToken: () => void;
}) {
  const { run, config } = read;
  const done = !isPerformanceRunActive(read.effective_status);
  const stopAsked = read.stop_requested || read.effective_status === 'stopping';
  // A person ended this run: they stopped it (the run's own end, by plan or by a break, names no one).
  const stoppedBy =
    read.effective_status === 'stopped' || read.summary?.ended_by === 'stop' ? run.stop_requested_by : null;
  return (
    <PageHeader
      title={`Run ${run.number}`}
      meta={[
        <span key="state" className={styles.inline}>
          <RunStatus status={read.effective_status} />
          <Verdict run={run} />
        </span>,
        TEST_NAME[config.test_type],
        <span key="target" className={styles.inline}>
          {config.target.name}
          <TargetEnvironment production={config.target.is_production} />
          <span className={styles.host}>{host(config.target.base_url)}</span>
        </span>,
        <span key="by" className={styles.inline}>
          <span className={styles.figures}>
            {run.started_at
              ? `Started ${formatTableDate(run.started_at)}`
              : `Asked for ${formatTableDate(run.requested_at)}`}{' '}
            by
          </span>
          <span className={styles.joined}>
            <UserName id={run.requested_by_user_id} name={run.requested_by} />
            {run.finished_at ? (
              <span className={styles.figures}>
                , ended {formatTime(run.finished_at)}
                {stoppedBy ? ' by\u00a0' : ''}
              </span>
            ) : null}
            {run.finished_at && stoppedBy ? (
              <UserName id={run.stop_requested_by_user_id} name={stoppedBy} />
            ) : null}
          </span>
        </span>,
        <DatasetTag key="dataset" name={config.dataset.name} version={config.dataset.version} />,
      ]}
      actions={
        done ? (
          <>
            <LinkButton to={performancePath(slug, 'new')} icon={<Icon name="retry" size={12} />}>
              Run again
            </LinkButton>
            <PerformanceDownload
              href={read.report ? performanceDownloadUrl(read.report.url) : undefined}
              download
              variant="accent"
              icon={<Icon name="download" size={12} />}
              isDisabled={!read.report}
              disabledReason={
                read.report_expired
                  ? 'The report of this run is no longer stored'
                  : 'No report was stored for this run'
              }
            >
              Download report
            </PerformanceDownload>
          </>
        ) : (
          <>
            {read.token_needed ? (
              <Button
                variant="primary"
                icon={<Icon name="send" size={12} />}
                isDisabled={!read.can.hand_off_token}
                disabledReason={
                  config.target.is_production
                    ? 'Only a manager can send a token for a production target'
                    : 'Only members of the project can send a token'
                }
                onPress={onToken}
              >
                Send a new token
              </Button>
            ) : null}
            <Button
              variant="danger"
              icon={<Icon name="stop" size={12} />}
              isDisabled={!read.can.stop}
              disabledReason={
                stopAsked ? 'Stop was already asked for' : 'Only members of the project can stop a run'
              }
              onPress={onStop}
            >
              Stop run
            </Button>
          </>
        )
      }
    />
  );
}
