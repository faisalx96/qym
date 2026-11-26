import { test, expect } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { seedPerformance, startRun } from './support';

test('Performance sits directly after Live, every page opens and the crumbs lead back', async ({
  page,
  request,
}) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-nav'));
  const slug = seed.projectSlug;
  const run = await startRun(request, slug, {
    target_id: seed.preprod.id,
    dataset_version_id: seed.dataset.versionId,
  });

  await gotoApp(page, `/projects/${slug}/performance`);
  await expect(page.getByRole('heading', { name: 'Performance', exact: true })).toBeVisible();
  const projectLinks = page.locator(`[data-nav][href^="/projects/${slug}"]`);
  await expect(projectLinks.nth(1)).toHaveAttribute('data-nav', 'live');
  await expect(projectLinks.nth(2)).toHaveAttribute('data-nav', 'performance');
  await expect(projectLinks.nth(2)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/^Performance · QA - Performance/);

  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  const pages: [string, string, string][] = [
    ['new', 'New run', 'New run'],
    ['runner', 'Runner', 'Runner'],
    ['targets', 'Targets', 'Targets'],
    [`runs/${run.id}`, `Run ${run.number}`, `Run ${run.number}`],
  ];
  for (const [sub, heading, crumb] of pages) {
    await gotoApp(page, `/projects/${slug}/performance/${sub}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(crumbs.getByRole('link', { name: 'Performance', exact: true })).toBeVisible();
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(crumb);
    await expect(page.locator('[data-nav="performance"]')).toHaveAttribute('aria-current', 'page');
  }

  await crumbs.getByRole('link', { name: 'Performance', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${slug}/performance$`));
  await expect(page.getByRole('heading', { name: 'Performance', exact: true })).toBeVisible();

  // The sidebar item opens the area from another page of the project.
  await gotoApp(page, `/projects/${slug}/live`);
  await page.locator('[data-nav="performance"]').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${slug}/performance$`));
});
