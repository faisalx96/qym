import { useParams } from 'react-router-dom';
import { useFeedbackRequest } from '@/api/feedback';
import { constrained } from '@/features/shell/layout';
import { ErrorState } from '@/ui';
import { DraftPage } from './DraftPage';
import { FeedbackListPage } from './FeedbackListPage';
import { ChatLoadingFrame, RequestLoadingFrame } from './LoadingFrames';
import { NewFeedbackPage } from './NewFeedbackPage';
import { RequestPage } from './RequestPage';
import styles from './feedback.module.css';

export function FeedbackIndexRoute() {
  return <FeedbackListPage />;
}

export function FeedbackNewRoute() {
  return <NewFeedbackPage />;
}

/** /feedback/:ref: a draft opens the chat, a submitted request opens its page. */
export function FeedbackItemRoute() {
  const { ref = '' } = useParams();
  const q = useFeedbackRequest(ref);
  if (q.isError)
    return (
      <div className={`${constrained} ${styles.page}`}>
        <ErrorState
          error={q.error}
          title="Couldn’t open this request"
          notFoundMessage="This request does not exist or is not yours"
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  if (!q.data) return /^FB-/i.test(ref) ? <RequestLoadingFrame /> : <ChatLoadingFrame />;
  if (q.data.request.status === 'draft') return <DraftPage refId={ref} />;
  return <RequestPage detail={q.data} routeRef={ref} />;
}
