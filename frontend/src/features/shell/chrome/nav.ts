import type { IconName } from '@/ui';
import { projectPath } from '@/app/routes';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  to: string;
  /** Hidden for archived projects (they exist to change things). */
  hiddenWhenArchived?: boolean;
  /** Only for global admins. */
  adminOnly?: boolean;
  /** Route ids that highlight this item (shell.js parent mapping). */
  activeFor?: string[];
}

export const GLOBAL_NAV: NavItem[] = [
  { id: 'projects', label: 'Projects', icon: 'folder', to: '/' },
  { id: 'docs', label: 'Docs', icon: 'book', to: '/docs-guide' },
];

export function projectNav(slug: string): NavItem[] {
  return [
    { id: 'overview', label: 'Dashboard', icon: 'home', to: projectPath(slug, 'overview') },
    { id: 'charts', label: 'Charts', icon: 'chart', to: projectPath(slug, 'charts') },
    { id: 'runs', label: 'Runs', icon: 'list', to: projectPath(slug), activeFor: ['run-detail', 'compare'] },
    { id: 'models', label: 'Models', icon: 'grid', to: projectPath(slug, 'models') },
    {
      id: 'experiments',
      label: 'Experiments',
      icon: 'flask',
      to: projectPath(slug, 'experiments'),
      activeFor: ['experiments-queue', 'environments'],
    },
    {
      id: 'analysis',
      label: 'Auto-analysis',
      icon: 'sparkles',
      to: projectPath(slug, 'analysis'),
      hiddenWhenArchived: true,
      activeFor: ['analyzer'],
    },
    {
      id: 'reviews',
      label: 'Reviews',
      icon: 'review',
      to: projectPath(slug, 'reviews'),
      hiddenWhenArchived: true,
    },
    { id: 'datasets', label: 'Datasets', icon: 'database', to: projectPath(slug, 'datasets') },
    { id: 'settings', label: 'Project settings', icon: 'settings', to: projectPath(slug, 'settings') },
  ];
}

export const PLATFORM_NAV: NavItem[] = [
  { id: 'admin', label: 'Admin', icon: 'shield', to: '/admin', adminOnly: true },
  { id: 'trash', label: 'Deleted runs', icon: 'trash', to: '/trash', adminOnly: true },
];

export interface RouteContext {
  /** Route id used for the active nav item and breadcrumbs. */
  page: string;
  projectSlug: string | null;
  runId: string | null;
  /** Human label of the current page (breadcrumb tail). */
  label: string;
}

const PAGE_LABELS: Record<string, string> = {
  projects: 'Projects',
  profile: 'Profile',
  admin: 'Admin',
  trash: 'Deleted runs',
  compare: 'Compare',
  reviews: 'Reviews',
  docs: 'Docs',
  runs: 'Runs',
  overview: 'Dashboard',
  charts: 'Charts',
  models: 'Models',
  experiments: 'Experiments',
  'experiments-queue': 'Queue',
  environments: 'Environments',
  datasets: 'Datasets',
  analysis: 'Auto-analysis',
  analyzer: 'Auto-analysis',
  settings: 'Settings',
  'run-detail': 'Run',
  'not-found': 'Not found',
};

/** Parse an app-relative pathname (no root-path prefix) into the shell's route context. */
export function parseRoute(pathname: string): RouteContext {
  const path = pathname.replace(/\/+$/, '') || '/';
  const project = /^\/projects\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (project) {
    const slug = decodeURIComponent(project[1]!);
    const rest = project[2] ?? '';
    let page = 'runs';
    let runId: string | null = null;
    if (rest.startsWith('runs/')) {
      const tail = rest.slice(5);
      if (/\/analyzer$/.test(tail)) {
        page = 'analyzer';
        runId = decodeURIComponent(tail.replace(/\/analyzer$/, ''));
      } else {
        page = 'run-detail';
        runId = decodeURIComponent(tail);
      }
    } else if (rest === 'experiments/queue') page = 'experiments-queue';
    else if (rest.startsWith('experiments')) page = 'experiments';
    else if (rest.startsWith('environments')) page = 'environments';
    else if (rest.startsWith('datasets')) page = 'datasets';
    else if (rest) page = rest.split('/')[0]!;
    return { page, projectSlug: slug, runId, label: PAGE_LABELS[page] ?? page };
  }
  if (path === '/') return { page: 'projects', projectSlug: null, runId: null, label: 'Projects' };
  const run = /^\/run\/(.+?)(\/analyzer)?$/.exec(path);
  if (run)
    return {
      page: run[2] ? 'analyzer' : 'run-detail',
      projectSlug: null,
      runId: decodeURIComponent(run[1]!),
      label: 'Run',
    };
  const head = path.split('/')[1] ?? '';
  const page = head === 'docs-guide' || head === 'docs' ? 'docs' : head || 'not-found';
  return { page, projectSlug: null, runId: null, label: PAGE_LABELS[page] ?? 'Not found' };
}

export function isNavActive(item: NavItem, page: string): boolean {
  return item.id === page || Boolean(item.activeFor?.includes(page));
}
