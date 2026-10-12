/**
 * A slow, superseded search must never replace the results of the current one
 * (cutover of test_performance_views_browser.py::test_slow_old_search_cannot_replace_new_results).
 * The first search request is held until the second search has been answered.
 */
import { test, expect, type Route } from '@playwright/test';
import { itemsCount, openRun, params, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-search-race');
  classic = await seedClassic(s);
});

test('the run page keeps the newest search results when an older request answers last', async ({ page }) => {
  const held: Array<() => Promise<void>> = [];
  await page.route(/\/items\/search/, async (route: Route) => {
    const body = route.request().postDataJSON() as { conditions?: Array<{ value: string }> };
    if (body.conditions?.some((c) => c.value === 'Question 17:')) {
      const response = await route.fetch();
      await new Promise<void>((resolve) => held.push(async () => resolve()));
      await route.fulfill({ response });
    } else await route.continue();
  });
  await openRun(page, s.slug, classic);
  const search = page.getByRole('searchbox', { name: 'Search inputs and outputs' });
  await search.fill('Question 17:');
  await expect.poll(() => held.length).toBe(1);
  await search.fill('Question 18:');
  await expect.poll(() => params(page).get('q')).toBe('Question 18:');
  await expect.poll(async () => itemsCount(page)).toEqual([1, 240]);
  await expect(page.getByRole('button', { name: 'Open item #18', exact: true })).toBeVisible();
  // Now the stale answer arrives.
  await held[0]!();
  await page.waitForTimeout(500);
  expect(await itemsCount(page)).toEqual([1, 240]);
  await expect(page.getByRole('button', { name: 'Open item #18', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open item #17', exact: true })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
