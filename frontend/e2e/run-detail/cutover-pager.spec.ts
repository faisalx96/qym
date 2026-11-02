/**
 * Cutover of test_run_page_nav_browser.py: a run that is no longer in the Runs list the reader came from
 * falls back to the default order (its arrows carry no list). (Stepping through the list order, J / K, Back
 * and the one-sided custom range: pager.spec.ts, list-context.spec.ts and lib/__tests__/runs-order.test.ts.
 * A pass cannot be opened from the list's passes panel any more: a FINDING of the cutover report.)
 */
import { test, expect } from '@playwright/test';
import { openRun, seedClassic, seedProject, settleDashboard, type Seeded } from './support';

let s: Seeded;
const runs: string[] = [];

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-pager');
  const small = { items: 12, taskErrors: 1, scorerErrors: 1, retries: 0, notReceived: 0, traced: 1 };
  for (let i = 0; i < 3; i++) runs.push(await seedClassic(s, small));
  settleDashboard();
});

test('a run missing from the list it came from falls back to the default order', async ({ page }) => {
  // no run is FAILED, so none is in this list
  const list = encodeURIComponent('status=FAILED');
  await openRun(page, s.slug, runs[1]!, `list=${list}`);
  const nav = page.getByRole('navigation', { name: 'Previous and next run' });
  await expect(nav).toContainText(/\d+ of 3/);
  for (const name of [/Previous run/, /Next run/]) {
    const link = nav.getByRole('link', { name });
    if ((await link.count()) === 0) continue;
    // the default order's links carry no list context
    expect(await link.getAttribute('href')).not.toContain('list=');
  }
});
