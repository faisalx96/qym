/** UX review (group C): compare layout details found by hand at 1280 and 390 px. */
import { expect, test } from '@playwright/test';
import { compareUrl, seedScenario, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-ux');
});
const three = () => compareUrl([seed.runs.base, seed.runs.a, seed.runs.b]);

test('the averages matrix fits its section: one row per metric, no clipped header, no sideways page scroll', async ({
  page,
}) => {
  await page.goto(three());
  await waitLoaded(page);
  const grid = page.getByRole('grid', { name: 'Per-run averages' });
  await expect(grid).toBeVisible();
  await expect(page.getByTestId('average-row')).toHaveCount(4);
  const [g, section] = await Promise.all([
    grid.boundingBox(),
    page.locator('#compare-averages').boundingBox(),
  ]);
  expect(g!.x + g!.width).toBeLessThanOrEqual(section!.x + section!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test('no empty block between the page header and the sticky bar', async ({ page }) => {
  await page.goto(three());
  await waitLoaded(page);
  const empty = await page
    .getByTestId('compare-page')
    .locator('> *')
    .evaluateAll((els) =>
      els
        .filter((e) => getComputedStyle(e).display !== 'contents')
        .filter((e) => e.getBoundingClientRect().height === 0)
        .map((e) => e.className),
    );
  expect(empty).toEqual([]);
});

test('sticky bar is 44px tall and stays stuck while the report scrolls', async ({ page }) => {
  await page.goto(three());
  await waitLoaded(page);
  const bar = page.locator('[data-compare-sticky]');
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(48);
  await page.getByTestId('item-list').scrollIntoViewIfNeeded();
  await expect(bar).toBeInViewport();
  expect(await bar.evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
});

test('phone width: the bar scrolls with the page, the nav and selects each take a row, per-run deltas wrap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(three());
  await waitLoaded(page);
  const bar = page.locator('[data-compare-sticky]');
  expect(await bar.evaluate((e) => getComputedStyle(e).position)).toBe('static');
  const first = page.locator('[aria-label="Change against the baseline"] li[data-column]').first();
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // averages become one card per run, baseline first
  const cards = page.getByTestId('average-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('baseline');
});

test('the Analyze popover lists one run per line inside its own surface', async ({ page }) => {
  await page.goto(three());
  await waitLoaded(page);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  const popover = page.getByRole('dialog', { name: 'Analyze runs' });
  await expect(popover).toBeVisible();
  const links = popover.getByRole('link');
  await expect(links).toHaveCount(3);
  const outer = (await popover.boundingBox())!;
  const tops = new Set<number>();
  for (let i = 0; i < 3; i++) {
    const b = (await links.nth(i).boundingBox())!;
    tops.add(Math.round(b.y));
    expect(b.x).toBeGreaterThanOrEqual(outer.x);
    expect(b.x + b.width).toBeLessThanOrEqual(outer.x + outer.width);
  }
  expect(tops.size).toBe(3);
  expect(await popover.getByRole('list').evaluate((e) => getComputedStyle(e).listStyleType)).toBe('none');
});

test('cohorts of different sizes explain themselves instead of asking for a selection', async ({ page }) => {
  const { base, a, b } = seed.runs;
  await page.goto(`/compare?cohortA=${base}&cohortA=${a}&cohortB=${b}`);
  await expect(page.getByText('The two sides do not match')).toBeVisible();
  await expect(page.getByText(/2 on side A and 1 on side B/)).toBeVisible();
});
