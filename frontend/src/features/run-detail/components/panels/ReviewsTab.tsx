import { useRunPage } from '../../RunContext';
import { ReviewHistory } from '../RunPanels';

export function ReviewsTab() {
  const { runId, payload } = useRunPage();
  return <ReviewHistory runId={runId} status={payload.run.status} />;
}
