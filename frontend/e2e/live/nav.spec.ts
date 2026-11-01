import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { seedLive } from './support';

test('Live is the second project link and a seeded project opens the overview', async ({ page, request }) => {
  const { projectSlug } = await seedLive(request, uniqueSlug('live-nav'));
  await gotoApp(page, `/projects/${projectSlug}/live`);
  await expect(page.getByRole('heading', { name: 'Live evaluation', exact: true })).toBeVisible();
  await expect(page.locator('[data-live-block="tiles"]')).toBeVisible();
  const projectLinks = page.locator(`[data-nav][href^="/projects/${projectSlug}"]`);
  await expect(projectLinks.nth(0)).toHaveAttribute('data-nav', 'overview');
  await expect(projectLinks.nth(1)).toHaveAttribute('data-nav', 'live');
  await expect(projectLinks.nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/Live · Live evaluation demo/);

  await gotoApp(page, `/projects/${projectSlug}/live/turns`);
  await expect(page.getByRole('heading', { name: 'Turns', exact: true })).toBeVisible();
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByRole('link', { name: 'Live', exact: true })).toBeVisible();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Turns');

  await gotoApp(page, `/projects/${projectSlug}/live/turns/abc/def`);
  await expect(page.getByRole('heading', { name: 'Turn', exact: true })).toBeVisible();
  await expect(crumbs.getByRole('link', { name: 'Turns', exact: true })).toBeVisible();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('abc/def');
  await expect(crumbs.locator('[aria-current="page"]')).toHaveAttribute('data-mono', '');
  await expect(crumbs.locator('[aria-current="page"]')).toHaveAttribute('dir', 'auto');
  await expect(page.locator('[data-nav="live"]')).toHaveAttribute('aria-current', 'page');
});

test('a project without a source shows the live empty state and ingest guide link', async ({
  page,
  request,
}) => {
  const project = await createProject(request, 'Empty live project', uniqueSlug('live-empty'));
  await gotoApp(page, `/projects/${project.slug}/live`);
  await expect(page.getByRole('heading', { name: 'No live source yet' })).toBeVisible();
  await expect(
    page.getByText('A live evaluation worker pushes every production turn here as it is evaluated.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the ingest guide' })).toHaveAttribute(
    'href',
    '/docs/platform-guide/live',
  );
  await expect(page.getByText('Coming in the next task')).toHaveCount(0);
});
