import { useMemo, useState } from 'react';
import { useEnqueueJob, type MaintenanceOverview } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { Badge, Button, Select, Text, TextField, Textarea, useToast } from '@/ui';
import styles from './maintenance.module.css';

export interface EnqueueJobFormProps {
  kinds: MaintenanceOverview['job_kinds'];
  onQueued?: (jobId: string) => void;
}

/**
 * Queue a maintenance job: kind (sorted; irreversible kinds badged), JSON params
 * (validated client-side), typed confirmation only for irreversible kinds
 * (must equal the kind name; the server enforces it too).
 */
export function EnqueueJobForm({ kinds, onQueued }: EnqueueJobFormProps) {
  const items = useMemo(
    () =>
      Object.keys(kinds)
        .sort()
        .map((k) => ({ key: k, label: k, description: kinds[k]!.irreversible ? 'irreversible' : undefined })),
    [kinds],
  );
  const [kind, setKind] = useState<string>(items[0]?.key ?? '');
  const [params, setParams] = useState('{}');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enqueue = useEnqueueJob();
  const toast = useToast();
  const meta = kinds[kind];
  const irreversible = Boolean(meta?.irreversible);
  const paramsError = useMemo(() => {
    try {
      const v = JSON.parse(params || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? null : 'Params must be a JSON object.';
    } catch {
      return 'Params must be valid JSON.';
    }
  }, [params]);
  const confirmOk = !irreversible || confirm.trim() === kind;
  const canSubmit = Boolean(kind) && !paramsError && confirmOk && !enqueue.isPending;

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    try {
      const job = await enqueue.mutateAsync({
        kind,
        params: JSON.parse(params || '{}') as Record<string, unknown>,
        ...(irreversible ? { confirm: confirm.trim() } : {}),
      });
      toast.show(`Queued ${kind}`, { tone: 'success' });
      setConfirm('');
      onQueued?.(job.id);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.detail || `HTTP ${e.status}` : e instanceof Error ? e.message : String(e),
      );
    }
  }

  return (
    <form
      className={styles.jobForm}
      aria-label="Queue a maintenance job"
      data-enqueue-form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={styles.jobFields}>
        <Select
          label="Job"
          items={items}
          value={kind}
          onChange={(k) => {
            setKind(String(k ?? ''));
            setConfirm('');
            setError(null);
          }}
          searchable="auto"
          width={280}
          name="kind"
        />
        <Textarea
          label="Params (JSON)"
          value={params}
          onChange={setParams}
          rows={2}
          mono
          errorMessage={paramsError ?? undefined}
          className={styles.params}
          name="params"
        />
        {irreversible ? (
          <TextField
            label={`Type “${kind}” to confirm`}
            value={confirm}
            onChange={setConfirm}
            mono
            width={260}
            placeholder={kind}
            autoComplete="off"
            name="confirm"
            data-confirm-field
          />
        ) : null}
        <Button
          type="submit"
          variant={irreversible ? 'danger' : 'primary'}
          size="md"
          isDisabled={!canSubmit}
          loading={enqueue.isPending}
        >
          {irreversible ? 'Queue irreversible job' : 'Queue job'}
        </Button>
      </div>
      <div className={styles.jobHelp} data-kind-help>
        {irreversible ? <Badge tone="danger">irreversible</Badge> : null}
        <Text variant="sm" tone="muted">
          {meta?.description ?? 'Pick a job.'}
        </Text>
      </div>
      {error ? (
        <Text variant="sm" tone="danger" role="alert" data-enqueue-error>
          {error}
        </Text>
      ) : null}
    </form>
  );
}
