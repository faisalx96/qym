import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { useProject, isNoAccess, isNotFound } from '@/api/projects';
import { KEYS, writeLocal } from '@/lib/storage';
import { useDelayedPending } from '@/lib/pending';
import { Skeleton } from '@/ui';
import { useAuth } from './AuthContext';
import { ProjectContext, type ProjectValue } from './ProjectContext';
import { ProjectNotFound } from './ProjectNotFound';
import { ArchivedBanner } from './ArchivedBanner';
import { constrained } from './layout';

/** Pages where the archived banner shows (shell.js ARCHIVED_NOTICE_PAGES). */
const ARCHIVED_NOTICE =
  /^(|overview|charts|models|datasets(\/.*)?|settings|runs\/.*|experiments(\/.*)?|environments(\/.*)?)$/;
/** Pages an archived project does not have (server 404s them). */
const ARCHIVED_HIDDEN = /^(analysis|reviews)$/;

/**
 * Resolves the project from me.projects or GET /v1/projects/by-slug; provides
 * readOnly for archived projects; renders the Not Found / Access Denied panel.
 */
export function ProjectLayout() {
  const { slug = '' } = useParams();
  const { me, isAdmin } = useAuth();
  const query = useProject(slug, me);
  const location = useLocation();
  const showSkeleton = useDelayedPending(query.isPending);
  const sub = location.pathname.replace(/^.*?\/projects\/[^/]+\/?/, '').replace(/\/$/, '');

  useEffect(() => {
    if (query.data?.is_active) writeLocal(KEYS.lastProjectSlug, slug);
  }, [query.data, slug]);

  const value = useMemo<ProjectValue | null>(() => {
    if (!query.data) return null;
    const p = query.data;
    return { project: p, slug, readOnly: !p.is_active, canManage: isAdmin || p.role === 'MANAGER', isAdmin };
  }, [query.data, slug, isAdmin]);

  if (query.isPending) {
    return showSkeleton ? (
      <div className={constrained} aria-busy="true">
        <Skeleton kind="lines" rows={5} label="Loading project" />
      </div>
    ) : null;
  }
  if (query.isError || !value) {
    const kind = isNoAccess(query.error) ? 'forbidden' : isNotFound(query.error) ? 'not_found' : 'error';
    return <ProjectNotFound slug={slug} kind={kind} error={query.error} onRetry={() => query.refetch()} />;
  }
  if (value.readOnly && ARCHIVED_HIDDEN.test(sub)) {
    return <ProjectNotFound slug={slug} kind="not_found" archived />;
  }
  return (
    <ProjectContext.Provider value={value}>
      {value.readOnly && ARCHIVED_NOTICE.test(sub) ? <ArchivedBanner project={value.project} /> : null}
      <Outlet />
    </ProjectContext.Provider>
  );
}
