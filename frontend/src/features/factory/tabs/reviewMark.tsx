/** The one status mark of a generated item's review, shared by the attempt table and the item popup. */
import type { ReviewState } from '@/api/factory';
import { StatusMark, type StatusShape, type StatusTone } from '@/ui';

export const REVIEW_MARK: Record<ReviewState, { tone: StatusTone; shape: StatusShape; label: string }> = {
  pending: { tone: 'neutral', shape: 'dot', label: 'Pending' },
  approved: { tone: 'success', shape: 'check', label: 'Approved' },
  rejected: { tone: 'danger', shape: 'cross', label: 'Rejected' },
};

export function ReviewMark({ review }: { review: ReviewState }) {
  const mark = REVIEW_MARK[review];
  return <StatusMark tone={mark.tone} shape={mark.shape} label={mark.label} data-review={review} />;
}
