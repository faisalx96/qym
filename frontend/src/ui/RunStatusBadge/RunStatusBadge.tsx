import { Badge, type BadgeTone } from '../Badge';

export type RunStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED'
  | 'STOPPING'
  | 'APPROVED'
  | 'REJECTED'
  | 'DRAFT'
  | string;

const TONES: Record<string, BadgeTone> = {
  COMPLETED: 'success',
  APPROVED: 'success',
  IMPROVED: 'success',
  RUNNING: 'info',
  STOPPING: 'info',
  FAILED: 'danger',
  REJECTED: 'danger',
  REGRESSED: 'danger',
  STOPPED: 'warning',
  DRAFT: 'warning',
  PENDING: 'neutral',
  SUBMITTED: 'neutral',
};

export function runStatusTone(status: RunStatus): BadgeTone {
  return TONES[String(status).toUpperCase()] ?? 'neutral';
}

export function RunStatusBadge({ status, label }: { status: RunStatus; label?: string }) {
  const tone = runStatusTone(status);
  return (
    <Badge
      tone={tone}
      dot={tone === 'info'}
      glyph={String(status).toUpperCase() === 'APPROVED' ? '✓' : undefined}
      data-status={String(status).toUpperCase()}
    >
      {label ?? String(status).toLowerCase()}
    </Badge>
  );
}
