/** Items table on DataTable: windowed rows, keyboard across the window, deep link into a long page, narrow cards. */
import { test, expect, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  itemsCount,
  openRun,
  seedClassic,
  seedProject,
  type Seeded,
} from './support';

let s: Seeded;
let big: string;

test.beforeAll(async () => {
  s = await seedProject('rd-virtual');
  big = await seedClassic(s, { items: 1200, traced: 5 });
});

const rows = (page: Page) => page.locator('tbody tr[data-item-id]');

async function bigPage(page: Page, query = '') {
  await page.addInitScript(() => localStorage.setItem('qym:run-page-size', '500'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, big, query);
  expect((await itemsCount(page))[1]).toBe(1200);
}

test('a 500-row page mounts only the visible window and keeps the full height', async ({ page }) => {
  await bigPage(page);
  await expect(rows(page).first()).toBeVisible();
  expect(await rows(page).count()).toBeLessThan(60);
  const grid = page.getByRole('treegrid', { name: 'Items' });
  await expect(grid).toHaveAttribute('aria-rowcount', '501');
  const height = await grid.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(500 * 40);
});

test('scrolling brings later rows in and unmounts the first ones', async ({ page }) => {
  await bigPage(page);
  await expect(rows(page).first()).toBeVisible();
  await page.evaluate(() => {
    const host = document.getElementById('shell-content')!;
    const grid = document.querySelector('[role=treegrid][aria-label=Items]')!;
    host.scrollTop += grid.getBoundingClientRect().top - host.getBoundingClientRect().top + 400 * 52;
  });
  await expect(page.locator('tbody tr[data-item-id="item-0400"]')).toHaveCount(1);
  await expect(page.locator('tbody tr[data-item-id="item-0001"]')).toHaveCount(0);
  expect(await rows(page).count()).toBeLessThan(80);
});

test('?item= far down the page lands on its row, expanded', async ({ page }) => {
  await bigPage(page, 'item=item-0450');
  const card = page.locator('[data-testid=item-card][data-item-id="item-0450"]');
  await expect(card).toBeVisible();
  await expect(card).toBeInViewport();
});

test('ArrowDown walks the rows across the window edge and End reaches the last row', async ({ page }) => {
  await bigPage(page);
  await rows(page).first().focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-item-id')))
    .toBe('item-0041');
  await page.keyboard.press('End');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-item-id')))
    .toBe('item-0500');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-testid=item-card][data-item-id="item-0500"]')).toBeVisible();
});

test('390px: items are cards and a card opens its item', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRun(page, s.slug, big);
  const card = page.locator('li[data-item-id]').first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^Open item #/ }).click();
  await expect(page.locator('[data-testid=item-card]').first()).toBeVisible();
  const violations = await axeSeriousViolations(page, '#shell-content');
  expect(violations, describeViolations(violations)).toEqual([]);
});
