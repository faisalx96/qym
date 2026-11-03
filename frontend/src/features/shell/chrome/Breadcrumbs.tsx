import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { Project } from '@/api/types';
import { projectPath } from '@/app/routes';
import { useCurrentCrumbLabel } from '@/lib/crumb-label';
import { LIST_PARAM, normalizeContext } from '@/lib/runs-order';
import { Icon } from '@/ui';
import { ProjectSwitcher } from './ProjectSwitcher';
import type { RouteContext } from './nav';
import styles from './Breadcrumbs.module.css';

export interface BreadcrumbsProps {
  route: RouteContext;
  project: Project | null;
}

/**
 * "<project switcher> / Page" or "Runs / <run id>" or "Experiments / Queue";
 * the current item carries aria-current="page".
 */
export function Breadcrumbs({ route, project }: BreadcrumbsProps) {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const pageLabel = useCurrentCrumbLabel();
  const crumbs: { label: string; to?: string; mono?: boolean }[] = [];
  if (project) {
    if (route.page === 'run-detail' && route.runId) {
      // The run id stays the last crumb (owner, C124). Runs goes back to the filtered list the run was opened from.
      const listContext = normalizeContext(params.get(LIST_PARAM));
      crumbs.push(
        { label: 'Runs', to: `${projectPath(project.slug)}${listContext ? `?${listContext}` : ''}` },
        { label: route.runId, mono: true },
      );
    } else if (route.page === 'analyzer' && route.runId) {
      // C212: the way back to Runs and to the run; the run reads by its id, as on the run page (C124)
      crumbs.push(
        { label: 'Runs', to: projectPath(project.slug) },
        { label: route.runId, to: projectPath(project.slug, `runs/${route.runId}`), mono: true },
        { label: 'Auto-analysis' },
      );
    } else if (route.page === 'live-worker') {
      crumbs.push({ label: 'Live', to: projectPath(project.slug, 'live') }, { label: 'Worker' });
    } else if (route.page === 'live-turns' || route.page === 'live-turn') {
      crumbs.push(
        { label: 'Live', to: projectPath(project.slug, 'live') },
        { label: 'Turns', to: projectPath(project.slug, 'live/turns') },
      );
      if (route.page === 'live-turn') crumbs.push({ label: route.turnId ?? 'Turn', mono: true });
    } else if (route.page === 'experiments-queue') {
      crumbs.push({ label: 'Experiments', to: projectPath(project.slug, 'experiments') }, { label: 'Queue' });
    } else if (route.page === 'experiments' && /\/experiments\/[^/]+$/.test(pathname)) {
      const isNew = /\/experiments\/new$/.test(pathname);
      crumbs.push(
        { label: 'Experiments', to: projectPath(project.slug, 'experiments') },
        { label: isNew ? 'New experiment' : pageLabel || 'Experiment' },
      );
    } else if (route.page === 'environments' && /\/environments\/[^/]+/.test(pathname)) {
      const envPath = /\/environments\/([^/]+)/.exec(pathname)![1]!;
      const nested = /\/environments\/[^/]+\/./.test(pathname);
      crumbs.push(
        { label: 'Experiments', to: projectPath(project.slug, 'experiments') },
        { label: 'Environments', to: projectPath(project.slug, 'environments') },
        nested
          ? { label: pageLabel || 'Environment', to: projectPath(project.slug, `environments/${envPath}`) }
          : { label: pageLabel || 'Environment' },
      );
      if (nested) crumbs.push({ label: 'Default preset' });
    } else if (route.page === 'datasets' && params.get('view') === 'deleted') {
      // C233: Datasets is a crumb, so Deleted datasets needs no in-page back link
      crumbs.push(
        { label: 'Datasets', to: projectPath(project.slug, 'datasets') },
        { label: 'Deleted datasets' },
      );
    } else if (route.page === 'datasets' && /\/datasets\/[^/]+/.test(pathname)) {
      crumbs.push(
        { label: 'Datasets', to: projectPath(project.slug, 'datasets') },
        { label: pageLabel || 'Dataset' },
      );
    } else {
      crumbs.push({ label: route.label });
    }
  } else if (route.projectSlug) {
    // No project loaded for this slug (missing, no access, or still loading): "Projects / <slug>" (C209).
    crumbs.push({ label: route.projectSlug, mono: true });
  } else if (route.page === 'feedback' && /^\/feedback\/.+/.test(pathname)) {
    crumbs.push(
      { label: 'Feedback', to: '/feedback' },
      { label: pathname === '/feedback/new' ? 'New feedback' : pageLabel || 'Request' },
    );
  } else {
    crumbs.push({ label: route.label });
  }
  return (
    <nav className={styles.nav} aria-label="Breadcrumb">
      <ol className={styles.list}>
        {project ? (
          <li className={styles.item}>
            <ProjectSwitcher current={project} />
          </li>
        ) : route.page !== 'projects' ? (
          <li className={styles.item}>
            <Link to="/" className={styles.link}>
              Projects
            </Link>
          </li>
        ) : null}
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={styles.item}>
              <Icon name="chevron-right" size={12} className={styles.sep} />
              {c.to && !last ? (
                <Link to={c.to} className={styles.link} data-mono={c.mono ? '' : undefined} dir="auto">
                  {c.label}
                </Link>
              ) : (
                <span
                  className={styles.current}
                  aria-current={last ? 'page' : undefined}
                  data-mono={c.mono ? '' : undefined}
                  dir="auto"
                >
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
