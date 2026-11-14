/**
 * Cutover of test_metric_semantics_browser.py (compare): a metric without a declared direction is shown
 * neutrally on Compare (no winners, no pass or fail tags, no threshold) and says why. (Lower is better
 * picking the lowest value as best: src/features/compare/lib/__tests__/cutover-semantics.test.ts.)
 */
import { test, expect } from '@playwright/test';
import { seedCustomRun, type CustomItem } from '../run-detail/cutover-support';
import { seedProject, type Seeded } from '../run-detail/support';
import { compareUrl, itemPane, paneOutputs, waitLoaded, goSection } from './support';

let s: Seeded;
test.beforeAll(async () => {
  s = await seedProject('cmp-cutover-direction');
});

const items = (value: number): CustomItem[] =>
  Array.from({ length: 6 }, (_, i) => ({
    id: `item-${i}`,
    input: `question ${i}`,
    scores: { accuracy: { score: i % 2 ? value : 0.5 } },
  }));

test('without a direction Compare is neutral and says why', async ({ page }) => {
  const spec = { score_type: 'percentage', schema_version: 2 };
  const a = await seedCustomRun(s, { name: 'neutral-a', specs: { accuracy: spec }, items: items(0.2) });
  const b = await seedCustomRun(s, { name: 'neutral-b', specs: { accuracy: spec }, items: items(0.9) });
  await page.goto(compareUrl([a, b]));
  await waitLoaded(page);
  await goSection(page, 'Overview');
  await expect(
    page.getByText('Winners, passes and Max@K need a declared direction on this metric.'),
  ).toBeVisible();
  await page.locator('[data-part="item-head"]').first().click();
  // the item pane: without a direction no output has a verdict (no Pass or Fail tag, the neutral tone)
  const pane = itemPane(page);
  await expect(paneOutputs(pane)).toHaveCount(2);
  for (const out of await paneOutputs(pane).all()) {
    await expect(out).toHaveAttribute('data-tone', 'neutral');
    await expect(out.locator('header')).not.toContainText(/Pass|Fail/i);
  }
  await expect(pane.locator('[data-count="failed"]')).toHaveCount(0);
  await expect(page.getByRole('slider', { name: /threshold/i })).toHaveCount(0);
});
