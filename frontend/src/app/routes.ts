/**
 * Every current dashboard URL (brief 01 §8.1/§8.5) as an app route path
 * (relative to the router basename = the platform root path). Area agents replace the placeholder
 * elements in router.tsx; the paths here are the contract.
 */
export const ADMIN_TABS = ['runs', 'projects', 'users', 'maintenance', 'feedback'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const ROUTES = {
  login: '/login',
  projects: '/',
  profile: '/profile',
  admin: '/admin',
  adminTab: '/admin/:tab',
  adminSplat: '/admin/*',
  trash: '/trash',
  feedback: '/feedback',
  feedbackNew: '/feedback/new',
  feedbackItem: '/feedback/:ref',
  compare: '/compare',
  reviews: '/reviews',
  docs: '/docs-guide',
  docsIndex: '/docs',
  docsPage: '/docs/:section/:page',
  docsNew: '/docs/*',
  legacyRun: '/run/*',
  projectsIndex: '/projects',
  project: '/projects/:slug',
  // children of /projects/:slug
  projectChildren: {
    runs: '',
    /** A run URL trimmed to `runs`: redirects to the list. */
    runsTrimmed: 'runs',
    overview: 'overview',
    live: 'live',
    liveTurns: 'live/turns',
    liveWorker: 'live/worker',
    liveTurn: 'live/turns/*',
    performance: 'performance',
    performanceNew: 'performance/new',
    /** A run URL trimmed to `performance/runs`: redirects to the area's home. */
    performanceRunsTrimmed: 'performance/runs',
    performanceRun: 'performance/runs/:runId',
    performanceRunner: 'performance/runner',
    performanceTargets: 'performance/targets',
    charts: 'charts',
    models: 'models',
    experiments: 'experiments',
    experimentsQueue: 'experiments/queue',
    experimentsSplat: 'experiments/*',
    environments: 'environments/*',
    datasets: 'datasets',
    datasetsSplat: 'datasets/*',
    analysis: 'analysis',
    compare: 'compare',
    reviews: 'reviews',
    bookmarks: 'bookmarks',
    bookmarksSplat: 'bookmarks/*',
    factory: 'factory',
    factorySplat: 'factory/*',
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

/** The Performance area: performancePath('slug') is its home, performancePath('slug', 'new') the New run page. */
export function performancePath(slug: string, sub: '' | 'new' | 'runner' | 'targets' = ''): string {
  return projectPath(slug, sub ? `performance/${sub}` : 'performance');
}

/** One performance run's page. The id is the run's id, not its running number. */
export function performanceRunPath(slug: string, runId: string): string {
  return projectPath(slug, `performance/runs/${encodeURIComponent(runId)}`);
}
