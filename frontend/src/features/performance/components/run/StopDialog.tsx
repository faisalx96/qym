/** Performance run page: the question before a run is stopped, with an optional reason. */
import {
  performanceError,
  useStopPerformanceRun,
  type PerformanceRunRead,
  type StopRunError,
} from '@/api/performance';
import { FormDialog } from '@/ui';
import { span } from '../../lib/format';

const REASON_MOST = 500;

/** What stops and what is kept, for the state the run is in. */
export function stopWords(read: PerformanceRunRead): string {
  const { progress, run } = read;
  if (!progress)
    return `Run ${run.number} has not started yet. It is taken out of the queue and nothing is sent to the target. A stopped run cannot continue later.`;
  const passed = progress.levels
    .filter((item) => item.state === 'done' && item.result === 'pass')
    .map((item) => item.level);
  const where = progress.level === null ? '' : ` and is measuring ${progress.level} users`;
  const kept = passed.length
    ? `The result will cover what is measured so far: ${passed.join(' and ')} users passed.`
    : 'The result will cover what is measured so far.';
  const hold = progress.level === null ? '' : ' The level in progress will say how much of its hold ran.';
  return `Run ${run.number} is ${span(progress.elapsed_s)} in${where}. The users leave within a few seconds and the answers still in flight are dropped. A stopped run cannot continue later. ${kept}${hold}`;
}

export function StopDialog({
  slug,
  runId,
  read,
  open,
  onOpenChange,
}: {
  slug: string;
  runId: string;
  read: PerformanceRunRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stop = useStopPerformanceRun(slug, runId);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Stop this run?"
      description={stopWords(read)}
      fields={[
        {
          name: 'reason',
          label: 'Reason',
          type: 'textarea',
          rows: 2,
          help: 'Shown on the run page. You can leave it empty.',
          validate: (value) =>
            String(value).trim().length > REASON_MOST
              ? `Keep the reason under ${REASON_MOST} characters.`
              : null,
        },
      ]}
      tone="danger"
      cancelLabel="Keep running"
      confirmLabel="Stop run"
      submittingLabel="Stopping…"
      onSubmit={async (values) => {
        const reason = String(values.reason ?? '').trim();
        try {
          await stop.mutateAsync(reason ? { reason } : undefined);
        } catch (error) {
          return (
            performanceError<StopRunError>(error)?.message ??
            'The request did not reach qym. The run is still going. Try again.'
          );
        }
      }}
    />
  );
}
