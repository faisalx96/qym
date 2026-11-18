import { Link, useLocation } from 'react-router-dom';
import type { LiveWorkerRead } from '@/api/liveWorker';
import { formatHeaderDate } from '@/lib/dates';
import { formatRelative } from '@/lib/format';
import { ProgressCell, StatStrip, StatusMark, Tag } from '@/ui';
import { textDirAttrs } from '@/lib/text';
import { jobKindWord, jobUpdateText, workerTime } from './format';
import styles from '../../worker.module.css';

export function StatusStrip({ read }: { read: LiveWorkerRead }) {
  const location = useLocation();
  const control = read.running;
  const state = control?.state ?? 'waiting';
  const version = control?.settings_version_applied;
  const poll = read.status.last_poll_at ?? read.status.last_heartbeat_at;
  const interval = control?.running?.evaluation?.poll_interval_s;
  // A report with only a waiting reason (no id) says a queued job is blocked; nothing is running.
  const job = control?.job?.id ? control.job : null;
  const currentJob = job ? read.jobs.find((item) => item.id === job.id) : undefined;
  // Turns the job finished: new evaluations plus redone ones (a redo job has only the latter).
  const fromControl = typeof job?.progress?.evaluated === 'number' ? job.progress : undefined;
  const counted = fromControl ?? currentJob?.progress;
  const redone = typeof counted?.redone === 'number' ? counted.redone : 0;
  const evaluated = (typeof counted?.evaluated === 'number' ? counted.evaluated : 0) + redone;
  const found =
    typeof job?.progress?.found === 'number' ? job.progress.found : (currentJob?.progress.found ?? 0);
  const stale = read.status.stale;
  const stateCaption = `${control?.applied_at ? `since ${workerTime(control.applied_at)}` : ''}${read.state.changed_by ? ` by ${read.state.changed_by}` : ''}`;
  const errors = control?.errors_last_hour ?? 0;
  return (
    <section className={styles.stack} data-live-block="worker-status" aria-label="Worker status">
      <StatStrip
        aria-label="Worker statistics"
        variant="compact"
        items={[
          {
            label: 'State',
            value: (
              <span className={styles.inline}>
                <StatusMark
                  tone={state === 'running' ? 'info' : 'neutral'}
                  shape={state === 'running' ? 'orbit' : state === 'paused' ? 'pause' : 'ring'}
                  label={state === 'running' ? 'Running' : state === 'paused' ? 'Paused' : 'Waiting'}
                />
                {state !== 'waiting' && version != null ? <Tag kind="version">v{version}</Tag> : null}
              </span>
            ),
            sub: (
              <span className={styles.wrap} {...textDirAttrs(stateCaption)}>
                {stateCaption}
                {control?.reason ? (
                  <span className={styles.wrap} {...textDirAttrs(control.reason)}>
                    {control.reason}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            label: 'Last poll',
            value: (
              <span
                title={poll ?? undefined}
                className={styles.statValue}
                data-tone={stale ? 'danger' : undefined}
              >
                {formatRelative(poll)}
              </span>
            ),
            sub: interval != null ? `every ${interval}s` : undefined,
            tone: stale ? 'danger' : undefined,
          },
          {
            label: 'Last turn',
            value: (
              <span
                className={styles.statValue}
                title={read.status.last_turn_at ? formatHeaderDate(read.status.last_turn_at) : undefined}
              >
                {workerTime(read.status.last_turn_at)}
              </span>
            ),
            sub: `${read.today.turns_seen} today, ${read.today.evaluated} evaluated`,
          },
          {
            label: 'Problems, last hour',
            value: (
              <Link
                to={`${location.pathname}${location.search}#problems`}
                className={styles.statLink}
                aria-label={`${errors} ${errors === 1 ? 'problem' : 'problems'} in the last hour`}
              >
                {errors}
              </Link>
            ),
            tone: errors > 0 ? 'warning' : undefined,
          },
          {
            label: 'Current job',
            value: <span className={styles.statValue}>{job ? jobKindWord(job.kind) : 'None'}</span>,
            sub: job ? (
              <span className={styles.jobStat}>
                <ProgressCell done={evaluated} total={found} countFormat="words" />
                {currentJob ? (
                  <span className={styles.wrap} data-tone={stale ? 'danger' : undefined}>
                    {jobUpdateText(currentJob.updated_at, stale)}
                  </span>
                ) : null}
              </span>
            ) : undefined,
          },
        ]}
      />
    </section>
  );
}
