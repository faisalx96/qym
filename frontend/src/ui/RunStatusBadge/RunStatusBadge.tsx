import type { BadgeTone } from '../Badge';
import { StatusMark, type StatusShape, type StatusTone } from '../StatusMark';

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

const TONES: Record<string, StatusTone> = {
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
  // sent and waits for a person (status rules 2026-11-12): warning + hourglass
  SUBMITTED: 'warning',
};

const SHAPES: Record<string, StatusShape> = {
  COMPLETED: 'full',
  IMPROVED: 'full',
  APPROVED: 'check',
  RUNNING: 'orbit',
  STOPPING: 'orbit',
  FAILED: 'cross',
  REJECTED: 'cross',
  REGRESSED: 'cross',
  STOPPED: 'pause',
  DRAFT: 'dot',
  PENDING: 'ring',
  SUBMITTED: 'hourglass',
};

export function runStatusTone(status: RunStatus): BadgeTone {
  return TONES[String(status).toUpperCase()] ?? 'neutral';
}

export function runStatusShape(status: RunStatus): StatusShape {
  return SHAPES[String(status).toUpperCase()] ?? 'ring';
}

/** A run's lifecycle status as a `StatusMark` (pixel figure + word). */
export function RunStatusBadge({ status, label }: { status: RunStatus; label?: string }) {
  const key = String(status).toUpperCase();
  return (
    <StatusMark
      tone={TONES[key] ?? 'neutral'}
      shape={runStatusShape(status)}
      // run statuses arrive upper case (COMPLETED): the word is lower case, StatusMark capitalises its first letter
      label={(label ?? key).toLowerCase()}
      data-status={key}
    />
  );
}
