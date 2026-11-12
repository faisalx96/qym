import { StatusMark, Tag, type StatusShape, type StatusTone } from '@/ui';
import type { FeedbackComplexity, FeedbackPriority, FeedbackStatus, RelatedKind } from '@/api/feedback';
import styles from './badges.module.css';

const STATUS_FIGURE: Record<FeedbackStatus, [StatusTone, StatusShape]> = {
  draft: ['warning', 'dot'],
  new: ['warning', 'hourglass'],
  accepted: ['success', 'check'],
  planned: ['neutral', 'ring'],
  done: ['success', 'full'],
  declined: ['danger', 'cross'],
};
const PRIORITY_TONE: Record<FeedbackPriority, 'warning' | 'danger' | undefined> = {
  low: undefined,
  medium: 'warning',
  high: 'danger',
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
  const [tone, shape] = STATUS_FIGURE[status] ?? ['neutral', 'ring'];
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

/** The level of a Priority or Complexity tag: 1 grey bar, 2 orange bars, 3 red bars (D-30). */
export const PRIORITY_LEVEL: Record<FeedbackPriority, 1 | 2 | 3> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 3,
};
export const COMPLEXITY_LEVEL: Record<FeedbackComplexity, 1 | 2 | 3> = { S: 1, M: 2, L: 3, XL: 3 };

/** 'Priority High' / 'Complexity M': a neutral Tag led by three level bars; the tooltip holds the reasoning (D-30). */
export function LevelTag({
  label,
  value,
  level,
  title,
}: {
  label: string;
  value: string;
  level: 1 | 2 | 3;
  title?: string;
}) {
  return (
    <Tag title={title}>
      <span className={styles.levels} data-level={level} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label} {value}
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
