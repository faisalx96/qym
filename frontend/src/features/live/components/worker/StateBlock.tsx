import { useState } from 'react';
import type { LiveWorkerRead } from '@/api/liveWorker';
import { errorSentence } from '@/lib/http';
import { ConfirmDialog, ErrorState, Select, StatusMark, Switch, Text } from '@/ui';
import { WorkerBlock } from './WorkerBlock';
import type { WorkerBusy, WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

export function StateBlock({
  read,
  onState,
  onKey,
  busy,
}: { read: LiveWorkerRead; busy: WorkerBusy } & Pick<WorkerCallbacks, 'onState' | 'onKey'>) {
  const [pause, setPause] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const control = read.running;
  const state = control?.state ?? 'waiting';
  const label = `${state}${control?.reason ? `: ${control.reason}` : ''}`;
  async function change(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <WorkerBlock name="state" title="State">
      <StatusMark
        tone={state === 'running' ? 'success' : 'neutral'}
        shape={state === 'running' ? 'orbit' : state === 'paused' ? 'pause' : 'ring'}
        label={label}
      />
      <div className={styles.inline}>
        <Switch
          isSelected={read.state.desired === 'running'}
          isDisabled={busy.state}
          onChange={(running) => (running ? void change(() => onState('running')) : setPause(true))}
        >
          {read.state.desired === 'running' ? 'Running' : 'Paused'}
        </Switch>
        {read.state.changed_by ? (
          <Text tone="muted" dir="auto">
            {read.state.desired === 'paused' ? 'paused' : 'started'} by {read.state.changed_by}
            {read.state.changed_at ? `, ${read.state.changed_at.slice(11, 16)}` : ''}
          </Text>
        ) : null}
      </div>
      {read.stale ? (
        <Text tone="muted">The worker is not reporting; changes apply when it is back.</Text>
      ) : null}
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
      {!read.worker_key ? <Text tone="warning">Choose the worker key before saving settings</Text> : null}
      {control?.settings_version_applied != null ? (
        <Text>
          running v{control.settings_version_applied}
          {control.applied_at ? ` since ${control.applied_at.slice(11, 16)}` : ''}
        </Text>
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
    </WorkerBlock>
  );
}
