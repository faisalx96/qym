/**
 * Cutover of test_metric_semantics_browser.py (compare): a metric without a declared direction is shown
 * neutrally on Compare (no winners, no pass or fail tags, no threshold) and says why. (Lower is better
 * picking the lowest value as best: src/features/compare/lib/__tests__/cutover-semantics.test.ts.)
 */
import { test, expect } from '@playwright/test';
import { seedCustomRun, type CustomItem } from '../run-detail/cutover-support';
import { seedProject, type Seeded } from '../run-detail/support';
import { compareUrl, waitLoaded } from './support';

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
  await page.getByRole('tab', { name: /^Overview/ }).click();
  await expect(
    page.getByText('Winners, passes and Max@K need a declared direction on this metric.'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /^Item 2:/ })
    .first()
    .click();
  await expect(page.getByText(/✓ PASS|✗ FAIL/)).toHaveCount(0);
  await expect(page.getByRole('slider', { name: /threshold/i })).toHaveCount(0);
});
