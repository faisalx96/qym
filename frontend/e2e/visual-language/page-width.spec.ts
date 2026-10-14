/** One page width (final review F14): constrained pages use --page-max-w, the same width the report pages fill. */
import { expect, test } from '@playwright/test';
import { gotoApp } from '../helpers';
import { seedTour, settled, type Tour } from './support';

let tour: Tour;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  tour = await seedTour();
});
test.use({ viewport: { width: 1440, height: 900 } });

test('overview, models, settings and projects are as wide as the runs page at 1440px', async ({ page }) => {
  const width = async (path: string, selector: string) => {
    await gotoApp(page, path);
    const el = page.locator(selector).first();
    await expect(el).toBeVisible();
    await settled(page);
    return Math.round((await el.boundingBox())!.width);
  };
  const runs = await width(`/projects/${tour.slug}`, '[data-testid="runs-page"]');
  expect(runs).toBeGreaterThan(1100);
  for (const [name, path, selector] of [
    ['overview', `/projects/${tour.slug}/overview`, '[data-testid="overview-page"]'],
    ['models', `/projects/${tour.slug}/models`, '[data-models-page]'],
    ['settings', `/projects/${tour.slug}/settings`, '[data-settings-page]'],
    ['projects', '/', '[data-projects-page]'],
  ] as const) {
    const w = await width(path, selector);
    expect(Math.abs(w - runs), `${name} ${w}px vs runs ${runs}px`).toBeLessThanOrEqual(2);
  }
  // the token itself
  const max = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--page-max-w'),
  );
  expect(max.trim()).toBe('1233px');
});

test('the profile page asks for the narrow container', async ({ page }) => {
  await gotoApp(page, '/profile');
  const el = page.locator('[data-profile-page]');
  await expect(el).toBeVisible();
  expect((await el.boundingBox())!.width).toBeLessThanOrEqual(1120);
});
