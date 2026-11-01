import { matchPath, useLocation } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { EmptyState, Icon, LinkButton } from '@/ui';
import { constrained } from './layout';

export function NotFound() {
  const location = useLocation();
  // Inside a project, the way back is that project's runs, not the projects list (C209).
  const slug = matchPath('/projects/:slug/*', location.pathname)?.params.slug;
  return (
    <div className={constrained} data-not-found>
      <EmptyState
        icon={<Icon name="warning" />}
        title="Page not found"
        body={`Nothing lives at ${location.pathname}.`}
        action={
          slug ? (
            <LinkButton to={projectPath(slug)} variant="accent">
              Back to runs
            </LinkButton>
          ) : (
            <LinkButton to="/" variant="accent">
              Back to projects
            </LinkButton>
          )
        }
      />
    </div>
  );
}
