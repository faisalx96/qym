/** Sticky bars (final review F8): the report section bars share --bar-nav-h, the action bars --bar-action-h. */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl } from '../compare/support';
import { gotoApp } from '../helpers';
import { runUrl } from '../run-detail/support';
import { createLaunchAreas, seedTour, type AreasWorld, type Tour } from './support';

let tour: Tour;
let areas: AreasWorld;
test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  tour = await seedTour();
  areas = await createLaunchAreas(request);
});
test.use({ viewport: { width: 1440, height: 900 } });

const token = (page: Page, name: string) =>
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

test('the run items toolbar is one --bar-action-h row (wide)', async ({ page }) => {
  await gotoApp(page, runUrl(tour.slug, tour.runId));
  const toolbar = page.locator('[data-run-filters]');
  await expect(toolbar).toBeVisible();
  const want = await token(page, '--bar-action-h');
  expect(want).toBe(56);
  const h = (await toolbar.boundingBox())!.height;
  expect(h).toBeGreaterThanOrEqual(want);
  expect(h).toBeLessThanOrEqual(want + 1);
});

test('the items toolbar stays one row with active filters and keeps Clear reachable', async ({ page }) => {
  await gotoApp(page, runUrl(tour.slug, tour.runId));
  const toolbar = page.locator('[data-run-filters]');
  await expect(toolbar).toBeVisible();
  await page.locator('button[data-bucket]').nth(5).click();
  const clear = page.getByTestId('clear-filters');
  await expect(clear).toBeVisible();
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(
    (await token(page, '--bar-action-h')) + 1,
  );
  await clear.click();
  await expect(clear).toHaveCount(0);
});

test('the experiment home launch bar is one --bar-action-h row (wide)', async ({ page }) => {
  await gotoApp(page, `/projects/${areas.slug}/experiments/new?env=${areas.envId}`);
  const bar = page.getByRole('region', { name: 'Launch' });
  await expect(bar).toBeVisible();
  const want = await token(page, '--bar-action-h');
  const h = (await bar.boundingBox())!.height;
  expect(h).toBeGreaterThanOrEqual(want);
  expect(h).toBeLessThanOrEqual(want + 1);
});
