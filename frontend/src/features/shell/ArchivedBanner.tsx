import { Link } from 'react-router-dom';
import type { Project } from '@/api/types';
import { Icon } from '@/ui';
import { useAuth } from './AuthContext';
import styles from './ArchivedBanner.module.css';

/** Read-only notice between the topbar and the page content. */
export function ArchivedBanner({ project }: { project: Project }) {
  const { isAdmin } = useAuth();
  return (
    <div className={styles.banner} role="status" data-archived-banner>
      <Icon name="archive" size={14} />
      <span>
        <strong>{project.name}</strong> is archived and read-only.
        {isAdmin ? (
          <>
            {' '}
            <Link to={`/projects/${encodeURIComponent(project.slug)}/settings?tab=danger`}>
              Unarchive it
            </Link>{' '}
            to make changes.
          </>
        ) : (
          ' Ask an admin to unarchive it to make changes.'
        )}
      </span>
    </div>
  );
}
