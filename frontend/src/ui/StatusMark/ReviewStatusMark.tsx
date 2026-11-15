import { StatusMark, type StatusShape, type StatusTone } from './StatusMark';

const REVIEW_FIGURES: Record<string, [StatusTone, StatusShape]> = {
  // waits for a reviewer (status rules 2026-11-12): warning + hourglass, the word "Awaiting review"
  pending: ['warning', 'hourglass'],
  approved: ['success', 'check'],
  rejected: ['danger', 'cross'],
};

const REVIEW_LABELS: Record<string, string> = {
  pending: 'awaiting review',
};

/** A review status (pending, approved, rejected) as a `StatusMark`: Reviews rows and the run page's issues (C174). */
export function ReviewStatusMark({ status }: { status: string }) {
  const [tone, shape] = REVIEW_FIGURES[status] ?? ['neutral', 'ring'];
  return (
    <StatusMark tone={tone} shape={shape} label={REVIEW_LABELS[status] ?? status} data-status={status} />
  );
}
