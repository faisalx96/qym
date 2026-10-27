/** Lifecycle status of experiments and their jobs as a `StatusMark` (tones follow the vanilla pages). */
import { StatusMark, type StatusShape, type StatusTone } from '@/ui';

const EXPERIMENT_FIGURES: Record<string, [StatusTone, StatusShape]> = {
  QUEUED: ['neutral', 'ring'],
  RUNNING: ['info', 'orbit'],
  COMPLETED: ['success', 'full'],
  PARTIAL: ['warning', 'full'],
  FAILED: ['danger', 'cross'],
  CANCELLED: ['warning', 'pause'],
};

const JOB_FIGURES: Record<string, [StatusTone, StatusShape]> = {
  QUEUED: ['neutral', 'ring'],
  SUBMITTING: ['info', 'orbit'],
  SUBMITTED: ['info', 'orbit'],
  RUNNING: ['info', 'orbit'],
  SUCCEEDED: ['success', 'full'],
  COMPLETED: ['success', 'full'],
  PARTIAL: ['warning', 'full'],
  FAILED: ['danger', 'cross'],
  TIMED_OUT: ['danger', 'cross'],
  BLOCKED: ['warning', 'hourglass'],
  CANCELLING: ['warning', 'orbit'],
  CANCELLED: ['warning', 'pause'],
};

const label = (status: string) => status.toLowerCase().replace(/_/g, ' ');

export function ExperimentStatusBadge({ status }: { status: string }) {
  const [tone, shape] = EXPERIMENT_FIGURES[status] ?? ['neutral', 'ring'];
  return <StatusMark tone={tone} shape={shape} label={label(status)} data-status={status} />;
}

export function JobStatusBadge({ status }: { status: string }) {
  const [tone, shape] = JOB_FIGURES[status] ?? ['neutral', 'ring'];
  return <StatusMark tone={tone} shape={shape} label={label(status)} data-status={status} />;
}
