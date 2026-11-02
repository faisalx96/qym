/// <reference lib="dom" />
/**
 * Cutover of test_reviews_queue_browser.py::test_run_sample_tabs_keep_the_chosen_metric_and_report_failures:
 * on a repeat run a slow response of an earlier metric never replaces the chosen metric,
 * and a failed group-metrics load says so with a Retry.
 */
import { test, expect } from '@playwright/test';
import { openRun, seedProject, seedRepeat, type Seeded } from './support';

let s: Seeded;
let repeat: string;

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-repeat');
  repeat = await seedRepeat(s);
});

test('a slow response of an earlier metric never replaces the chosen metric', async ({ page }) => {
  await openRun(page, s.slug, repeat, 'panel=repeat');
  const panel = page.getByTestId('repeat-analysis');
  const select = panel.getByRole('button', { name: /Metric/ }).first();
  const choose = async (name: string) => {
    await select.click();
    await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
  };
  const current = ((await select.innerText()).includes('quality') ? 'quality' : 'correct') as string;
  const otherName = current === 'quality' ? 'correct' : 'quality';
  let delayed = false;
  await page.route(new RegExp(`/group-metrics\\?metric=${otherName}`), async (route) => {
    if (!delayed) {
      delayed = true;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  await choose(otherName);
  await page.waitForTimeout(250);
  await choose(current);
  await page.waitForTimeout(2200); // the slow response has landed by now
  await expect(select).toContainText(current);
  await expect(panel).toContainText('Pass@3');
});

test('a failed group-metrics load says so and Retry loads it', async ({ page }) => {
  let failing = true;
  await page.route(/\/group-metrics\?/, (route) =>
    failing ? route.fulfill({ status: 500, json: { detail: 'boom' } }) : route.continue(),
  );
  await openRun(page, s.slug, repeat, 'panel=repeat');
  const panel = page.getByTestId('repeat-analysis');
  await expect(panel.getByText('Repeat analysis did not load')).toBeVisible({ timeout: 20_000 });
  failing = false;
  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(panel.getByText('Repeat analysis did not load')).toHaveCount(0);
  await expect(panel).toContainText('Pass@3');
});
