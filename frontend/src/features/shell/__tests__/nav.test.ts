import { describe, expect, it } from 'vitest';
import { isNavActive, parseRoute, projectNav } from '../chrome/nav';
import { initials } from '../chrome/UserMenu';
import { slugify } from '../dialogs/CreateProjectDialog';
import { wordDiff } from '../settings/PromptsTab';

describe('parseRoute', () => {
  it('reads project pages and run ids with slashes', () => {
    expect(parseRoute('/projects/demo')).toMatchObject({ page: 'runs', projectSlug: 'demo' });
    expect(parseRoute('/projects/demo/settings')).toMatchObject({ page: 'settings', label: 'Settings' });
    expect(parseRoute('/projects/demo/runs/a/b/c')).toMatchObject({ page: 'run-detail', runId: 'a/b/c' });
    expect(parseRoute('/projects/demo/runs/a%2Fb/analyzer')).toMatchObject({ page: 'analyzer', runId: 'a/b' });
    expect(parseRoute('/projects/demo/experiments/queue')).toMatchObject({ page: 'experiments-queue' });
    expect(parseRoute('/projects/demo/datasets/x/y')).toMatchObject({ page: 'datasets' });
    expect(parseRoute('/')).toMatchObject({ page: 'projects' });
    expect(parseRoute('/run/x/y')).toMatchObject({ page: 'run-detail', runId: 'x/y', projectSlug: null });
    expect(parseRoute('/docs-guide')).toMatchObject({ page: 'docs' });
    expect(parseRoute('/trash')).toMatchObject({ page: 'trash', label: 'Deleted runs' });
  });
  it('maps child routes onto parent nav items', () => {
    const nav = projectNav('demo');
    const runs = nav.find((n) => n.id === 'runs')!;
    expect(isNavActive(runs, 'run-detail')).toBe(true);
    expect(isNavActive(nav.find((n) => n.id === 'experiments')!, 'experiments-queue')).toBe(true);
    expect(isNavActive(nav.find((n) => n.id === 'analysis')!, 'analyzer')).toBe(true);
    expect(isNavActive(runs, 'charts')).toBe(false);
  });
});

describe('helpers', () => {
  it('initials and slugs', () => {
    expect(initials('Meshari Aldossari', 'm@x.y')).toBe('MA');
    expect(initials('', 'dev@local')).toBe('DL');
    expect(slugify('Customer Support Bot!')).toBe('customer-support-bot');
  });
  it('word diff marks additions and deletions', () => {
    const d = wordDiff('a b c', 'a x c');
    expect(d.filter((p) => p.kind === 'del').map((p) => p.text)).toEqual(['b']);
    expect(d.filter((p) => p.kind === 'add').map((p) => p.text)).toEqual(['x']);
  });
});
