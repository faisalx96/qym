/**
 * Redesign 2, items: expanded item on an Arabic multi-pass JSON run. The detail stays inside the visible scroller
 * (detailFit), labels sit next to their text, JSON becomes per-key sections, an opened metric reads at the full width,
 * pass columns carry an accent and a labelled Trace button.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  openRun,
  seedArabic,
  seedClassic,
  seedProject,
  showItems,
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

async function expandFirst(page: Page) {
  await showItems(page);
  const grid = page.getByRole('treegrid', { name: /Items|by item/ });
  if (await grid.count()) await grid.locator('tr[data-row-key]').first().click();
  else await page.getByRole('button', { name: /^Open item #1$/ }).click();
  await expect(page.getByTestId('item-card').first()).toBeVisible();
}

for (const width of [1280, 1440]) {
  test(`the expanded Arabic item stays inside the visible table at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRun(page, s.slug, arabic);
    await expandFirst(page);
    const hold = page.locator('[data-detail-hold]').first();
    await expect(hold).toBeVisible();
    const box = await hold.boundingBox();
    const scroller = await page.locator('[data-dt-scroller]').first().boundingBox();
    expect(box && scroller).toBeTruthy();
    expect(box!.x + box!.width).toBeLessThanOrEqual(scroller!.x + scroller!.width + 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    // all three pass columns are inside the viewport
    const cols = page.locator('section[aria-label=Output] [data-pass]');
    await expect(cols).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const c = await cols.nth(i).boundingBox();
      expect(c!.x + c!.width).toBeLessThanOrEqual(width);
    }
  });
}

test('an Arabic input keeps its label at the left, next to its text (round 3 P5: labels never move)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, arabic);
  // item 2 has a plain Arabic prose input
  await showItems(page);
  await page
    .getByRole('treegrid', { name: /Items|by item/ })
    .locator('tr[data-row-key]')
    .nth(1)
    .click();
  const row = page.getByTestId('item-card').getByRole('group', { name: 'Input', exact: true }).first();
  await expect(row).toHaveAttribute('dir', 'ltr');
  const label = await row.locator('> div').first().boundingBox();
  const text = await row.locator('[data-kind="input"]').boundingBox();
  // the label is at the left and the text begins within a column gap of it; the text measure is capped (76ch)
  expect(label!.x).toBeLessThan(text!.x);
  expect(text!.x - (label!.x + label!.width)).toBeLessThan(40);
  expect(text!.width).toBeLessThan(760);
  await expect(row.locator('[dir="rtl"]').first()).toBeVisible();
});

test('an RTL value keeps its key header left-anchored in the same column as the LTR keys', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, arabic);
  await expandFirst(page);
  const expected = page.getByTestId('item-card').getByRole('group', { name: 'Expected', exact: true });
  const answer = expected.getByRole('group', { name: 'answer', exact: true });
  const topics = expected.getByRole('group', { name: 'topics', exact: true });
  await expect(answer).toBeVisible();
  const a = await answer.getByRole('button').first().boundingBox();
  const t = await topics.getByRole('button').first().boundingBox();
  // same left edge for the RTL value's key and the LTR key: the header never jumps to the far edge
  expect(Math.abs(a!.x - t!.x)).toBeLessThan(4);
  // the section itself is not mirrored; only the value text runs right to left inside its column
  await expect(answer).not.toHaveAttribute('dir', 'rtl');
  const text = answer.locator('[dir="rtl"]').first();
  await expect(text).toBeVisible();
});

test('JSON output is one collapsed row per key, with a Raw view (round 3 P5)', async ({ page }) => {
  await openRun(page, s.slug, arabic, 'pass=1');
  await expandFirst(page);
  const out = page.getByRole('region', { name: 'Output', exact: true }).first();
  for (const key of ['answer', 'reasoning', 'citations', 'confidence', 'sql', 'followups'])
    await expect(out.getByRole('button', { name: new RegExp(`^${key}`) })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  // open a key
  const answer = out.getByRole('button', { name: /^answer/ });
  await answer.click();
  await expect(answer).toHaveAttribute('aria-expanded', 'true');
  // Raw keeps the whole payload
  await out.getByRole('radio', { name: 'Raw' }).click({ force: true });
  await expect(out).toContainText('"citations"');
  await out.getByRole('radio', { name: 'Sections' }).click({ force: true });
});

test('an opened metric reads at the full width under the matrix, one at a time (round 3 P5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await expandFirst(page);
  const card = page.getByTestId('item-card');
  const grid = card.getByRole('grid', { name: 'Metrics by pass' });
  const matrix = await grid.boundingBox();
  const cells = grid.getByRole('button', { name: /^[a-z_]+, pass \d+:/ });
  expect(await cells.count()).toBeGreaterThan(0);
  await cells.first().click();
  const panel = card.locator('section[data-metric]').first();
  await expect(panel).toBeVisible();
  const p = await panel.boundingBox();
  expect(p!.width).toBeGreaterThan(matrix!.width * 0.9);
  if ((await cells.count()) > 1) {
    await cells.nth(1).click();
    await expect(card.getByTestId('metric-detail')).toHaveCount(1);
  }
});

test('pass columns carry no colour of their own, a labelled Trace button and no fills (round 3 P5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, arabic);
  await expandFirst(page);
  const cols = page.locator('section[aria-label=Output] [data-pass]');
  const colors = await cols.evaluateAll((els) =>
    els.slice(1).map((e) => getComputedStyle(e).borderInlineStartColor),
  );
  // only the hairline separates columns: every separator has the same colour
  expect(new Set(colors).size).toBe(1);
  const bg = await cols.first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
  await expect(cols.first().getByRole('button', { name: 'Open trace of pass 1' })).toContainText('Trace');
});

for (const width of [390, 1280]) {
  test(`expanded Arabic item has no serious axe violations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRun(page, s.slug, arabic);
    await expandFirst(page);
    const violations = await axeSeriousViolations(page, '[data-testid=item-card]');
    const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad, describeViolations(bad)).toEqual([]);
  });
}

for (const width of [1280, 1440]) {
  test(`an RTL value in a key row keeps its key left-anchored at ${width}px; the text measure is capped`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openRun(page, s.slug, arabic, 'pass=1');
    await expandFirst(page);
    const out = page.getByRole('region', { name: 'Output', exact: true }).first();
    const answer = out.getByRole('button', { name: /^answer/ });
    await answer.click();
    const row = answer.locator('xpath=ancestor::div[contains(@data-depth, "0")][1]');
    const box = (await row.boundingBox())!;
    // the key is a data-part="key" span with the direction of its own script (round 7, D2)
    const key = (await answer.locator('[data-part=key]').first().boundingBox())!;
    expect(key.x - box.x).toBeLessThan(40);
    // the value text reads right to left inside its own block, capped at the reading measure
    const text = row.locator('[dir="rtl"]').first();
    await expect(text).toBeVisible();
    const t = (await text.boundingBox())!;
    expect(t.width).toBeLessThan(760);
    expect(t.x + t.width).toBeLessThanOrEqual(box.x + box.width + 1);
  });
}
