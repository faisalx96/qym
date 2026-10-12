/**
 * Cutover of test_run_page_render_browser.py / test_run_page_structure_browser.py (C028 / C064 / C065):
 * what the reader keeps while the page changes under them. Typing in the search box never empties the
 * list or moves the box, an empty score bar is not a filter, and a run with many metrics never scrolls
 * the page sideways. (The repeat-analysis metric switcher of a run with many metrics overflows its panel:
 * a FINDING of the cutover report.)
 */
import { test, expect } from '@playwright/test';
import { PERCENT, seedCustomRun, type CustomItem } from './cutover-support';
import { itemsCount, openRun, seedProject, seedClassic, type Seeded } from './support';

let s: Seeded;

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-layout');
});

test('typing in the search box never empties the list or moves the box', async ({ page }) => {
  const id = await seedClassic(s, {
    items: 120,
    taskErrors: 2,
    scorerErrors: 2,
    retries: 0,
    notReceived: 0,
    traced: 0,
  });
  await openRun(page, s.slug, id);
  const search = page.getByRole('searchbox', { name: 'Search inputs and outputs' });
  const before = await search.boundingBox();
  // count the moments at which the table body holds no row while the search answers
  await page.evaluate(() => {
    const w = window as unknown as { __empty: number };
    w.__empty = 0;
    new MutationObserver(() => {
      const rows = document.querySelectorAll(
        '[role=row] [role=cell], [role=row] button[aria-label^="Open item"]',
      );
      if (!rows.length) w.__empty += 1;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await search.fill('Question 1');
  await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(120);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __empty: number }).__empty)).toBe(0);
  const after = await search.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
});

test('an empty score bar is not a filter; a bar with items is', async ({ page }) => {
  // scores fall in two clusters (0.05 and 0.95): the middle bars hold no item
  const items: CustomItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: `item-${i}`,
    input: `q${i}`,
    scores: { accuracy: { score: i % 2 ? 0.05 : 0.95 } },
  }));
  const id = await seedCustomRun(s, { name: 'two-clusters', specs: { accuracy: PERCENT }, items });
  await openRun(page, s.slug, id);
  const bars = page.getByRole('group', { name: 'accuracy score distribution' });
  await expect(bars).toBeVisible();
  const before = await itemsCount(page);
  const empty = bars.locator('[data-empty=true]');
  expect(await empty.count()).toBe(9);
  // empty bars are no controls
  await expect(bars.getByRole('button', { name: /no items/ })).toHaveCount(0);
  await empty.nth(3).click({ force: true });
  await page.waitForTimeout(300);
  expect(await itemsCount(page)).toEqual(before);
  await expect(page.getByTestId('metric-card').first()).toBeVisible();
  // a bar with items still filters
  await bars.getByRole('button', { name: /^0%: 5 items/ }).click();
  await expect.poll(async () => (await itemsCount(page))[0]).toBe(5);
});

test('many metrics never scroll the page sideways', async ({ page }) => {
  const names = Array.from(
    { length: 22 },
    (_, k) => `metric_${String.fromCharCode(97 + k)}_${k % 2 ? 'quality' : 'grounding'}`,
  );
  const specs = Object.fromEntries(names.map((n) => [n, PERCENT]));
  const scores = Object.fromEntries(names.map((n, k) => [n, { score: 0.3 + (k % 5) / 10 }]));
  const id = await seedCustomRun(s, {
    name: 'many-metrics',
    specs,
    items: Array.from({ length: 12 }, (_, i) => ({
      id: `item-${i}`,
      input: `question ${i} about something`,
      scores,
    })),
  });
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await openRun(page, s.slug, id);
    const overflow = await page.evaluate(() => {
      const host = document.getElementById('shell-content') ?? document.documentElement;
      return host.scrollWidth - host.clientWidth;
    });
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    // the displayed (first) metric stays among the shown columns and the input stays readable
    await expect(page.getByRole('columnheader', { name: new RegExp(names[0]!) }).first()).toBeVisible();
    const input = await page
      .getByRole('cell', { name: /^question 0 about/ })
      .first()
      .boundingBox();
    expect(input?.width ?? 0).toBeGreaterThanOrEqual(130);
  }
});
