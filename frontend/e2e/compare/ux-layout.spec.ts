/** UX review (group C): compare layout details found by hand at 1280 and 390 px. */
import { expect, test } from '@playwright/test';
import { compareUrl, seedScenario, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-ux');
});
const three = () => compareUrl([seed.runs.base, seed.runs.a, seed.runs.b]);

test('the analytics caption wraps inside the scroll region instead of being cut off', async ({ page }) => {
  await page.goto(three());
  await waitLoaded(page);
  const scroller = page.getByLabel('Metrics table');
  const caption = scroller.locator('caption');
  await expect(caption).toBeVisible();
  const [s, c] = await Promise.all([scroller.boundingBox(), caption.boundingBox()]);
  expect(c!.x + c!.width).toBeLessThanOrEqual(s!.x + s!.width + 1);
  // it stays put while the table scrolls sideways
  await scroller.evaluate((e) => (e.scrollLeft = 120));
  const moved = await caption.boundingBox();
  expect(Math.abs(moved!.x - c!.x)).toBeLessThan(2);
});

test('no empty block between the page header and the run chips', async ({ page }) => {
  await page.goto(three());
  await waitLoaded(page);
  const empty = await page
    .getByTestId('compare-page')
    .locator('> *')
    .evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height === 0).map((e) => e.className));
  expect(empty).toEqual([]);
});

test('phone width: per-run deltas get their own row and the chip bar does not stay stuck', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(three());
  await waitLoaded(page);
  const first = page.locator('li[data-column]').first();
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const list = page.locator('ul', { has: first });
  expect((await list.boundingBox())!.width).toBeGreaterThan(250);
  const position = await page
    .getByTestId('compare-page')
    .locator('> div')
    .filter({ has: page.getByRole('combobox').or(page.getByRole('button', { name: /^quality/ })) })
    .first()
    .evaluate((e) => getComputedStyle(e).position);
  expect(position).toBe('static');
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
