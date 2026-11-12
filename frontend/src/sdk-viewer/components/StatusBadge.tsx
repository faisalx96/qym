import { StateTag, type StateTagTone } from '@/ui/Tag';
import type { RowStatus } from '../types';
import { STATUS_LABEL } from './format';

/** An item's result or progress as a StateTag: Done green, Running blue, Pending grey, Error red. */
const TONE: Record<RowStatus, StateTagTone> = {
  completed: 'success',
  in_progress: 'info',
  pending: 'neutral',
  error: 'danger',
};

export function StatusBadge({ status }: { status: RowStatus }) {
  return (
    <StateTag tone={TONE[status]} data-status={status}>
      {STATUS_LABEL[status]}
    </StateTag>
  );
}
