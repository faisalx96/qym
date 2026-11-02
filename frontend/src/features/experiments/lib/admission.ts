/**
 * The admission line of a latency-sensitive job: the second line of the jobs table's Status cell
 * (spec-b B5-52). Pure; the mock gallery draws the same precedence.
 */
import type { ExperimentJob } from '@/api/experiments';
import { isTerminalJob } from '@/api/experiments';
import { isCancellable } from './cancel';

export type AdmissionJob = Pick<
  ExperimentJob,
  | 'status'
  | 'error'
  | 'wait_reason'
  | 'admitted_at'
  | 'deferrals'
  | 'deferral_reason'
  | 'contaminated_attempts'
>;

export interface AdmissionLine {
  text: string;
  /** Error text (red). */
  error?: boolean;
  /** The absolute value for the `title` (the admitted time). */
  title?: string;
}

/** `HH:mm` in the viewer's time zone. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * First match wins: (1) the job's error, (2) a non-terminal job with deferrals and no admission,
 * (3) a running job with its admission time, (4) re-queues after contamination, (5) the wait reason
 * of a cancellable job, (6) nothing. `latency` is false for an ordinary experiment, which keeps
 * today's cell (error, then the wait reason).
 */
export function admissionLine(job: AdmissionJob, latency = true): AdmissionLine | null {
  if (job.error) return { text: job.error, error: true };
  if (latency) {
    if (!isTerminalJob(job.status) && job.deferrals > 0 && !job.admitted_at) {
      const reason = job.deferral_reason ? ` · ${job.deferral_reason}` : '';
      return { text: `deferred ×${job.deferrals}${reason}` };
    }
    if (job.status === 'RUNNING' && job.admitted_at)
      return { text: `admitted ${clockTime(job.admitted_at)}`, title: job.admitted_at };
    if (job.contaminated_attempts > 0 && job.status !== 'RUNNING')
      return { text: `re-queued ×${job.contaminated_attempts} · contaminated` };
  }
  if (job.wait_reason && isCancellable(job)) return { text: job.wait_reason };
  return null;
}
