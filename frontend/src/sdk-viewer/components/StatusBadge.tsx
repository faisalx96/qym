import { StatusMark, type StatusShape, type StatusTone } from '@/ui/StatusMark';
import type { RowStatus } from '../types';
import { STATUS_LABEL } from './format';

const FIGURE: Record<RowStatus, [StatusTone, StatusShape]> = {
  completed: ['success', 'full'],
  in_progress: ['info', 'orbit'],
  pending: ['neutral', 'ring'],
  error: ['danger', 'cross'],
};

export function StatusBadge({ status }: { status: RowStatus }) {
  const [tone, shape] = FIGURE[status];
  return <StatusMark tone={tone} shape={shape} label={STATUS_LABEL[status]} data-status={status} />;
}
