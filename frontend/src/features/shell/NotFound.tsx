import { useLocation } from 'react-router-dom';
import { EmptyState, Icon, LinkButton } from '@/ui';
import { constrained } from './layout';

/** C156: '<Thing> not found', one sentence of cause and one link to the parent list. */
export function NotFound() {
  const location = useLocation();
  return (
    <div className={constrained} data-not-found>
      <EmptyState
        icon={<Icon name="warning" />}
        title="Page not found"
        body={`Nothing lives at ${location.pathname}. The link may be wrong.`}
        action={
          <LinkButton to="/" variant="neutral">
            Projects
          </LinkButton>
        }
      />
    </div>
  );
}
