import { useState } from 'react';
import { validateDateRange, type LiveJob } from '@/api/liveWorker';
import { errorSentence } from '@/lib/http';
import { Button, Dialog, ErrorState, NumberField, Text, TextField, useToast } from '@/ui';
import type { WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

export function DateRangeDialog({
  open,
  onOpenChange,
  jobs,
  onCreateJob,
  busy,
  today = new Date().toISOString().slice(0, 10),
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: LiveJob[];
  busy?: boolean;
  today?: string;
} & Pick<WorkerCallbacks, 'onCreateJob'>) {
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [limit, setLimit] = useState(200);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<LiveJob | null>(null);
  const toast = useToast();
  const latest = jobs.find((job) => job.id === preview?.id) ?? preview;
  const currentPreview =
    latest?.params.since_day === since && latest.params.until_day === until && latest.params.limit === limit
      ? latest
      : null;
  async function submit(kind: LiveJob['kind']) {
    const message = validateDateRange(since, until, limit, today);
    setValidation(message);
    setError(null);
    if (message) return;
    try {
      const job = await onCreateJob({ kind, since_day: since, until_day: until, limit });
      if (kind === 'backfill_preview') setPreview(job);
      else {
        onOpenChange(false);
        toast.show('Backfill queued', { tone: 'success' });
      }
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Backfill a day range"
      size="md"
      description="Days in the source's timezone, at most 31 days"
      footer={
        <>
          <Button onPress={() => void submit('backfill_preview')} isDisabled={busy}>
            Preview
          </Button>
          <Button variant="accent" onPress={() => void submit('backfill')} isDisabled={busy}>
            Run
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <TextField label="From" type="date" value={since} onChange={setSince} />
        <TextField label="To" type="date" value={until} onChange={setUntil} />
        <NumberField label="Limit" value={limit} onChange={setLimit} help="1 to 2,000" />
        {validation ? (
          <Text role="alert" tone="danger">
            {validation}
          </Text>
        ) : null}
        {error ? (
          <ErrorState compact error={error} title="Couldn’t queue the job" message={errorSentence(error)} />
        ) : null}
        {currentPreview?.status === 'done' ? (
          <Text role="status">
            {currentPreview.progress.found ?? 0} chats, {currentPreview.progress.skipped_existing ?? 0}{' '}
            already evaluated,{' '}
            {(currentPreview.progress.found ?? 0) - (currentPreview.progress.skipped_existing ?? 0)} to
            evaluate
          </Text>
        ) : null}
        {currentPreview && (currentPreview.status === 'queued' || currentPreview.status === 'running') ? (
          <Text role="status">Preview {currentPreview.status}</Text>
        ) : null}
        {currentPreview?.status === 'failed' ? (
          <ErrorState
            compact
            error={new Error(currentPreview.error ?? 'Preview failed')}
            title="Preview failed"
            message={currentPreview.error ?? 'The worker could not preview this range.'}
          />
        ) : null}
        {currentPreview?.status === 'cancelled' ? <Text>Preview cancelled</Text> : null}
      </div>
    </Dialog>
  );
}
