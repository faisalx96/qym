import { EmptyState, ErrorState, Icon, LinkButton } from '@/ui';
import { constrained } from './layout';

export interface ProjectNotFoundProps {
  slug: string;
  kind: 'not_found' | 'forbidden' | 'error';
  archived?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/** One panel for "no such project", "no access" and "archived page". */
export function ProjectNotFound({ slug, kind, archived, error, onRetry }: ProjectNotFoundProps) {
  if (kind === 'error') {
    return (
      <div className={constrained}>
        <ErrorState error={error} title="Couldn’t load this project" onRetry={onRetry} />
      </div>
    );
  }
  const forbidden = kind === 'forbidden';
  return (
    <div className={constrained} data-project-not-found={forbidden ? 'forbidden' : 'not_found'}>
      <EmptyState
        icon={<Icon name={forbidden ? 'shield' : 'folder'} />}
        title={
          forbidden
            ? 'Access denied'
            : archived
              ? 'Not available for an archived project'
              : 'Project not found'
        }
        body={
          forbidden
            ? `You are not a member of “${slug}”. Ask a project manager or an admin for access.`
            : archived
              ? 'Auto-analysis and Reviews exist to change things; an archived project is read-only.'
              : `The project “${slug}” does not exist, is archived, or you no longer have access to it.`
        }
        action={
          archived ? (
            <LinkButton to={`/projects/${encodeURIComponent(slug)}`} variant="accent">
              Open the project’s runs
            </LinkButton>
          ) : (
            <LinkButton to="/" variant="accent">
              All projects
            </LinkButton>
          )
        }
      />
    </div>
  );
}
