/**
 * Every current dashboard URL (brief 01 §8.1/§8.5) as an app route path
 * (relative to the /app basename). Area agents replace the placeholder
 * elements in router.tsx; the paths here are the contract.
 */
export const ROUTES = {
  login: '/login',
  projects: '/',
  profile: '/profile',
  admin: '/admin',
  adminSplat: '/admin/*',
  trash: '/trash',
  compare: '/compare',
  reviews: '/reviews',
  docs: '/docs-guide',
  docsNew: '/docs/*',
  legacyRun: '/run/*',
  project: '/projects/:slug',
  // children of /projects/:slug
  projectChildren: {
    runs: '',
    overview: 'overview',
    charts: 'charts',
    models: 'models',
    experiments: 'experiments',
    experimentsQueue: 'experiments/queue',
    experimentsSplat: 'experiments/*',
    environments: 'environments/*',
    datasets: 'datasets',
    datasetsSplat: 'datasets/*',
    analysis: 'analysis',
    reviews: 'reviews',
    settings: 'settings',
    runs_detail: 'runs/*',
  },
  devUi: '/__ui',
  devMock: '/__mock/:area/:variant',
} as const;

/** Build project URLs: projectPath('slug', 'settings') → '/projects/slug/settings'. */
export function projectPath(slug: string, sub = ''): string {
  const base = `/projects/${encodeURIComponent(slug)}`;
  return sub ? `${base}/${sub.replace(/^\//, '')}` : base;
}

/** Run ids contain slashes ({run_id:path}); encode each segment. */
export function runPath(slug: string, runId: string): string {
  return projectPath(slug, `runs/${runId.split('/').map(encodeURIComponent).join('/')}`);
}
