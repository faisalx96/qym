/// <reference lib="dom" />
/** Multi-dataset round, WP-C (spec-c.md 4.5): compare shows a union run next to a single-dataset run. */
import { test, expect } from '@playwright/test';
import { client } from '../run-detail/support';
import { seedSingleRunOn, seedUnionRun, type UnionRun } from '../run-detail/unionSeed';
import { compareUrl } from './support';

let s: UnionRun;
let singleId: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedUnionRun(client, { slug: `md-cmp-${Date.now().toString(36)}` });
  singleId = await seedSingleRunOn(client, s, 'ticket-triage-nightly', 'support-tickets', 412, 0.661);
});

for (const width of [1440, 1024, 390]) {
  test(`QC-U37, QC-U38 at ${width}: dataset facts and the notice`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(compareUrl([s.runId, singleId]));
    await expect(page.getByTestId('run-details')).toBeVisible();
    const cards = page.getByTestId('run-details').locator('li');
    await expect(cards.first().locator('dt', { hasText: /^Datasets$/ })).toBeVisible();
    await expect(cards.first()).toContainText('3 datasets');
    await expect(cards.nth(1).locator('dt', { hasText: /^Dataset$/ })).toBeVisible();
    const notice = page.getByTestId('compare-datasets-notice');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toContainText('The runs evaluated different datasets');
    await expect(notice).toContainText(
      'Run A evaluated 3 datasets and run B evaluated 1. Items are matched by dataset and item id, so the two runs share',
    );
    await expect(notice).toContainText('the metric averages below are still comparable as run means');
    // the generic "different data" note does not repeat it
    await expect(page.locator('[data-notice="different-data"]')).toHaveCount(0);
  });
}

test('QC-U40: What differs lists the datasets', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(compareUrl([s.runId, singleId]));
  await expect(page.getByTestId('run-details')).toBeVisible();
  await page
    .getByText(/\d+ settings?/)
    .first()
    .click();
  await expect(page.getByTestId('run-details')).toContainText('datasets');
  await expect(page.getByTestId('run-details')).toContainText('3 datasets');
  await expect(page.getByTestId('run-details')).toContainText('support-tickets v1');
});

test('QC-U39: two runs over the same dataset set show no notice', async ({ page }) => {
  // the same three dataset versions (by name and version label), evaluated again in another project
  const other = await seedUnionRun(client, { slug: `md-cmp2-${Date.now().toString(36)}`, name: 'again' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(compareUrl([s.runId, other.runId]));
  await expect(page.getByTestId('compare-page')).toBeVisible();
  await expect(page.getByTestId('compare-datasets-notice')).toHaveCount(0);
});
