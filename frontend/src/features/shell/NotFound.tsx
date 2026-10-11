import { Link, useLocation } from 'react-router-dom';
import { Button, EmptyState, Icon } from '@/ui';
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
          <Button variant="accent">
            <Link to="/">Back to projects</Link>
          </Button>
        }
      />
    </div>
  );
}
