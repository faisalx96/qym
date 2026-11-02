import { StatusMark, type StatusShape, type StatusTone } from './StatusMark';

const REVIEW_FIGURES: Record<string, [StatusTone, StatusShape]> = {
  pending: ['neutral', 'hourglass'],
  approved: ['success', 'check'],
  rejected: ['danger', 'cross'],
};

/** A review status (pending, approved, rejected) as a `StatusMark`: Reviews rows and the run page's issues (C174). */
export function ReviewStatusMark({ status }: { status: string }) {
  const [tone, shape] = REVIEW_FIGURES[status] ?? ['neutral', 'ring'];
  return <StatusMark tone={tone} shape={shape} label={status} data-status={status} />;
}
