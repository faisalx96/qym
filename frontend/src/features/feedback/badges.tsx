import { Badge, Tag } from '@/ui';
import type { FeedbackComplexity, FeedbackPriority, FeedbackStatus, RelatedKind } from '@/api/feedback';

const STATUS_TONE: Record<FeedbackStatus, 'warning' | 'neutral' | 'info' | 'accent' | 'success' | 'danger'> =
  {
    draft: 'warning',
    new: 'neutral',
    accepted: 'info',
    planned: 'accent',
    done: 'success',
    declined: 'danger',
  };
const PRIORITY_TONE: Record<FeedbackPriority, 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};
const KIND_TONE: Record<RelatedKind, 'warning' | 'danger' | 'neutral'> = {
  duplicate: 'warning',
  conflict: 'danger',
  related: 'neutral',
};
export const KIND_LABEL: Record<RelatedKind, string> = {
  duplicate: 'Duplicate',
  conflict: 'Conflict',
  related: 'Related',
};

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-status={status}>
      {cap(status)}
    </Badge>
  );
}

export function PriorityBadge({ value }: { value: FeedbackPriority | null }) {
  if (!value) return <span>—</span>;
  return (
    <Badge tone={PRIORITY_TONE[value]} data-priority={value}>
      {cap(value)}
    </Badge>
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
  return <Badge tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Badge>;
}
