/**
 * Performance home: the question asked before a run is stopped. The same dialog as on the run page, written
 * from what Home knows about the run in progress. A refusal stays in the dialog, in the API's words.
 */
import {
  performanceError,
  useStopPerformanceRun,
  type PerformanceActiveRun,
  type StopRunError,
} from '@/api/performance';
import { FormDialog } from '@/ui';
import { span } from '../../lib/format';
import { passedLevels } from './model';

const REASON_MOST = 500;

/** What stops and what is kept, for the state the run is in. */
export function stopWords(active: PerformanceActiveRun): string {
  if (active.status === 'queued' || active.elapsed_s === null)
    return `Run ${active.number} has not started yet. It is taken out of the queue and nothing is sent to the target. A stopped run cannot continue later.`;
  const passed = passedLevels(active);
  const where = active.level === null ? '' : ` and is measuring ${active.level} users`;
  const kept = passed.length
    ? `The result will cover what is measured so far: ${passed.join(' and ')} users passed.`
    : 'The result will cover what is measured so far.';
  const hold = active.level === null ? '' : ' The level in progress will say how much of its hold ran.';
  return `Run ${active.number} is ${span(active.elapsed_s)} in${where}. The users leave within a few seconds and the answers still in flight are dropped. A stopped run cannot continue later. ${kept}${hold}`;
}

export function StopRunDialog({
  slug,
  active,
  open,
  onOpenChange,
}: {
  slug: string;
  active: PerformanceActiveRun;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stop = useStopPerformanceRun(slug, active.id);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Stop this run?"
      description={stopWords(active)}
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
          // The area is read again by itself after a refusal; the dialog keeps the API's own sentence.
          return (
            performanceError<StopRunError>(error)?.message ??
            'The request did not reach qym. The run is still going. Try again.'
          );
        }
      }}
    />
  );
}
