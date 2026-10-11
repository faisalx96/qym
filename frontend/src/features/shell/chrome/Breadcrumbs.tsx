import { Link } from 'react-router-dom';
import type { Project } from '@/api/types';
import { projectPath } from '@/app/routes';
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
  const crumbs: { label: string; to?: string; mono?: boolean }[] = [];
  if (project) {
    if (route.page === 'run-detail' && route.runId) {
      crumbs.push({ label: 'Runs', to: projectPath(project.slug) }, { label: route.runId, mono: true });
    } else if (route.page === 'analyzer' && route.runId) {
      crumbs.push({ label: route.runId, to: projectPath(project.slug, `runs/${route.runId}`), mono: true }, { label: 'Auto-analysis' });
    } else if (route.page === 'experiments-queue') {
      crumbs.push({ label: 'Experiments', to: projectPath(project.slug, 'experiments') }, { label: 'Queue' });
    } else {
      crumbs.push({ label: route.label });
    }
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
                <Link to={c.to} className={styles.link} data-mono={c.mono ? '' : undefined}>
                  {c.label}
                </Link>
              ) : (
                <span className={styles.current} aria-current={last ? 'page' : undefined} data-mono={c.mono ? '' : undefined}>
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
