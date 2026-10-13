/** The item-by-item list is a DataTable matrix: a header per run (baseline marked), score cells, expansion, widths, axe. */
import { expect, test, type Page } from '@playwright/test';
import { axeSeriousViolations } from '../shell/support';
import { compareUrl, itemDetail, seedScenario, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-matrix');
});

const open4 = async (page: Page) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
};
const table = (page: Page) => page.getByRole('treegrid', { name: 'Items across the compared runs' });

test('one column per run with the baseline marked, and a score cell per run', async ({ page }) => {
  await open4(page);
  const grid = table(page);
  await expect(grid).toBeVisible();
  const heads = grid.getByRole('columnheader');
  for (const letter of ['A', 'B', 'C', 'D'])
    await expect(heads.filter({ hasText: new RegExp(`^${letter}`) })).toHaveCount(1);
  await expect(heads.filter({ hasText: /^A/ })).toContainText('★');
  await expect(heads.filter({ hasText: /^B/ })).not.toContainText('★');
  const first = page.getByTestId('item-row').first();
  // every run cell speaks its letter and verdict for assistive tech
  await expect(first.locator('td span[title]')).toHaveCount(4);
});

test('a score cell renders a bar for a rate metric', async ({ page }) => {
  await open4(page);
  const bars = page
    .getByTestId('item-row')
    .first()
    .locator('td [data-band], td [data-empty], td [data-error]');
  expect(await bars.count()).toBeGreaterThan(0);
});

test('expanding a row opens a sibling detail row with the output cards; the row reports aria-expanded', async ({
  page,
}) => {
  await open4(page);
  const row = page.locator('[data-testid="item-row"][data-item-id="cmp-001"]');
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const detail = itemDetail(page, 'cmp-001');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('output-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Collapse item 1' }).click();
  await expect(detail).toHaveCount(0);
});

for (const width of [390, 1280, 1920]) {
  test(`at ${width}px the matrix never widens the page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open4(page);
    await page.locator('[data-testid="item-row"][data-item-id="cmp-001"]').click();
    await expect(itemDetail(page, 'cmp-001').getByTestId('output-card')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByTestId('item-row').first()).toBeVisible();
    // the expanded item reads at the visible width, not the width of the scrolling score columns
    const box = await itemDetail(page, 'cmp-001').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
  });
}

test('axe: the matrix with an expanded row has no serious violations', async ({ page }) => {
  await open4(page);
  await page.locator('[data-testid="item-row"][data-item-id="cmp-001"]').click();
  await expect(itemDetail(page, 'cmp-001').getByTestId('output-card')).toHaveCount(4);
  expect(await axeSeriousViolations(page, '[data-testid="compare-page"]')).toEqual([]);
});
