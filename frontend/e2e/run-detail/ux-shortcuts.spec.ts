/** UX review (group C): the single-key opt-out (WCAG 2.1.4) also covers J / K on the run page and "/" in the trace drawer. */
import { test, expect } from '@playwright/test';
import { openRun, seedClassic, seedProject, settleDashboard, type Seeded } from './support';

let s: Seeded;
let runs: string[] = [];
const small = { items: 12, taskErrors: 1, scorerErrors: 1, retries: 0, notReceived: 0, traced: 2 };

test.beforeAll(async () => {
  s = await seedProject('rd-ux-keys');
  runs = [await seedClassic(s, small), await seedClassic(s, small)];
  settleDashboard();
});

const pager = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Previous and next run' });

test('J and K do nothing once single-key shortcuts are switched off', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('qym:single-key-shortcuts', 'off'));
  await openRun(page, s.slug, runs[0]!);
  await expect(pager(page)).toContainText(/of 2/);
  const url = page.url();
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await page.waitForTimeout(600);
  expect(page.url()).toBe(url);
});

test('J still steps to the neighbouring run when the shortcuts are on', async ({ page }) => {
  await openRun(page, s.slug, runs[0]!);
  await expect(pager(page)).toContainText(/\d of 2/);
  const first = await pager(page).textContent();
  const url = page.url();
  await page.keyboard.press(first?.includes('1 of 2') ? 'j' : 'k');
  await expect(page).not.toHaveURL(url);
});

test('"/" in the trace drawer only focuses the span filter while the shortcuts are on', async ({ page }) => {
  await openRun(page, s.slug, runs[0]!);
  await page.getByRole('button', { name: 'Open trace of item #1', exact: true }).first().click();
  const filter = page.getByPlaceholder(/Filter spans/);
  await expect(filter).toBeVisible();
  await page.getByRole('button', { name: 'Expand all' }).focus();
  await page.keyboard.press('/');
  await expect(filter).toBeFocused();
  await page.evaluate(() => localStorage.setItem('qym:single-key-shortcuts', 'off'));
  await page.getByRole('button', { name: 'Expand all' }).focus();
  await page.keyboard.press('/');
  await expect(filter).not.toBeFocused();
});
