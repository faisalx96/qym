import { StatusMark, Tag, type StatusShape, type StatusTone } from '@/ui';
import type { FeedbackComplexity, FeedbackPriority, FeedbackStatus, RelatedKind } from '@/api/feedback';

const STATUS_FIGURE: Record<FeedbackStatus, [StatusTone, StatusShape]> = {
  draft: ['warning', 'dot'],
  new: ['neutral', 'ring'],
  accepted: ['info', 'check'],
  planned: ['info', 'hourglass'],
  done: ['success', 'full'],
  declined: ['danger', 'cross'],
};
const PRIORITY_TONE: Record<FeedbackPriority, 'info' | 'warning' | 'danger' | undefined> = {
  low: undefined,
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};
const KIND_TONE: Record<RelatedKind, 'warning' | 'danger' | undefined> = {
  duplicate: 'warning',
  conflict: 'danger',
  related: undefined,
};
export const KIND_LABEL: Record<RelatedKind, string> = {
  duplicate: 'Duplicate',
  conflict: 'Conflict',
  related: 'Related',
};

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  const [tone, shape] = STATUS_FIGURE[status];
  return <StatusMark tone={tone} shape={shape} label={status} data-status={status} />;
}

export function PriorityBadge({ value }: { value: FeedbackPriority | null }) {
  if (!value) return <span>—</span>;
  return (
    <Tag tone={PRIORITY_TONE[value]} data-priority={value}>
      {cap(value)}
    </Tag>
  );
}

export function ComplexityTag({ value }: { value: FeedbackComplexity | null }) {
  if (!value) return <span>—</span>;
  return (
    <Tag kind="data" data-complexity={value}>
      {value}
    </Tag>
  );
}

export function KindBadge({ kind }: { kind: RelatedKind }) {
  return <Tag tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Tag>;
}
