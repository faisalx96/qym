/** Cancel / retry planning and copy for the experiment detail page (pure). */
import type { CancelOutcome, ExperimentJob, TemporaryKeySlot } from '@/api/experiments';
import { QUEUED_HERE_STATUSES, RETRYABLE_JOB_STATUSES, isTerminalJob } from '@/api/experiments';
import { errorCode, errorDetail, errorMessage } from '@/api/evalCommon';
import { ApiError } from '@/lib/http';
import { plural } from './format';

export const PREEMPTION_ACK_REQUIRED = 'preemption_acknowledgement_required';
export const TEMPORARY_KEY_REQUIRED = 'temporary_key_required';

/** Already executing on the service (experiment cancel skips these unless include_running). */
export function isRunningJob(job: Pick<ExperimentJob, 'status' | 'run_id'>): boolean {
  return job.status === 'RUNNING' || Boolean(job.run_id);
}

export function isCancellable(job: Pick<ExperimentJob, 'status'>): boolean {
  return !isTerminalJob(job.status) && job.status !== 'CANCELLING';
}

export function isRetryable(job: Pick<ExperimentJob, 'status' | 'superseded'>): boolean {
  return RETRYABLE_JOB_STATUSES.includes(job.status) && !job.superseded;
}

/** The lines explaining what cancelling these jobs does. */
export function cancelDescription(jobs: Pick<ExperimentJob, 'status'>[]): string[] {
  const queued = jobs.filter((j) => QUEUED_HERE_STATUSES.includes(j.status)).length;
  const remote = jobs.length - queued;
  const lines: string[] = [];
  if (queued)
    lines.push(`${plural(queued, 'queued job')} will be removed before reaching the Evaluation Service.`);
  if (remote)
    lines.push(
      `${plural(remote, 'submitted or running job')} will be hard-stopped; partial results stay on the linked run.`,
    );
  lines.push('Cancelled jobs can be retried later.');
  return lines;
}

export interface CancelPlan {
  /** none = nothing to cancel; pending = queued/blocked (running ones keep running); running = only running jobs remain. */
  kind: 'none' | 'pending' | 'running';
  title: string;
  description: string[];
  confirmLabel: string;
  cancelLabel: string;
  includeRunning: boolean;
  /** The jobs this cancel acts on. */
  targets: ExperimentJob[];
}

/**
 * Cancel-experiment dialog copy. Queued and blocked jobs are cancelled by default;
 * running jobs are stopped only when nothing else is pending (`include_running`).
 */
export function planCancelExperiment(jobs: ExperimentJob[], name: string): CancelPlan {
  const live = jobs.filter((j) => !j.superseded && isCancellable(j));
  const running = live.filter(isRunningJob);
  const pending = live.filter((j) => !isRunningJob(j));
  if (!live.length) {
    return {
      kind: 'none',
      title: `Cancel “${name}”?`,
      description: ['Every job has already finished.'],
      confirmLabel: 'Cancel',
      cancelLabel: 'Close',
      includeRunning: false,
      targets: [],
    };
  }
  if (pending.length === 0) {
    return {
      kind: 'running',
      title: `Stop ${plural(running.length, 'running job')} of “${name}”?`,
      description: cancelDescription(running),
      confirmLabel: `Stop ${plural(running.length, 'running job')}`,
      cancelLabel: 'Keep running',
      includeRunning: true,
      targets: running,
    };
  }
  const description = cancelDescription(pending);
  if (running.length) {
    description.push(
      `${plural(running.length, 'running job')} will keep running. To stop ${running.length === 1 ? 'it' : 'them'}, use Cancel on the job row, or cancel the experiment again once nothing else is queued.`,
    );
  }
  return {
    kind: 'pending',
    title: `Cancel queued jobs of “${name}”?`,
    description,
    confirmLabel: 'Cancel queued jobs',
    cancelLabel: 'Keep running',
    includeRunning: false,
    targets: pending,
  };
}

/** Toast text for a map of per-job cancel outcomes. */
export function outcomeSummary(outcomes: Record<string, CancelOutcome> | null | undefined): string {
  const tally: Record<string, number> = {};
  for (const outcome of Object.values(outcomes ?? {})) tally[outcome] = (tally[outcome] ?? 0) + 1;
  const parts: string[] = [];
  if (tally.cancelled) parts.push(`${tally.cancelled} cancelled`);
  if (tally.cancelling) parts.push(`${tally.cancelling} stopping on the service`);
  if (tally.already_terminal) parts.push(`${tally.already_terminal} already finished`);
  if (tally.forbidden) parts.push(`${tally.forbidden} not allowed`);
  return parts.join(', ') || 'Nothing to cancel';
}

/** Run ids of jobs whose cancel took effect (cancelled or being stopped): announce STOPPING for them. */
export function stoppedRunIds(
  jobs: Pick<ExperimentJob, 'id' | 'run_id'>[],
  outcomes: Record<string, CancelOutcome>,
): string[] {
  return jobs
    .filter((j) => j.run_id && (outcomes[j.id] === 'cancelled' || outcomes[j.id] === 'cancelling'))
    .map((j) => j.run_id as string);
}

export type ActionErrorKind = 'preemption' | 'temporary_keys' | 'denied' | 'conflict' | 'other';

export interface ActionError {
  kind: ActionErrorKind;
  message: string;
  slots: TemporaryKeySlot[];
}

/** Sort a failed cancel / retry call into the follow-up it needs. */
export function classifyActionError(error: unknown): ActionError {
  const message = errorMessage(error);
  const code = errorCode(error);
  if (code === PREEMPTION_ACK_REQUIRED) return { kind: 'preemption', message, slots: [] };
  if (code === TEMPORARY_KEY_REQUIRED) {
    const raw = errorDetail(error)?.slots;
    const slots = (Array.isArray(raw) ? raw : [])
      .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
      .map((s) => ({
        ...s,
        slot_key: String(s.slot_key ?? ''),
        label: typeof s.label === 'string' ? s.label : undefined,
      }))
      .filter((s) => s.slot_key);
    return { kind: 'temporary_keys', message, slots };
  }
  if (error instanceof ApiError && error.status === 403) return { kind: 'denied', message, slots: [] };
  if (error instanceof ApiError && error.status === 409) return { kind: 'conflict', message, slots: [] };
  return { kind: 'other', message, slots: [] };
}
