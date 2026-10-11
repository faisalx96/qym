/** Status badges for experiments and their jobs (tones follow the vanilla pages). */
import { Badge, type BadgeTone } from '@/ui';

const EXPERIMENT_TONES: Record<string, BadgeTone> = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  CANCELLED: 'warning',
};

const JOB_TONES: Record<string, BadgeTone> = {
  QUEUED: 'neutral',
  SUBMITTING: 'info',
  SUBMITTED: 'info',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  TIMED_OUT: 'danger',
  BLOCKED: 'warning',
  CANCELLING: 'warning',
  CANCELLED: 'warning',
};

const label = (status: string) => status.toLowerCase().replace(/_/g, ' ');

export function ExperimentStatusBadge({ status }: { status: string }) {
  const tone = EXPERIMENT_TONES[status] ?? 'neutral';
  return (
    <Badge tone={tone} dot={tone === 'info'} data-status={status}>
      {label(status)}
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: string }) {
  const tone = JOB_TONES[status] ?? 'neutral';
  return (
    <Badge tone={tone} dot={tone === 'info'} data-status={status}>
      {label(status)}
    </Badge>
  );
}
