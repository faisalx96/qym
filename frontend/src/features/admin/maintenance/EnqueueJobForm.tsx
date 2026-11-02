import { useId, useMemo, useState } from 'react';
import {
  useEnqueueJob,
  type MaintenanceJobKind,
  type MaintenanceJobParam,
  type MaintenanceOverview,
} from '@/api/admin';
import { actionErrorMessage } from '@/lib/http';
import { useSubmitLock } from '@/lib/pending';
import { Button, Flag, Select, Text, TextField, useToast } from '@/ui';
import styles from './maintenance.module.css';

export interface EnqueueJobFormProps {
  kinds: MaintenanceOverview['job_kinds'];
  onQueued?: (jobId: string) => void;
}

/** The JSON a picked job starts from: every key it takes, at its default. */
export function defaultParams(meta: MaintenanceJobKind | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(meta?.params ?? {}).map(([key, p]) => [key, p.default]));
}

/** One param's line under the form: type, default, limits, then what it does. */
export function describeParam(p: MaintenanceJobParam): string {
  const parts = [p.type, `default ${JSON.stringify(p.default)}`];
  if (p.minimum !== undefined) parts.push(`min ${p.minimum}`);
  if (p.maximum !== undefined) parts.push(`max ${p.maximum}`);
  if (p.choices) parts.push(`one of ${p.choices.join(', ')}`);
  return `${parts.join(', ')}. ${p.description}`;
}

/**
 * Queue a maintenance job: kind (sorted; irreversible kinds badged; none picked at first, so Queue
 * stays disabled until the admin picks one), JSON params (validated client-side, prefilled with the
 * picked job's defaults; the server refuses any key the job does not declare), typed confirmation only
 * for irreversible kinds (must equal the kind name; the server enforces it too). One row of 24px controls
 * on one bottom line; the kind's description and any error sit on the line under it, so an error never
 * moves the controls. The keys the job takes are listed under that line.
 */
export function EnqueueJobForm({ kinds, onQueued }: EnqueueJobFormProps) {
  const items = useMemo(
    () =>
      Object.keys(kinds)
        .sort()
        .map((k) => ({ key: k, label: k, description: kinds[k]!.irreversible ? 'irreversible' : undefined })),
    [kinds],
  );
  const [kind, setKind] = useState<string>('');
  const [params, setParams] = useState('{}');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enqueue = useEnqueueJob();
  const lock = useSubmitLock();
  const toast = useToast();
  const helpId = useId();
  const meta = kind ? kinds[kind] : undefined;
  const paramKeys = Object.entries(meta?.params ?? {});
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
  const canSubmit = Boolean(meta) && !paramsError && confirmOk && !enqueue.isPending;

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
      setError(actionErrorMessage('queue the job', e));
    }
  }

  return (
    <form
      className={styles.jobForm}
      aria-label="Queue a maintenance job"
      data-enqueue-form
      onSubmit={(e) => {
        e.preventDefault();
        void lock(submit);
      }}
    >
      <div className={styles.jobFields}>
        <Select
          label="Job"
          items={items}
          value={kind || null}
          placeholder="Pick a job"
          onChange={(k) => {
            const next = String(k ?? '');
            setKind(next);
            setParams(JSON.stringify(defaultParams(kinds[next])));
            setConfirm('');
            setError(null);
          }}
          searchable="auto"
          width={280}
          name="kind"
        />
        <TextField
          label="Params (JSON)"
          value={params}
          onChange={setParams}
          mono
          isInvalid={Boolean(paramsError)}
          aria-describedby={helpId}
          className={styles.params}
          autoComplete="off"
          spellCheck="false"
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
          isDisabled={!canSubmit}
          loading={enqueue.isPending}
        >
          {irreversible ? 'Queue irreversible job' : 'Queue job'}
        </Button>
      </div>
      <div className={styles.jobHelp} id={helpId} data-kind-help>
        {paramsError ? (
          <Text variant="sm" tone="danger" role="alert">
            {paramsError}
          </Text>
        ) : (
          <>
            {irreversible ? (
              <Flag tone="danger" icon="warning">
                Irreversible
              </Flag>
            ) : null}
            <Text variant="sm" tone="muted">
              {meta?.description ?? 'Pick a job.'}
            </Text>
          </>
        )}
      </div>
      {meta ? (
        <ul className={styles.paramKeys} aria-label={`Params of ${kind}`} data-param-keys>
          {paramKeys.length === 0 ? (
            <li>
              <Text variant="sm" tone="muted">
                Takes no params.
              </Text>
            </li>
          ) : (
            paramKeys.map(([key, p]) => (
              <li key={key} data-param-key={key}>
                <Text variant="sm" mono tone="secondary">
                  {key}
                </Text>{' '}
                <Text variant="sm" tone="muted">
                  {describeParam(p)}
                </Text>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {error ? (
        <Text variant="sm" tone="danger" role="alert" data-enqueue-error>
          {error}
        </Text>
      ) : null}
    </form>
  );
}
