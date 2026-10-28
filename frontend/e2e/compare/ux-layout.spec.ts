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
  const grid = page.getByRole('table', { name: 'Per-run averages' });
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

test('the sticky nav is 36px tall and stays stuck while the report scrolls', async ({ page }) => {
  await page.goto(three());
  await waitLoaded(page);
  const bar = page.locator('[data-compare-sticky]');
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(37);
  await page.getByTestId('item-list').scrollIntoViewIfNeeded();
  await expect(bar).toBeInViewport();
  expect(await bar.evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
});

test('phone width: the nav stays one 36px row, no sideways page scroll, averages become one block per metric', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(three());
  await waitLoaded(page);
  const bar = page.locator('[data-compare-sticky]');
  expect(await bar.evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(37);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // averages: one block per metric (correct, quality, latency, errors), one line per run, baseline first
  const blocks = page.locator('[data-part="averages-table"] section[data-row]');
  await expect(blocks).toHaveCount(4);
  const lines = blocks.first().locator('[data-part="averages-cell"]');
  await expect(lines).toHaveCount(3);
  await expect(lines.first()).toContainText('baseline');
});

test('cohorts of different sizes explain themselves instead of asking for a selection', async ({ page }) => {
  const { base, a, b } = seed.runs;
  await page.goto(`/compare?cohortA=${base}&cohortA=${a}&cohortB=${b}`);
  await expect(page.getByText('The two sides do not match')).toBeVisible();
  await expect(page.getByText(/2 on side A and 1 on side B/)).toBeVisible();
});
