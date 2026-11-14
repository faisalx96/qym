/**
 * Redesign 2, items, on the item pane: an item of an Arabic multi-pass JSON run. The pane stays inside the viewport
 * with one pass in view, the block titles stay at the left of right-to-left text, a JSON value is a list of fields with
 * a raw JSON switch for its own block, and the details of a metric open under the metric over the full table width.
 *
 * The old item view expanded in the table (three pass columns side by side, one collapsed row for each JSON key, a
 * metric matrix with a detail panel). Those tests are deleted or written again for the pane.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  itemPane,
  metricTable,
  openMetric,
  openRun,
  paneBlock,
  seedArabic,
  seedClassic,
  seedProject,
  type Seeded,
} from './support';

let s: Seeded;
let arabic: string;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-r2-items');
  arabic = await seedArabic(s);
  classic = await seedClassic(s, { items: 24 });
});

/**
 * Open the item of row n (0-based) in the pane. A row is a `tr[data-item-id]`; below 640 px the rows are cards
 * (`li[data-item-id]`), so the locator takes both.
 */
async function openNth(page: Page, n: number): Promise<Locator> {
  await page.locator('#run-items').scrollIntoViewIfNeeded();
  const rows = page.locator('#run-items [data-item-id]');
  await expect(rows.first()).toBeVisible();
  await rows.nth(n).click();
  const pane = itemPane(page);
  await expect(pane).toBeVisible();
  // the blocks arrive after the item texts load
  await expect(paneBlock(pane, 'input')).toBeVisible();
  return pane;
}

/** The key of a field in a JSON value of the pane (a `<dt>`; a table or a group adds a count after the name). */
function fieldKey(block: Locator, key: string): Locator {
  return block.locator('dt[data-part="key"]').filter({ hasText: new RegExp(`^${key}`) });
}

for (const width of [1280, 1440]) {
  test(`the pane of an Arabic multi-pass item stays inside the viewport at ${width}px, one pass in view`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRun(page, s.slug, arabic);
    const pane = await openNth(page, 0);
    const box = (await pane.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    // one output at a time: the pass switch of the Output block picks the pass (3 passes in this run)
    const outputs = pane.getByRole('region', { name: /^Output of pass \d+$/ });
    await expect(outputs).toHaveCount(1);
    const out = (await outputs.boundingBox())!;
    expect(out.x + out.width).toBeLessThanOrEqual(width);
    const passes = pane.getByRole('radiogroup', { name: 'Pass in view' });
    await expect(passes.getByRole('radio')).toHaveCount(3);
    // each pass has its own score column in the Metrics table, and the table is inside the pane
    await expect(metricTable(pane).getByRole('button', { name: /^Pass \d/ })).toHaveCount(3);
    const table = (await metricTable(pane).boundingBox())!;
    expect(table.x + table.width).toBeLessThanOrEqual(box.x + box.width + 1);
  });
}

test('an Arabic input keeps its block title at the left; the text reads right to left', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, arabic);
  // item 2 has a plain Arabic prose input
  const pane = await openNth(page, 1);
  const input = paneBlock(pane, 'input');
  await expect(input).not.toHaveAttribute('dir', 'rtl');
  const block = (await input.boundingBox())!;
  const title = (await input.getByRole('heading', { name: 'Input', exact: true }).boundingBox())!;
  // the title is at the start (left) edge of the block: it does not move to the far edge for right-to-left text
  expect(title.x - block.x).toBeLessThan(40);
  const text = input.locator('[data-rtl]').first();
  await expect(text).toBeVisible();
  expect(await text.evaluate((e) => getComputedStyle(e).direction)).toBe('rtl');
  const t = (await text.boundingBox())!;
  expect(t.x + t.width).toBeLessThanOrEqual(block.x + block.width + 1);
});

test('an RTL value keeps its key at the left, in the same column as the LTR keys', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, arabic);
  // item 1 has a JSON Expected: { answer: Arabic text, topics: ['ml', 'dl'] }
  const pane = await openNth(page, 0);
  const expected = paneBlock(pane, 'expected');
  const answer = fieldKey(expected, 'answer');
  const topics = fieldKey(expected, 'topics');
  await expect(answer).toBeVisible();
  const a = (await answer.boundingBox())!;
  const t = (await topics.boundingBox())!;
  // same left edge for the key of the RTL value and the LTR key: right-to-left text takes its own line
  expect(Math.abs(a.x - t.x)).toBeLessThan(4);
  // the key itself is not mirrored; only the value text runs right to left
  await expect(answer).not.toHaveAttribute('dir', 'rtl');
  await expect(expected.locator('[data-rtl], [dir="rtl"]').first()).toBeVisible();
});

test('a JSON output is a list of fields; the raw JSON switch changes its own block only', async ({
  page,
}) => {
  await openRun(page, s.slug, arabic, 'pass=1');
  const pane = await openNth(page, 0);
  const out = paneBlock(pane, 'output');
  for (const key of ['answer', 'reasoning', 'citations', 'confidence', 'sql', 'followups'])
    await expect(fieldKey(out, key)).toBeVisible();
  // the raw view keeps the whole payload
  await out.getByRole('button', { name: 'Show the raw JSON', exact: true }).click();
  await expect(out.locator('pre[data-lang="json"]')).toContainText('"citations"');
  await expect(out.locator('dt[data-part="key"]')).toHaveCount(0);
  // Expected is a JSON value too: its block keeps the fields
  const expected = paneBlock(pane, 'expected');
  await expect(fieldKey(expected, 'answer')).toBeVisible();
  await expect(expected.locator('pre[data-lang="json"]')).toHaveCount(0);
  await out.getByRole('button', { name: 'Show the fields', exact: true }).click();
  await expect(fieldKey(out, 'answer')).toBeVisible();
});

test('the details of a metric are closed at first and open under the metric over the full table width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  const pane = await openNth(page, 0);
  const table = metricTable(pane);
  await expect(table).toBeVisible();
  // closed until the reader opens them
  await expect(pane.locator('[data-part="metric-details"]')).toHaveCount(0);
  const grid = (await table.boundingBox())!;
  // item 1: the quality judge recorded judge_model and confidence beside the reason
  const details = await openMetric(pane, 'quality');
  const d = (await details.boundingBox())!;
  expect(d.width).toBeGreaterThan(grid.width * 0.9);
  await expect(details.locator('dt[data-part="key"]').filter({ hasText: /^confidence$/ })).toBeVisible();
  // a second metric opens beside the first one: each metric has its own switch
  await openMetric(pane, 'hallucination');
  await expect(pane.locator('[data-part="metric-details"]')).toHaveCount(2);
  // the header switch closes them all
  await table.getByRole('button', { name: 'Hide the details of every metric', exact: true }).click();
  await expect(pane.locator('[data-part="metric-details"]')).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`the pane of an Arabic item has no serious axe violations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRun(page, s.slug, arabic);
    await openNth(page, 0);
    const violations = await axeSeriousViolations(page, '[data-testid=item-pane]');
    const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad, describeViolations(bad)).toEqual([]);
  });
}

for (const width of [1280, 1440]) {
  test(`an RTL value in an output field keeps its key at the left at ${width}px; the text stays in the block`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openRun(page, s.slug, arabic, 'pass=1');
    const pane = await openNth(page, 0);
    const out = paneBlock(pane, 'output');
    const box = (await out.boundingBox())!;
    const key = (await fieldKey(out, 'answer').boundingBox())!;
    expect(key.x - box.x).toBeLessThan(40);
    // the value text reads right to left inside its own block
    const text = out.locator('[data-rtl]').first();
    await expect(text).toBeVisible();
    const t = (await text.boundingBox())!;
    expect(t.x + t.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(t.x).toBeGreaterThanOrEqual(box.x - 1);
  });
}
