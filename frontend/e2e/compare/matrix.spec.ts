/** The item-by-item list (round 8): a card per item, one self-describing chip per run, a run key above, expansion, widths, axe. */
import { expect, test, type Page } from '@playwright/test';
import { axeSeriousViolations } from '../shell/support';
import { compareUrl, itemDetail, itemHead, seedScenario, waitLoaded } from './support';
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
const list = (page: Page) => page.getByRole('list', { name: 'Items across the compared runs' });

test('a run key names every run once, the baseline marked, and a chip per run sits on each row', async ({
  page,
}) => {
  await open4(page);
  const key = page.locator('[data-part="run-key"]');
  await expect(key).toBeVisible();
  await expect(key.locator('[data-part="run-name"]')).toHaveCount(4);
  await expect(key.locator('[data-part="run-letter"]')).toHaveText(['A', 'B', 'C', 'D']);
  await expect(key.locator('[data-part="baseline-tag"]')).toHaveCount(1);
  await expect(key.locator('[data-part="run-name"]').first()).toContainText('baseline-gpt-mini');
  const first = page.getByTestId('item-row').first();
  // every chip carries its swatch, letter and value, and speaks its verdict for assistive tech
  const chips = first.locator('[data-part="item-score-chip"]');
  await expect(chips).toHaveCount(4);
  await expect(chips.nth(1)).toContainText('B');
  await expect(chips.nth(1)).toContainText('81.2%');
});

test('a chip is coloured by the score band; a task error is its own red shape', async ({ page }) => {
  await open4(page);
  const chips = page.getByTestId('item-row').first().locator('[data-part="item-score-chip"]');
  for (let i = 0; i < 4; i++) await expect(chips.nth(i)).toHaveAttribute('data-band', /^[1-5]$/);
  const errored = page.getByTestId('item-row').and(page.locator('[data-error]')).first();
  await expect(errored).toBeVisible();
  const chip = errored.locator('[data-part="item-score-chip"][data-state="error"]').first();
  await expect(chip).toContainText('task error');
});

test('expanding a row opens its detail inside the card; the head reports aria-expanded', async ({ page }) => {
  await open4(page);
  const head = itemHead(page, 'cmp-001');
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  const detail = itemDetail(page, 'cmp-001');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('output-card')).toHaveCount(4);
  await head.click();
  await expect(detail).toHaveCount(0);
});

for (const width of [390, 1280, 1920]) {
  test(`at ${width}px the list never widens the page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open4(page);
    await itemHead(page, 'cmp-001').click();
    await expect(itemDetail(page, 'cmp-001').getByTestId('output-card')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByTestId('item-row').first()).toBeVisible();
    const box = await itemDetail(page, 'cmp-001').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
  });
}

test('axe: the list with an expanded row has no serious violations', async ({ page }) => {
  await open4(page);
  await itemHead(page, 'cmp-001').click();
  await expect(itemDetail(page, 'cmp-001').getByTestId('output-card')).toHaveCount(4);
  expect(await axeSeriousViolations(page, '[data-testid="compare-page"]')).toEqual([]);
});

test('the run key is part of the list head: it scrolls with the page and is never covered (1440)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open4(page);
  const key = page.locator('[data-part="run-key"]');
  expect(await key.evaluate((el) => getComputedStyle(el).position)).not.toBe('sticky');
  await key.scrollIntoViewIfNeeded();
  await expect(key).toBeInViewport();
  const covered = await key.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
    return !(hit && el.contains(hit));
  });
  expect(covered, 'run key covered by the sticky nav').toBe(false);
});

test('at 390px each row stacks its chips under the title and names the runs by letter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open4(page);
  await expect(list(page)).toBeVisible();
  const first = list(page).getByRole('listitem').first();
  await expect(first.locator('[data-part="item-score-chip"]')).toHaveCount(4);
  await expect(first).toContainText('A');
  await expect(first).toContainText('B');
});
