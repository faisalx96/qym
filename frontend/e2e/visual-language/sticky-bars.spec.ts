/** Sticky bars (final review F8): the report section bars share --bar-nav-h, the action bars --bar-action-h. */
import { expect, test } from '@playwright/test';
import { compareUrl } from '../compare/support';
import { gotoApp } from '../helpers';
import { runUrl } from '../run-detail/support';
import { seedTour, type Tour } from './support';

let tour: Tour;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  tour = await seedTour();
});
test.use({ viewport: { width: 1440, height: 900 } });

const token = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate((n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)), name);

test('run section nav and compare bar are the same height (--bar-nav-h)', async ({ page }) => {
  await gotoApp(page, runUrl(tour.slug, tour.runId));
  const nav = page.getByRole('navigation', { name: 'Run sections' });
  await expect(nav).toBeVisible();
  const want = await token(page, '--bar-nav-h');
  expect(want).toBe(44);
  const run = (await nav.boundingBox())!.height;
  await gotoApp(page, compareUrl(tour.compareIds));
  const bar = page.locator('[data-compare-sticky]');
  await expect(bar).toBeVisible();
  const cmp = (await bar.boundingBox())!.height;
  expect(run, 'run section nav').toBeGreaterThanOrEqual(want);
  expect(run, 'run section nav').toBeLessThanOrEqual(want + 1);
  expect(cmp, 'compare bar').toBeGreaterThanOrEqual(want);
  expect(cmp, 'compare bar').toBeLessThanOrEqual(want + 1);
});

test('the run items toolbar is at least --bar-action-h', async ({ page }) => {
  await gotoApp(page, runUrl(tour.slug, tour.runId));
  const toolbar = page.locator('[data-run-filters]');
  await expect(toolbar).toBeVisible();
  const want = await token(page, '--bar-action-h');
  expect((await toolbar.boundingBox())!.height).toBeGreaterThanOrEqual(want);
});
