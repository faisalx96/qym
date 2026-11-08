import { useLocation } from 'react-router-dom';
import type { LiveWorkerRead } from '@/api/liveWorker';
import { formatHeaderDate } from '@/lib/dates';
import { formatRelative } from '@/lib/format';
import { Icon, LinkButton, StatStrip, StatusMark, Text } from '@/ui';
import { workerStateMark, workerTime } from './format';
import styles from '../../worker.module.css';

export function StatusStrip({ read }: { read: LiveWorkerRead }) {
  const location = useLocation();
  const control = read.running;
  const state = control?.state ?? 'waiting';
  const version = control?.settings_version_applied;
  const label = `${state}${state !== 'waiting' && version != null ? ` v${version}` : ''}`;
  const poll = read.status.last_poll_at ?? read.status.last_heartbeat_at;
  const interval = control?.running?.evaluation?.poll_interval_s;
  const job = control?.job;
  const currentJob = job ? read.jobs.find((item) => item.id === job.id) : undefined;
  const evaluated = typeof job?.progress?.evaluated === 'number' ? job.progress.evaluated : 0;
  const found = typeof job?.progress?.found === 'number' ? job.progress.found : 0;
  const errors = control?.errors_last_hour ?? 0;
  return (
    <section className={styles.stack} data-live-block="worker-status" aria-label="Worker status">
      <StatStrip
        aria-label="Worker statistics"
        items={[
          {
            label: 'State',
            icon: <Icon name="play" />,
            value: (
              <StatusMark tone={workerStateMark(state)[0]} shape={workerStateMark(state)[1]} label={label} />
            ),
            sub: (
              <span dir="auto" className={styles.wrap}>
                {control?.reason ||
                  `${control?.applied_at ? `since ${workerTime(control.applied_at)}` : ''}${read.state.changed_by ? ` by ${read.state.changed_by}` : ''}`}
              </span>
            ),
          },
          {
            label: 'Last poll',
            icon: <Icon name="retry" />,
            value: (
              <Text as="span" title={poll ?? undefined} className={styles.wrap}>
                {read.status.stale ? workerTime(poll) : formatRelative(poll)}
              </Text>
            ),
            sub: read.status.stale
              ? interval != null
                ? `Not reporting · every ${interval}s`
                : 'Not reporting'
              : interval != null
                ? `every ${interval}s`
                : undefined,
            tone: read.status.stale ? 'danger' : undefined,
          },
          {
            label: 'Last turn',
            icon: <Icon name="feedback" />,
            value: (
              <Text
                as="span"
                title={read.status.last_turn_at ? formatHeaderDate(read.status.last_turn_at) : undefined}
              >
                {workerTime(read.status.last_turn_at)}
              </Text>
            ),
            sub: `${read.today.turns_seen} today, ${read.today.evaluated} evaluated`,
          },
          {
            label: 'Problems, last hour',
            icon: <Icon name="warning" />,
            value: (
              <LinkButton
                to={`${location.pathname}${location.search}#problems`}
                variant="neutral"
                aria-label={`${errors} ${errors === 1 ? 'problem' : 'problems'} in the last hour`}
              >
                <Text as="span" mono>
                  {errors}
                </Text>
              </LinkButton>
            ),
            tone: errors > 0 ? 'warning' : undefined,
          },
          {
            label: 'Current job',
            icon: <Icon name="clock" />,
            value: (
              <Text as="span" className={styles.wrap}>
                {job
                  ? `${job.kind === 'backfill_preview' ? 'Preview' : 'Backfill'} · ${evaluated} of ${found} turns`
                  : 'None'}
              </Text>
            ),
            sub: currentJob ? `updated ${formatRelative(currentJob.updated_at)}` : undefined,
          },
        ]}
      />
    </section>
  );
}
