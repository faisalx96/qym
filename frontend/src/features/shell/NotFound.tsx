import { useLocation } from 'react-router-dom';
import { EmptyState, Icon, LinkButton } from '@/ui';
import { constrained } from './layout';

export function NotFound() {
  const location = useLocation();
  return (
    <div className={constrained} data-not-found>
      <EmptyState
        icon={<Icon name="warning" />}
        title="Page not found"
        body={`Nothing lives at ${location.pathname}.`}
        action={
          <LinkButton to="/" variant="accent">
            Back to projects
          </LinkButton>
        }
      />
    </div>
  );
}
