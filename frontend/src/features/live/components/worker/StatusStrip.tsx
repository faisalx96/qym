import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { LiveWorkerRead } from '@/api/liveWorker';
import { formatRelative } from '@/lib/format';
import { errorSentence } from '@/lib/http';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  InlineNotice,
  LinkButton,
  Select,
  StatStrip,
  StatusMark,
  Text,
} from '@/ui';
import { workerTime } from './format';
import type { WorkerBusy, WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

export function StatusStrip({
  read,
  busy,
  onState,
  onKey,
  onBackfill,
}: { read: LiveWorkerRead; busy: WorkerBusy; onBackfill: () => void } & Pick<
  WorkerCallbacks,
  'onState' | 'onKey'
>) {
  const location = useLocation();
  const [pause, setPause] = useState(false);
  const [error, setError] = useState<unknown>(null);
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
  async function change(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <section className={styles.stack} data-live-block="worker-status" aria-label="Worker status">
      <StatStrip
        aria-label="Worker statistics"
        items={[
          {
            label: 'State',
            value: (
              <StatusMark
                tone={state === 'running' ? 'success' : 'neutral'}
                shape={state === 'running' ? 'orbit' : state === 'paused' ? 'pause' : 'ring'}
                label={label}
              />
            ),
            sub: (
              <span dir="auto" className={styles.wrap}>
                {control?.reason ||
                  `${control?.applied_at ? `since ${workerTime(control.applied_at, read.status.day_key_timezone)}` : ''}${read.state.changed_by ? ` by ${read.state.changed_by}` : ''}`}
              </span>
            ),
          },
          {
            label: 'Last poll',
            value: (
              <Text
                as="span"
                tone={read.status.stale ? 'danger' : undefined}
                title={poll ?? undefined}
                className={styles.wrap}
              >
                {read.status.stale
                  ? `not reporting since ${workerTime(poll, read.status.day_key_timezone)}`
                  : formatRelative(poll)}
              </Text>
            ),
            sub: interval != null ? `every ${interval} s` : undefined,
            tone: read.status.stale ? 'danger' : undefined,
          },
          {
            label: 'Last turn',
            value: (
              <Text as="span" mono title={read.status.last_turn_at ?? undefined}>
                {workerTime(read.status.last_turn_at, read.status.day_key_timezone)}
              </Text>
            ),
            sub: `${read.today.turns_seen} today, ${read.today.evaluated} evaluated`,
          },
          {
            label: 'Problems, last hour',
            value: (
              <LinkButton
                to={`${location.pathname}${location.search}#problems`}
                variant="ghost"
                aria-label={`${errors} problems in the last hour`}
              >
                <Text as="span" mono tone={errors > 0 ? 'warning' : undefined}>
                  {errors}
                </Text>
              </LinkButton>
            ),
            tone: errors > 0 ? 'warning' : undefined,
          },
          {
            label: 'Current job',
            value: (
              <Text as="span" className={styles.wrap}>
                {job
                  ? `${job.kind === 'backfill_preview' ? 'Preview' : 'Backfill'} · ${evaluated} of ${found} turns`
                  : 'none'}
              </Text>
            ),
            sub: currentJob ? `updated ${formatRelative(currentJob.updated_at)}` : undefined,
          },
        ]}
      />
      <div className={styles.actions}>
        <Button
          isDisabled={busy.state}
          onPress={() =>
            read.state.desired === 'running' ? setPause(true) : void change(() => onState('running'))
          }
        >
          {read.state.desired === 'running' ? 'Pause evaluation' : 'Resume evaluation'}
        </Button>
        <Button onPress={onBackfill}>Backfill a day range</Button>
        <div className={styles.workerKey}>
          <Select
            label="Worker key"
            value={read.worker_key?.id ?? ''}
            items={[
              { key: '', label: 'No worker key' },
              ...read.api_keys.map((key) => ({ key: key.id, label: `${key.name} · ${key.prefix}…` })),
            ]}
            onChange={(id) => void change(() => onKey(id ? String(id) : null))}
            isDisabled={busy.key}
            help="Secrets are delivered to this key only."
            wrapValue
            renderValue={(item) => (
              <span className={styles.wrap} dir="auto">
                {item.label}
              </span>
            )}
          />
        </div>
      </div>
      {!read.worker_key ? (
        <InlineNotice tone="warning">Choose the worker key before saving settings</InlineNotice>
      ) : null}
      {error ? (
        <ErrorState compact error={error} title="Couldn’t change the worker" message={errorSentence(error)} />
      ) : null}
      <ConfirmDialog
        open={pause}
        onOpenChange={setPause}
        title="Pause evaluation?"
        description="Evaluation stops after the current turns; chats are evaluated when you resume."
        confirmLabel="Pause"
        onConfirm={async () => {
          setError(null);
          try {
            await onState('paused');
          } catch (e) {
            setError(e);
            throw new Error(errorSentence(e));
          }
        }}
      />
    </section>
  );
}
