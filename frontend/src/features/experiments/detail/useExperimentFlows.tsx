/**
 * Cancel / retry / save-as-preset flows of the experiment detail page, plus the dialogs
 * they open. Returns the actions and one `dialogs` element to mount.
 *
 * Retry rules: a 422 `preemption_acknowledgement_required` re-asks with a HIGH warning and
 * resends `acknowledge_preemption`; a 422 `temporary_key_required` opens the key re-entry
 * dialog and resends with `temporary_keys` (kept in a local variable only, dropped when the
 * call chain ends). "Retry failed" runs serially and asks each of these once for the batch.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useExperimentActions,
  useSavePreset,
  type ExperimentDetail,
  type ExperimentJob,
} from '@/api/experiments';
import { announceRunStatus } from '@/lib/run-status';
import { ConfirmDialog, FormDialog, useToast, type ConfirmDialogProps } from '@/ui';
import { TemporaryKeysDialog } from '../components/TemporaryKeysDialog';
import {
  cancelDescription,
  classifyActionError,
  isCancellable,
  isRetryable,
  outcomeSummary,
  planCancelExperiment,
  stoppedRunIds,
  type ActionError,
} from '../lib/cancel';
import { currentJobs, defaultPresetName, presetConfig, temporaryModels } from '../lib/matrix';
import { plural } from '../lib/format';
import { launchPath } from '../paths';

type ConfirmSpec = Omit<ConfirmDialogProps, 'open' | 'onOpenChange'>;
type KeyResult = Record<string, string> | 'clone' | null;

export const CONTROL_HINT = 'Only the experiment’s creator or a project manager can do this';

export interface ExperimentFlows {
  busy: ReadonlySet<string>;
  denied: boolean;
  cancelExperiment: () => void;
  cancelJob: (job: ExperimentJob) => void;
  retryJob: (job: ExperimentJob) => void;
  retryFailed: () => void;
  savePreset: (job: ExperimentJob) => void;
  dialogs: ReactNode;
}

export function useExperimentFlows(
  projectId: string,
  slug: string,
  detail: ExperimentDetail,
): ExperimentFlows {
  const toast = useToast();
  const navigate = useNavigate();
  const {
    cancelExperiment: cancelX,
    cancelJob: cancelJ,
    retryJob: retryJ,
  } = useExperimentActions(projectId, detail.id);
  const savePresetMutation = useSavePreset(projectId);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<{ open: boolean; spec: ConfirmSpec } | null>(null);
  const [keyRequest, setKeyRequest] = useState<{
    slots: ActionError['slots'];
    resolve: (r: KeyResult) => void;
  } | null>(null);
  const [presetJob, setPresetJob] = useState<ExperimentJob | null>(null);
  // The latest detail for flows that outlive a render (retry loops).
  const detailRef = useRef(detail);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  const mark = useCallback((ids: string[], on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);

  /** Open a confirm dialog and resolve true on confirm, false on any other way out. */
  const ask = useCallback(
    (spec: Omit<ConfirmSpec, 'onConfirm' | 'onCancel'>) =>
      new Promise<boolean>((resolve) => {
        setConfirm({
          open: true,
          spec: { ...spec, onConfirm: () => resolve(true), onCancel: () => resolve(false) },
        });
      }),
    [],
  );

  const fail = useCallback(
    (error: ActionError): void => {
      if (error.kind === 'denied') setDenied(true);
      toast.show(error.message || 'The request failed', { tone: 'error' });
    },
    [toast],
  );

  const cancelExperiment = useCallback(() => {
    const d = detailRef.current;
    const plan = planCancelExperiment(d.jobs, d.name || d.id);
    if (plan.kind === 'none') {
      toast.show('Every job has already finished', { tone: 'info' });
      return;
    }
    setConfirm({
      open: true,
      spec: {
        title: plan.title,
        description: plan.description,
        confirmLabel: plan.confirmLabel,
        cancelLabel: plan.cancelLabel,
        tone: 'danger',
        onConfirm: async () => {
          mark(['all'], true);
          try {
            const r = await cancelX.mutateAsync({ include_running: plan.includeRunning });
            const skipped = r.skipped_running?.length ?? 0;
            toast.show(outcomeSummary(r.outcomes) + (skipped ? `; ${skipped} running left untouched` : ''), {
              tone: 'success',
            });
            const runIds = stoppedRunIds(plan.targets, r.outcomes);
            if (runIds.length) announceRunStatus(runIds, 'STOPPING');
          } catch (e) {
            const c = classifyActionError(e);
            if (c.kind === 'denied') {
              fail(c);
              return;
            }
            throw new Error(c.message || 'Failed to cancel the experiment');
          } finally {
            mark(['all'], false);
          }
        },
      },
    });
  }, [cancelX, fail, mark, toast]);

  const cancelJob = useCallback(
    (job: ExperimentJob) => {
      const where = job.environment_name || 'this environment';
      setConfirm({
        open: true,
        spec: {
          title: `Cancel job #${job.combo_index} on ${where}?`,
          description: cancelDescription([job]),
          confirmLabel: 'Cancel job',
          cancelLabel: 'Keep running',
          tone: 'danger',
          onConfirm: async () => {
            mark([job.id], true);
            try {
              const r = await cancelJ.mutateAsync({ jobId: job.id });
              toast.show(outcomeSummary({ [job.id]: r.outcome }), { tone: 'success' });
              const runIds = stoppedRunIds([job], { [job.id]: r.outcome });
              if (runIds.length) announceRunStatus(runIds, 'STOPPING');
            } catch (e) {
              const c = classifyActionError(e);
              if (c.kind === 'denied') {
                fail(c);
                return;
              }
              throw new Error(c.message || 'Failed to cancel the job');
            } finally {
              mark([job.id], false);
            }
          },
        },
      });
    },
    [cancelJ, fail, mark, toast],
  );

  /** Retry these jobs one after another; asks for acknowledgement / keys once for the batch. */
  const runRetries = useCallback(
    async (jobs: ExperimentJob[], batch: boolean) => {
      let acknowledged = false;
      let keys: Record<string, string> | undefined;
      let queued = 0;
      mark(
        jobs.map((j) => j.id),
        true,
      );
      try {
        for (const job of jobs) {
          for (let attempt = 0; ; attempt += 1) {
            try {
              await retryJ.mutateAsync({
                jobId: job.id,
                body: {
                  ...(acknowledged ? { acknowledge_preemption: true } : {}),
                  ...(keys ? { temporary_keys: keys } : {}),
                },
              });
              queued += 1;
              break;
            } catch (e) {
              const c = classifyActionError(e);
              if (attempt < 4 && c.kind === 'preemption' && !acknowledged) {
                const ok = await ask({
                  title: batch
                    ? 'Retry at HIGH priority?'
                    : `Retry job #${job.combo_index} at HIGH priority?`,
                  description: [c.message],
                  confirmLabel: 'Retry at HIGH',
                  cancelLabel: 'Don’t retry',
                  tone: 'danger',
                });
                if (!ok) return;
                acknowledged = true;
                continue;
              }
              if (attempt < 4 && c.kind === 'temporary_keys' && c.slots.length) {
                const result = await new Promise<KeyResult>((resolve) =>
                  setKeyRequest({ slots: c.slots, resolve }),
                );
                setKeyRequest(null);
                if (result === 'clone') {
                  navigate(launchPath(slug, { clone: detailRef.current.id, job: job.id }));
                  return;
                }
                if (!result) return;
                keys = { ...keys, ...result };
                continue;
              }
              fail(c);
              return;
            }
          }
        }
      } finally {
        keys = undefined;
        mark(
          jobs.map((j) => j.id),
          false,
        );
        if (queued) {
          const first = jobs[0];
          toast.show(
            batch || !first
              ? `Queued ${plural(queued, 'new attempt')}`
              : `Queued a new attempt of job #${first.combo_index}`,
            {
              tone: 'success',
            },
          );
        }
      }
    },
    [ask, fail, mark, navigate, retryJ, slug, toast],
  );

  const retryJob = useCallback((job: ExperimentJob) => void runRetries([job], false), [runRetries]);

  const retryFailed = useCallback(() => {
    const jobs = currentJobs(detailRef.current).filter(isRetryable);
    if (!jobs.length) return;
    setConfirm({
      open: true,
      spec: {
        title: `Retry ${plural(jobs.length, 'job')}?`,
        description: [
          'Every failed, timed out, cancelled or blocked job gets a new attempt; earlier attempts stay in the job history.',
        ],
        confirmLabel: 'Retry jobs',
        cancelLabel: 'Don’t retry',
        onConfirm: () => {
          // Run after the dialog closes so a follow-up question can take its place.
          setTimeout(() => void runRetries(jobs, true), 0);
        },
      },
    });
  }, [runRetries]);

  const presetJobConfig = useMemo(() => (presetJob ? presetConfig(presetJob) : {}), [presetJob]);
  const temporary = useMemo(() => temporaryModels(presetJobConfig), [presetJobConfig]);

  const dialogs = (
    <>
      {confirm ? (
        <ConfirmDialog
          {...confirm.spec}
          open={confirm.open}
          onOpenChange={(open) => setConfirm((c) => (c ? { ...c, open } : c))}
        />
      ) : null}
      <TemporaryKeysDialog
        open={Boolean(keyRequest)}
        slots={keyRequest?.slots ?? []}
        onSubmit={(keysEntered) => keyRequest?.resolve(keysEntered)}
        onCancel={() => keyRequest?.resolve(null)}
        onClone={() => keyRequest?.resolve('clone')}
      />
      <FormDialog
        open={Boolean(presetJob)}
        onOpenChange={(open) => {
          if (!open) setPresetJob(null);
        }}
        title="Save as preset"
        description={
          presetJob
            ? [
                `Saves combination #${presetJob.combo_index} on ${presetJob.environment_name || 'this environment'} as a saved preset (without its sweep).`,
                ...temporary.map(
                  (t) => `Temporary model ${t} is saved without its key; it is asked for again at launch.`,
                ),
              ].join(' ')
            : undefined
        }
        fields={[
          {
            name: 'name',
            label: 'Preset name',
            value: presetJob ? defaultPresetName(detail.name, presetJob) : '',
            required: true,
            autoFocus: true,
          },
          { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Optional' },
        ]}
        confirmLabel="Save preset"
        onSubmit={async (values) => {
          if (!presetJob) return;
          try {
            const r = await savePresetMutation.mutateAsync({
              environmentId: presetJob.environment_id,
              name: String(values.name).trim(),
              notes: String(values.notes ?? '').trim() || null,
              config: presetJobConfig,
            });
            toast.show(`Saved preset “${r.preset?.name ?? values.name}”`, { tone: 'success' });
            const warnings = (r.warnings ?? []).map((w) => w.message).filter(Boolean);
            if (warnings.length) toast.show(warnings.slice(0, 2).join(' '), { tone: 'info' });
          } catch (e) {
            const detailList = (e as { body?: { detail?: { errors?: { message?: string }[] } } }).body?.detail
              ?.errors;
            return detailList?.[0]?.message || classifyActionError(e).message || 'Failed to save the preset';
          }
        }}
      />
    </>
  );

  return {
    busy,
    denied,
    cancelExperiment,
    cancelJob,
    retryJob,
    retryFailed,
    savePreset: setPresetJob,
    dialogs,
  };
}

export { isCancellable, isRetryable };
