import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The project switcher needs the signed-in user; these tests read only the crumbs after it.
vi.mock('../chrome/ProjectSwitcher', () => ({
  ProjectSwitcher: () => createElement('span', null, 'switcher'),
}));
// The layout test needs one archived project and no server.
vi.mock('../AuthContext', () => ({ useAuth: () => ({ me: null, isAdmin: false }) }));
vi.mock('../ArchivedBanner', () => ({
  ArchivedBanner: () => createElement('p', { role: 'status' }, 'archived notice'),
}));
vi.mock('@/api/projects', () => ({
  useProject: (slug: string) => ({
    data: { slug, name: 'QA - Archived', is_active: false, role: 'MANAGER' },
    isPending: false,
    isError: false,
  }),
  isNoAccess: () => false,
  isNotFound: () => false,
}));
import { ROUTES, performancePath, performanceRunPath } from '@/app/routes';
import { useCrumbLabel } from '@/lib/crumb-label';
import { Breadcrumbs } from '../chrome/Breadcrumbs';
import { isNavActive, parseRoute, projectNav } from '../chrome/nav';
import { ProjectLayout } from '../ProjectLayout';

const PAGES = [
  'performance',
  'performance-new',
  'performance-run',
  'performance-runner',
  'performance-targets',
];

describe('Performance project navigation', () => {
  it.each([
    ['/projects/p/performance', 'performance', 'Performance'],
    ['/projects/p/performance/', 'performance', 'Performance'],
    ['/projects/p/performance/new', 'performance-new', 'New run'],
    ['/projects/p/performance/runs/7d3b6c1e', 'performance-run', 'Run'],
    ['/projects/p/performance/runner', 'performance-runner', 'Runner'],
    ['/projects/p/performance/targets', 'performance-targets', 'Targets'],
    // A run URL trimmed to its list belongs to the area's home.
    ['/projects/p/performance/runs', 'performance', 'Performance'],
  ])('parses %s without using runId', (path, page, label) => {
    expect(parseRoute(path)).toEqual({ page, projectSlug: 'p', runId: null, label });
  });

  it('puts Performance directly after Live and keeps it active for its pages, including archived projects', () => {
    const nav = projectNav('p');
    expect(nav.map((item) => item.id).slice(0, 4)).toEqual(['overview', 'live', 'performance', 'charts']);
    const item = nav[2]!;
    expect(item).toMatchObject({
      id: 'performance',
      label: 'Performance',
      icon: 'zap',
      to: '/projects/p/performance',
      activeFor: ['performance-new', 'performance-run', 'performance-runner', 'performance-targets'],
    });
    expect(item.hiddenWhenArchived).not.toBe(true);
    expect(item.adminOnly).not.toBe(true);
    for (const page of PAGES) expect(isNavActive(item, page)).toBe(true);
    for (const page of ['live', 'runs', 'run-detail', 'charts']) expect(isNavActive(item, page)).toBe(false);
    // A performance run is not one of the project's evaluation runs.
    const runs = nav.find((entry) => entry.id === 'runs')!;
    const live = nav.find((entry) => entry.id === 'live')!;
    for (const page of PAGES) {
      expect(isNavActive(runs, page)).toBe(false);
      expect(isNavActive(live, page)).toBe(false);
    }
  });

  it('builds the area’s addresses', () => {
    expect(performancePath('a b')).toBe('/projects/a%20b/performance');
    expect(performancePath('p', 'new')).toBe('/projects/p/performance/new');
    expect(performancePath('p', 'runner')).toBe('/projects/p/performance/runner');
    expect(performancePath('p', 'targets')).toBe('/projects/p/performance/targets');
    expect(performanceRunPath('p', 'run/1')).toBe('/projects/p/performance/runs/run%2F1');
    expect(parseRoute(performanceRunPath('p', 'run/1')).page).toBe('performance-run');
    expect(ROUTES.projectChildren).toMatchObject({
      performance: 'performance',
      performanceNew: 'performance/new',
      performanceRunsTrimmed: 'performance/runs',
      performanceRun: 'performance/runs/:runId',
      performanceRunner: 'performance/runner',
      performanceTargets: 'performance/targets',
    });
  });
});

describe('Performance breadcrumbs', () => {
  const project = { slug: 'demo', name: 'Demo', is_active: true } as unknown as Parameters<
    typeof Breadcrumbs
  >[0]['project'];

  function crumbs(path: string, published?: string) {
    const Publish = () => {
      useCrumbLabel(published);
      return null;
    };
    render(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Publish),
        createElement(Breadcrumbs, { route: parseRoute(path), project }),
      ),
    );
    return screen.getByRole('navigation', { name: 'Breadcrumb' });
  }

  it('shows the home as the current page, with no link to itself', () => {
    const nav = crumbs('/projects/demo/performance');
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Performance');
    expect(screen.queryByRole('link', { name: 'Performance' })).toBeNull();
  });

  it.each([
    ['/projects/demo/performance/new', 'New run'],
    ['/projects/demo/performance/runner', 'Runner'],
    ['/projects/demo/performance/targets', 'Targets'],
    ['/projects/demo/performance/runs/7d3b6c1e', 'Run'],
  ])('links %s back to Performance', (path, last) => {
    const nav = crumbs(path);
    expect(screen.getByRole('link', { name: 'Performance' })).toHaveAttribute(
      'href',
      '/projects/demo/performance',
    );
    const current = nav.querySelector('[aria-current="page"]');
    expect(current).toHaveTextContent(last);
    expect(current).not.toHaveAttribute('data-mono');
  });

  it('names a run by the number its page publishes, not by its id', () => {
    const nav = crumbs('/projects/demo/performance/runs/7d3b6c1e', 'Run 24');
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Run 24');
    expect(nav).not.toHaveTextContent('7d3b6c1e');
  });

  it('does not take another page’s published name for its fixed crumbs', () => {
    const nav = crumbs('/projects/demo/performance/targets', 'Something else');
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Targets');
  });
});

describe('Performance in an archived project', () => {
  it.each([
    'performance',
    'performance/new',
    'performance/runs/7d3b6c1e',
    'performance/runner',
    'performance/targets',
  ])('shows the archived notice on %s', (sub) => {
    render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/projects/demo/${sub}`] },
        createElement(
          Routes,
          null,
          createElement(
            Route,
            { path: '/projects/:slug', element: createElement(ProjectLayout) },
            createElement(Route, { path: '*', element: createElement('p', null, 'page body') }),
          ),
        ),
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent('archived notice');
    expect(screen.getByText('page body')).toBeInTheDocument();
  });
});
