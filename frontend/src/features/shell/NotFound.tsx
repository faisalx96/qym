import { matchPath, useLocation } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { EmptyState, Icon, LinkButton } from '@/ui';
import { constrained } from './layout';

/** C156: '<Thing> not found', one sentence of cause and one link to the parent list. */
export function NotFound() {
  const location = useLocation();
  // Inside a project, the way back is that project's runs, not the projects list (C209).
  const slug = matchPath('/projects/:slug/*', location.pathname)?.params.slug;
  return (
    <div className={constrained} data-not-found>
      <EmptyState
        icon={<Icon name="warning" />}
        title="Page not found"
        body={`Nothing lives at ${location.pathname}. The link may be wrong.`}
        action={
          slug ? (
            <LinkButton to={projectPath(slug)} variant="neutral" icon={<Icon name="prev" size={12} />}>
              Runs
            </LinkButton>
          ) : (
            <LinkButton to="/" variant="neutral" icon={<Icon name="prev" size={12} />}>
              Projects
            </LinkButton>
          )
        }
      />
    </div>
  );
}
