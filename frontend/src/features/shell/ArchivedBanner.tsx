import { Link } from 'react-router-dom';
import type { Project } from '@/api/types';
import { InlineNotice } from '@/ui';
import { useAuth } from './AuthContext';
import styles from './ArchivedBanner.module.css';

/** Read-only notice between the topbar and the page content. */
export function ArchivedBanner({ project }: { project: Project }) {
  const { isAdmin } = useAuth();
  return (
    <InlineNotice
      tone="warning"
      icon="archive"
      lead={`${project.name} is archived and read-only.`}
      className={styles.banner}
      data-archived-banner=""
    >
      {isAdmin ? (
        <>
          <Link to={`/projects/${encodeURIComponent(project.slug)}/settings?tab=danger`}>Unarchive it</Link>{' '}
          to make changes.
        </>
      ) : (
        'Ask an admin to unarchive it to make changes.'
      )}
    </InlineNotice>
  );
}
