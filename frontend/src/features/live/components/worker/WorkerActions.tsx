import { useState } from 'react';
import type { LiveWorkerRead } from '@/api/liveWorker';
import { actionErrorMessage, errorSentence } from '@/lib/http';
import { Button, ConfirmDialog, Icon, useToast } from '@/ui';
import type { WorkerBusy, WorkerCallbacks } from './types';

/** Live worker page header actions (A-13): Backfill a day range, then Pause or Resume evaluation. */
export function WorkerActions({
  read,
  busy,
  onState,
  onBackfill,
}: { read: LiveWorkerRead; busy: WorkerBusy; onBackfill: () => void } & Pick<WorkerCallbacks, 'onState'>) {
  const [pause, setPause] = useState(false);
  const toast = useToast();
  const running = read.state.desired === 'running';
  async function resume() {
    try {
      await onState('running');
    } catch (e) {
      toast.show(actionErrorMessage('resume evaluation', e), { tone: 'error' });
    }
  }
  return (
    <>
      <Button variant="primary" icon={<Icon name="plus" size={12} />} onPress={onBackfill}>
        Backfill a day range
      </Button>
      <Button variant="neutral" isDisabled={busy.state} onPress={() => (running ? setPause(true) : void resume())}>
        {running ? 'Pause evaluation' : 'Resume evaluation'}
      </Button>
      <ConfirmDialog
        open={pause}
        onOpenChange={setPause}
        title="Pause evaluation?"
        description="Evaluation stops after the current turns; chats are evaluated when you resume."
        confirmLabel="Pause"
        onConfirm={async () => {
          try {
            await onState('paused');
          } catch (e) {
            throw new Error(errorSentence(e));
          }
        }}
      />
    </>
  );
}
