import { useStopPerformanceRun } from '@/api/performance';
import { FormDialog } from '@/ui';
import { platformError } from './words';

export function PlatformStopDialog({
  slug,
  runId,
  open,
  onOpenChange,
}: {
  slug: string;
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stop = useStopPerformanceRun(slug, runId);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Stop this run?"
      description="The test ends and keeps the results measured so far. A stopped run cannot continue later."
      fields={[
        {
          name: 'reason',
          label: 'Reason',
          type: 'textarea',
          rows: 2,
          help: 'Shown on the run page. You can leave it empty.',
          validate: (value) =>
            String(value).trim().length > 500 ? 'Keep the reason under 500 characters.' : null,
        },
      ]}
      tone="danger"
      confirmLabel="Stop run"
      cancelLabel="Keep running"
      submittingLabel="Stopping…"
      onSubmit={async (values) => {
        try {
          const reason = String(values.reason ?? '').trim();
          await stop.mutateAsync(reason ? { reason } : undefined);
        } catch (error) {
          return platformError(error);
        }
      }}
    />
  );
}
