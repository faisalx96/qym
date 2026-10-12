import { Badge, type BadgeTone } from '@/ui/Badge';
import type { RowStatus } from '../types';
import { STATUS_LABEL } from './format';

const TONE: Record<RowStatus, BadgeTone> = {
  completed: 'success',
  in_progress: 'info',
  pending: 'neutral',
  error: 'danger',
};

export function StatusBadge({ status }: { status: RowStatus }) {
  return (
    <Badge tone={TONE[status]} dot={status === 'in_progress'}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
