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
    const cols = page.locator('[data-kind="passes"] article[data-pass]');
    await expect(cols).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const c = await cols.nth(i).boundingBox();
      expect(c!.x + c!.width).toBeLessThanOrEqual(width);
    }
  });
}

test('an Arabic input row mirrors: the label is next to its text, not a table width away', async ({
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
  await expect(row).toHaveAttribute('dir', 'rtl');
  const label = await row.locator('> div').first().boundingBox();
  const text = await row.locator('[data-kind="input"]').boundingBox();
  // RTL: the label is at the right, the text begins within a column gap of it
  expect(Math.abs(label!.x - (text!.x + text!.width))).toBeLessThan(80);
  // the text measure is capped (76ch is about 700px)
  expect(text!.width).toBeLessThan(760);
});

test('an RTL value keeps its key header left-anchored in the same column as the LTR keys', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, arabic);
  await expandFirst(page);
  const expected = page.getByTestId('item-card').getByRole('group', { name: 'Expected output', exact: true });
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

test('JSON output is one section per key, collapsible, with a Raw view', async ({ page }) => {
  await openRun(page, s.slug, arabic, 'pass=1');
  await expandFirst(page);
  const out = page.getByRole('group', { name: 'Output', exact: true }).first();
  for (const key of ['answer', 'reasoning', 'citations', 'confidence', 'sql', 'followups'])
    await expect(out.getByRole('group', { name: key, exact: true })).toBeVisible();
  // uniform objects read as a table
  await expect(out.getByRole('grid')).toContainText('policy-2026');
  // collapse a key
  const answer = out.getByRole('button', { name: /^answer/ });
  await expect(answer).toHaveAttribute('aria-expanded', 'true');
  await answer.click();
  await expect(answer).toHaveAttribute('aria-expanded', 'false');
  // Raw keeps the whole payload
  await out.getByRole('radio', { name: 'Raw' }).click({ force: true });
  await expect(out).toContainText('"citations"');
  await out.getByRole('radio', { name: 'Sections' }).click({ force: true });
});

test('an opened metric reads at the full width under the chip row, several at once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await expandFirst(page);
  const card = page.getByTestId('item-card');
  const chips = card.getByRole('list', { name: 'Metrics' });
  const toggles = chips.getByRole('button', { name: /^Show .* details$/ });
  const n = await toggles.count();
  expect(n).toBeGreaterThan(0);
  const chip = await chips.getByRole('listitem').first().boundingBox();
  await toggles.first().click();
  const panel = card.locator('section[data-metric]').first();
  await expect(panel).toBeVisible();
  const p = await panel.boundingBox();
  expect(p!.width).toBeGreaterThan(chip!.width * 2.5);
  if (n > 1) {
    await toggles.nth(0).click(); // first label flipped to Hide
    await card
      .getByRole('button', { name: /^Show .* details$/ })
      .first()
      .click();
    await expect(card.getByRole('button', { name: /^Hide .* details$/ })).not.toHaveCount(0);
  }
});

test('pass columns have an accent rail, a labelled Trace button and no fills', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, arabic);
  await expandFirst(page);
  const cols = page.locator('[data-kind="passes"] article[data-pass]');
  const colors = await cols.evaluateAll((els) => els.map((e) => getComputedStyle(e).borderInlineStartColor));
  expect(new Set(colors).size).toBe(3);
  const bg = await cols.first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
  await expect(cols.first().getByRole('button', { name: 'Open trace of pass 1' })).toContainText('Trace');
  await expect(page.getByTestId('pass-diff').first()).toBeVisible();
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
  test(`an RTL value in a JSON section keeps its key left-anchored at ${width}px; tables fit their column`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openRun(page, s.slug, arabic, 'pass=1');
    await expandFirst(page);
    const out = page.getByRole('group', { name: 'Output', exact: true }).first();
    const section = out.getByRole('group', { name: 'answer', exact: true });
    // the section is not mirrored (final review F5): the key header stays at the left like every LTR key
    await expect(section).not.toHaveAttribute('dir', 'rtl');
    const box = (await section.boundingBox())!;
    const key = (await section.locator('span[dir="ltr"]').first().boundingBox())!;
    // the rendered text, not its (wider) block
    const text = await section.locator('[data-text-mode]').evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const b = r.getBoundingClientRect();
      return { left: b.left, right: b.right };
    });
    expect(key.x - box.x).toBeLessThan(40);
    // the value text reads right to left inside its own column, which is capped (never the full table width)
    expect(text.right).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(text.right - box.x).toBeLessThan(760);
    // the citations table is not wider than the pass output it sits in
    const grid = out.getByRole('group', { name: 'citations', exact: true }).getByRole('grid');
    const fits = await grid.evaluate((el) => {
      const sc = el.closest<HTMLElement>('[data-dt-scroller]');
      return !!sc && sc.scrollWidth <= sc.clientWidth + 1;
    });
    expect(fits).toBe(true);
    const row = await grid.locator('tbody tr').first().boundingBox();
    expect(row!.height).toBeLessThan(40);
  });
}
