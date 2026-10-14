/** Motion rules: marks grow in once, reduced motion removes every animation, nothing replays on re-render. */
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { runUrl } from '../run-detail/support';
import { seedTour, settled, type Tour } from './support';

let tour: Tour;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  tour = await seedTour();
});

const grown = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => /grow|rise|arrive|dot-in|gauge/.test((a as CSSAnimation).animationName ?? '')).length,
  );

test('data marks animate on first paint and settle (motion allowed)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(runUrl(tour.slug, tour.runId));
  await expect(page.getByTestId('items-count')).toBeVisible();
  await expect.poll(() => grown(page), { timeout: 5_000 }).toBeGreaterThan(0);
  await settled(page);
  expect(await grown(page)).toBe(0);
});

test('reduced motion: no data-mark animation runs and entrances end immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(runUrl(tour.slug, tour.runId));
  await expect(page.getByTestId('items-count')).toBeVisible();
  await settled(page);
  const running = await page.evaluate(
    () =>
      document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming();
        return ((t?.duration as number) ?? 0) > 1 || ((t?.delay as number) ?? 0) > 0;
      }).length,
  );
  expect(running).toBe(0);
  // a transition-bearing element has a ~0 duration under the global rule
  const dur = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-report-section] [class*="fill"], [class*="bar"]',
    ) as HTMLElement | null;
    return el ? getComputedStyle(el).transitionDuration : '0s';
  });
  expect(parseFloat(dur.split(',')[0]!)).toBeLessThan(0.01);
});

test('a filter change does not replay the entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await gotoApp(page, runUrl(tour.slug, tour.runId));
  await expect(page.getByTestId('items-count')).toBeVisible();
  await settled(page);
  await page
    .getByRole('button', { name: /Filters/ })
    .first()
    .click();
  await settled(page);
  expect(await grown(page)).toBe(0);
});
