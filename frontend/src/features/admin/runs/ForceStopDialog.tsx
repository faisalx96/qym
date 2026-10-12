import { useForceStop, type AdminRunSummary } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { ConfirmDialog } from '@/ui';
import { runName } from '../format';

export interface ForceStopDialogProps {
  run: AdminRunSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStopped: (run: AdminRunSummary, stopped: boolean) => void;
  onFailed: (run: AdminRunSummary, message: string) => void;
}

/** Force stop confirm: one POST on confirm; errors stay in the dialog and are reported up. */
export function ForceStopDialog({ run, open, onOpenChange, onStopped, onFailed }: ForceStopDialogProps) {
  const stop = useForceStop();
  if (!run) return null;
  const name = runName(run);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Force stop run"
      tone="danger"
      description={[
        `Permanently stop recording “${name}”? Existing results stay available.`,
        'All further updates will be rejected, including if the runner reconnects. The process may keep running where it was launched until stopped there.',
      ]}
      confirmLabel="Force stop"
      onConfirm={async () => {
        try {
          const result = await stop.mutateAsync(run.run_id);
          onStopped(run, result.stopped);
        } catch (e) {
          const message = e instanceof ApiError ? e.detail || `HTTP ${e.status}` : e instanceof Error ? e.message : String(e);
          onFailed(run, message);
          throw new Error(message);
        }
      }}
    />
  );
}
