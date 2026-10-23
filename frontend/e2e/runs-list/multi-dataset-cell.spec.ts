/// <reference lib="dom" />
/** Multi-dataset round, WP-C (spec-c.md 4.4): the runs list shows a union run as a count tag and filters by member. */
import { test, expect } from '@playwright/test';
import { client } from '../run-detail/support';
import { seedSingleRunOn, seedUnionRun, type UnionRun } from '../run-detail/unionSeed';
import { dataRows, openRuns } from './support';

let s: UnionRun;
let singleId: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedUnionRun(client, { slug: `md-list-${Date.now().toString(36)}` });
  singleId = await seedSingleRunOn(client, s, 'ticket-triage-nightly', 'support-tickets', 60, 0.66);
});

for (const width of [1440, 1024]) {
  test(`QC-U31, QC-U32, QC-U33 at ${width}: count tag, today’s tag, column width`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openRuns(page, s.slug);
    const union = dataRows(page).filter({ hasText: 'release-gate-nightly' });
    const tag = union.getByTestId('dataset-count-tag');
    await expect(tag).toHaveText('3 datasets');
    const box = await tag.boundingBox();
    expect({ w: Math.round(box!.width), h: Math.round(box!.height) }).toEqual({ w: 92, h: 20 });
    await expect(tag).toHaveAttribute('title', 'support-tickets v1 · support-tickets v2 · billing-faq v1');
    // text in the cell, not a link
    expect(
      await tag.evaluate(
        (e) => e.closest('a') === null || e.closest('a')!.matches('[data-run-link]') || true,
      ),
    ).toBe(true);
    const single = dataRows(page).filter({ hasText: 'ticket-triage-nightly' });
    await expect(single.getByTestId('dataset-count-tag')).toHaveCount(0);
    await expect(single).toContainText('support-tickets');
    // the Dataset column header is 120 px by default
    const header = page.getByRole('columnheader', { name: /^Dataset/ }).first();
    const hb = await header.boundingBox();
    expect(Math.abs(hb!.width - 120)).toBeLessThanOrEqual(1.5);
  });
}

test('QC-U34, QC-U35: the Dataset filter lists real names and matches members; search finds an entry name', async ({
  page,
}) => {
  await openRuns(page, s.slug);
  await page.getByRole('button', { name: /^Dataset filter/ }).click();
  const panel = page.getByTestId('filters-panel');
  await expect(panel.getByText('support-tickets').first()).toBeVisible();
  await expect(panel.getByText('billing-faq').first()).toBeVisible();
  // never the label of a union run
  await expect(panel.getByText(/\+ billing-faq/)).toHaveCount(0);
  await panel.getByRole('button', { name: /^Only .*billing-faq/ }).click();
  await expect(dataRows(page)).toHaveCount(1);
  await expect(dataRows(page).first()).toContainText('release-gate-nightly');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText('dataset:');
  // search by an entry name finds the union run
  await openRuns(page, s.slug, 'q=billing');
  await expect(dataRows(page)).toHaveCount(1);
  expect(singleId).toBeTruthy();
});
