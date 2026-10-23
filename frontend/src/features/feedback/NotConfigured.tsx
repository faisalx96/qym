import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/shell/AuthContext';
import { Button, Card, EmptyState, PageHeader } from '@/ui';
import { constrained } from '@/features/shell/layout';
import { FeedbackGlyph } from './FeedbackGlyph';
import styles from './feedback.module.css';

/** QE-123: the page a person sees at /feedback/new while no model is connected. */
export function NotConfigured() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  return (
    <div className={`${constrained} ${styles.page}`} data-testid="feedback-unconfigured-page">
      <PageHeader
        title="New feedback"
        description="Tell the assistant what you need. It proposes a request for you to confirm."
      />
      <Card as="section" aria-label="Not set up">
        <EmptyState
          icon={<FeedbackGlyph size={48} />}
          title="The feedback assistant is not set up yet"
          body={
            isAdmin
              ? 'Connect a model for it under Admin, Feedback agent. Until then people can read every request but not start a new one.'
              : 'An administrator has to connect a model for it first. You can read every request in the meantime.'
          }
          action={
            isAdmin ? (
              <Button variant="accent" size="md" onPress={() => navigate('/admin/feedback')}>
                Open Feedback agent settings
              </Button>
            ) : (
              <Button variant="neutral" size="md" onPress={() => navigate('/feedback')}>
                Browse requests
              </Button>
            )
          }
        />
      </Card>
    </div>
  );
}
