/** Round 8: Item-by-item head, banner, toolbar, filters, Display and the item rows (C-items-1..8, C-row-1..7). */
import { expect, test, type Page } from '@playwright/test';
import { expectShown, itemHead } from './support';
import { box, noSidewaysScroll, openCompare, part, seedR8, within, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-items');
});

const toolbarControls = (page: Page) =>
  page.locator('[data-part="items-toolbar"]').locator('input, button');

test('C-items-1: the head is a title and one line; no Auto-analyze without an analysis', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const head = part(page, 'section-items').locator('[data-part="section-head"]');
  await expect(head.locator('h2')).toHaveText('Item-by-item comparison');
  await expect(head.locator('p')).toHaveCount(1);
  await expect(head.getByRole('button')).toHaveCount(0);
});

test('C-items-3: the toolbar is not sticky; one 24 px row at 1440, at most 56 at 1024 and 90 at 390', async ({ page }) => {
  for (const [w, maxH] of [
    [1440, 26],
    [1024, 56],
    [390, 90],
  ] as const) {
    await openCompare(page, s.four, w);
    const bar = part(page, 'items-toolbar');
    expect(await bar.evaluate((e) => getComputedStyle(e).position)).not.toBe('sticky');
    expect((await box(bar)).h, `toolbar at ${w}`).toBeLessThanOrEqual(maxH);
    const hs = await toolbarControls(page).evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    for (const h of hs) expect(h, `control height at ${w}`).toBeLessThanOrEqual(26);
    await noSidewaysScroll(page);
  }
  await openCompare(page, s.four, 1440);
  const centres = await toolbarControls(page).evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null && e.tagName === 'BUTTON')
      .map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)),
  );
  expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);
  within((await box(part(page, 'items-filters-btn'))).w, 117, 8, 'Filters button');
});

test('C-items-4: the count is a status in mono 11 and follows the filters', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const count = part(page, 'items-count');
  await expect(count).toHaveAttribute('role', 'status');
  await expect(count).toHaveText('40 of 40 items');
  const css = await count.evaluate((e) => ({ f: getComputedStyle(e).fontFamily, s: getComputedStyle(e).fontSize }));
  expect(css.f).toMatch(/mono/i);
  expect(css.s).toBe('11px');
  await page.getByRole('searchbox', { name: 'Search items' }).fill('clause 3');
  await expect(count).not.toHaveText('40 of 40 items');
  await expect(page.locator('[data-part="items-clear-btn"]')).toContainText('1');
  await page.locator('[data-part="items-clear-btn"]').click();
  await expectShown(page, 40);
  await expect(page.locator('[data-part="items-clear-btn"]')).toHaveCount(0);
});

test('C-items-2: the banner is one line above the toolbar, names in bold, Clear removes it', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  await part(page, 'averages-counts').nth(1).locator('button').nth(1).click(); // a regressed count
  const banner = part(page, 'baseline-delta-banner');
  await expect(banner).toHaveAttribute('role', 'status');
  expect((await box(banner)).h).toBeLessThanOrEqual(44);
  expect((await box(banner)).bottom).toBeLessThanOrEqual((await box(part(page, 'items-toolbar'))).y);
  expect(await banner.locator('b').count()).toBeGreaterThanOrEqual(3);
  await expect(banner).toContainText('regressed');
  await expect(banner).toContainText('against the baseline');
  const cut = await banner.locator('b').evaluateAll((els) => els.some((e) => e.scrollWidth > e.clientWidth + 1));
  expect(cut).toBe(false);
  await banner.getByRole('button', { name: 'Clear' }).click();
  await expect(banner).toHaveCount(0);
  await expectShown(page, 40);
});

test('C-items-5/6: Filters opens an inline panel under the toolbar; Escape closes it and focus returns; fields use run names', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const btn = part(page, 'items-filters-btn');
  await expect(btn).toContainText('0');
  const gap = async () => (await box(part(page, 'run-key'))).y - (await box(part(page, 'items-toolbar'))).y;
  const gapBefore = await gap();
  await btn.click();
  const panel = part(page, 'filter-builder');
  await expect(panel).toBeVisible();
  expect((await box(panel)).h).toBeGreaterThanOrEqual(100);
  await expect(panel).toContainText(/Filters/);
  await expect(panel).toContainText(/no rules yet/i);
  await expect(panel.getByRole('radiogroup', { name: 'Match mode' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '+ Condition' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '+ Group' })).toBeVisible();
  // inline: nothing painted over content, the list moved down by the panel height
  expect(await gap()).toBeGreaterThan(gapBefore + 90);
  expect((await box(panel)).bottom).toBeLessThanOrEqual((await box(part(page, 'run-key'))).y);
  // fields: Outcome, Winner with run names, Passing runs, metadata, Approval, Has error, Output text, Max latency
  await panel.getByRole('button', { name: '+ Condition' }).click();
  await panel.getByTestId('filter-condition').first().getByRole('button', { name: /field|Choose/i }).click();
  const options = await page.getByRole('option').allInnerTexts();
  const text = options.join('|');
  for (const f of ['Outcome', 'Winner', 'Passing runs', 'Approval', 'Has error', 'Output text', 'Max latency']) expect(text).toContain(f);
  expect(text).toMatch(/cand-a-sonnet · quality/);
  await page.keyboard.press('Escape'); // closes the field list
  await page.keyboard.press('Escape'); // closes the panel
  await expect(panel).toHaveCount(0);
  await expect(btn).toBeFocused();
});

test('C-items-6: the Winner values say "<run name> won" and "Only <run name> solved"', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  await part(page, 'items-filters-btn').click();
  const panel = part(page, 'filter-builder');
  await panel.getByRole('button', { name: '+ Condition' }).click();
  await panel.getByTestId('filter-condition').first().getByRole('button', { name: /field|Choose/i }).click();
  await page.getByRole('option', { name: 'Comparison · Winner' }).click();
  await panel.getByTestId('filter-condition').first().getByRole('button', { name: /Values/ }).click();
  await expect(page.getByText('cand-a-sonnet won', { exact: true })).toBeVisible();
  await expect(page.getByText('Only cand-a-sonnet solved', { exact: true })).toBeVisible();
  await expect(page.getByText(/^B won$/)).toHaveCount(0);
});

test('C-items-7: Display is a 300 px popover with the metric, sort, text mode; Escape returns focus', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const btn = part(page, 'items-display-btn');
  await expect(btn).toContainText('Display · quality');
  within((await box(btn)).h, 24, 1, 'Display button');
  await btn.click();
  const pop = part(page, 'display-popover');
  await expect(pop).toBeVisible();
  within((await box(pop)).w, 300, 2, 'popover width');
  await expect(pop.getByRole('button', { name: /Analysis metric/ })).toBeVisible();
  await expect(pop.getByRole('button', { name: /Sort/ })).toBeVisible();
  await expect(pop.getByRole('radiogroup', { name: 'Text mode' })).toBeVisible();
  // switching the analysis metric updates the button label
  await pop.getByRole('button', { name: /Analysis metric/ }).click();
  await page.getByRole('option', { name: 'correct' }).click();
  await expect(btn).toContainText('Display · correct');
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(btn).toBeFocused();
});

test('C-items-8: CSV is a 24 px accent button that opens the export dialog', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const csv = part(page, 'items-csv-btn');
  within((await box(csv)).h, 24, 1, 'CSV');
  expect(await csv.getAttribute('data-variant')).toBe('accent');
  await csv.click();
  await expect(page.getByRole('dialog', { name: 'Export CSV' })).toBeVisible();
});

test('C-row-1/2: cards of 54 with a pitch of 60, 20 per page, a 26 px chevron, the number and a clamped title', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const rows = part(page, 'item-row');
  await expect(rows).toHaveCount(20);
  const r0 = await box(rows.first());
  within(r0.h, 54, 1, 'row height');
  within((await box(rows.nth(1))).y - r0.y, 60, 1, 'pitch');
  const css = await rows.first().evaluate((e) => ({ r: getComputedStyle(e).borderRadius, b: getComputedStyle(e).borderTopWidth }));
  expect(css.r).toBe('8px');
  expect(css.b).toBe('1px');
  within((await box(part(page, 'item-list'))).w, 1194, 4, 'list width');
  const chev = await box(rows.first().locator('[data-part="item-chevron"]'));
  within(chev.w, 26, 1, 'chevron');
  within(chev.h, 26, 1, 'chevron');
  const no = await rows.first().locator('[data-part="item-index"]').evaluate((e) => ({ f: getComputedStyle(e).fontFamily, s: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight }));
  expect(no.f).toMatch(/mono/i);
  expect(no.s).toBe('13px');
  expect(Number(no.w)).toBe(600);
  expect(await rows.first().locator('[data-part="item-title"]').evaluate((e) => getComputedStyle(e).webkitLineClamp)).toBe('2');
});

test('C-row-3: one chip per run on one line at 1440, swatch inside, band colour, amended size', async ({ page }) => {
  for (const [refs, w] of [
    [s.four, 1440],
    [s.eight, 1440],
    [s.four, 1024],
  ] as const) {
    await openCompare(page, refs, w);
    const chips = part(page, 'item-row').first().locator('[data-part="item-score-chip"]');
    await expect(chips).toHaveCount(refs.length);
    const ys = await chips.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size);
    expect(ys, `${refs.length} chips on one line at ${w}`).toBe(1);
    within((await box(chips.first())).h, 22, 1, 'chip height');
    expect((await box(chips.first())).w).toBeLessThanOrEqual(84); // amended from 68: swatch + letter + value
  }
  await openCompare(page, s.four, 1440);
  const chip = part(page, 'item-score-chip').first();
  const css = await chip.evaluate((e) => ({ f: getComputedStyle(e).fontFamily, s: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight }));
  expect(css.f).toMatch(/mono/i);
  expect(css.s).toBe('12px');
  expect(Number(css.w)).toBe(600);
  within((await box(chip.locator('span').first())).w, 8, 1, 'swatch inside the chip');
  await expect(chip.locator('[data-part="run-letter"], span').nth(1)).toHaveText('A');
});

test('C-row-3 (390): four chips sit under the title, one line, the row stays at most 88 high', async ({ page }) => {
  await openCompare(page, s.four, 390);
  const row = part(page, 'item-row').first();
  const chips = row.locator('[data-part="item-score-chip"]');
  const ys = await chips.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size);
  expect(ys).toBe(1);
  expect((await box(row)).h).toBeLessThanOrEqual(88); // amended from 76: chips carry a letter
  const title = await box(row.locator('[data-part="item-title"]'));
  expect((await box(chips.first())).y).toBeGreaterThanOrEqual(title.y + title.h - 2);
  await noSidewaysScroll(page);
});

test('C-row-4: a task error is a red outlined chip with an x and the words "task error"; the row border is red', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const errored = part(page, 'item-row').and(page.locator('[data-error]')).first();
  const chip = errored.locator('[data-part="item-score-chip"][data-state="error"]').first();
  await expect(chip).toContainText('task error');
  await expect(chip.locator('svg')).toBeVisible();
  const [bc, bw] = await errored.evaluate((e) => [getComputedStyle(e).borderTopColor, getComputedStyle(e).borderTopWidth]);
  expect(bw).toBe('1px');
  const red = await page.evaluate(() => {
    const el = document.createElement('i');
    el.style.color = 'var(--error)';
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  });
  expect(bc).toBe(red);
  // no left rails
  expect(await errored.evaluate((e) => getComputedStyle(e).borderInlineStartWidth)).toBe('1px');
});

test('C-row-5: the run key names every run once, is not sticky and takes at most two lines at 8 runs', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  within((await box(part(page, 'run-key'))).h, 18.6, 2, 'run key');
  await openCompare(page, s.eight, 1440);
  expect((await box(part(page, 'run-key'))).h).toBeLessThanOrEqual(44);
  await expect(part(page, 'run-key').locator('[data-part="run-name"]')).toHaveCount(8);
  expect(await part(page, 'run-key').evaluate((e) => getComputedStyle(e).position)).not.toBe('sticky');
});

test('C-row-6: the head is one tab stop (role=button), Enter and Space toggle, several rows can stay open', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const h1 = itemHead(page, 'cmp-001');
  await expect(h1).toHaveAttribute('role', 'button');
  await expect(h1).toHaveAttribute('tabindex', '0');
  await h1.focus();
  await page.keyboard.press('Enter');
  await expect(h1).toHaveAttribute('aria-expanded', 'true');
  const h2 = itemHead(page, 'cmp-002');
  await h2.focus();
  await page.keyboard.press('Space');
  await expect(h2).toHaveAttribute('aria-expanded', 'true');
  await expect(h1).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('item-detail')).toHaveCount(2);
  // the hover background comes from --bg-hover
  await h2.hover();
  const [bg, hover] = await Promise.all([
    h2.evaluate((e) => getComputedStyle(e).backgroundColor),
    page.evaluate(() => {
      const el = document.createElement('i');
      el.style.color = 'var(--bg-hover)';
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    }),
  ]);
  expect(bg).toBe(hover);
});

test('C-row-7: the pager says 1-20 of 40 items, 24 px controls, 20 per page', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const pager = part(page, 'pagination');
  await expect(pager).toContainText(/1[-–]20 of 40 items/);
  for (const b of await pager.getByRole('button').all()) within((await box(b)).h, 24, 1, 'pager button');
  await pager.getByRole('button', { name: /next/i }).first().click();
  await expect(pager).toContainText(/21[-–]40 of 40 items/);
  await expect(part(page, 'item-row')).toHaveCount(20);
});

test('C-items-5 (fix F1): Escape closes the Filters panel while the focus is still on the Filters button', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const btn = part(page, 'items-filters-btn');
  await btn.click(); // the focus stays on the button after a click
  await expect(part(page, 'filter-builder')).toBeVisible();
  await expect(btn).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(part(page, 'filter-builder')).toHaveCount(0);
  await expect(btn).toBeFocused();
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(part(page, 'filter-builder')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(part(page, 'filter-builder')).toHaveCount(0);
});

test('C-items-6 (fix F2): "+ Condition" offers Change vs baseline per run and metric, and it filters like the count buttons', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  await part(page, 'items-filters-btn').click();
  const panel = part(page, 'filter-builder');
  await panel.getByRole('button', { name: '+ Condition' }).click();
  await panel.getByTestId('filter-condition').first().getByRole('button', { name: /field|Choose/i }).click();
  await page.getByRole('option', { name: 'Comparison · Change vs baseline' }).click();
  const rule = panel.getByTestId('filter-change-rule');
  await expect(rule).toBeVisible();
  await expect(panel.getByTestId('filter-condition')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  // first candidate run, the page metric, improved: the count the averages show
  await expect(part(page, 'items-count')).toHaveText(/^\d+ of 40 items$/);
  await expect(part(page, 'items-count')).not.toHaveText('40 of 40 items');
  await expect(part(page, 'baseline-delta-banner')).toContainText('improved');
  // change the run and the verdict from the rule row
  await rule.getByRole('button', { name: /Change$/ }).click();
  await page.getByRole('option', { name: 'regressed' }).click();
  await expect(part(page, 'baseline-delta-banner')).toContainText('regressed');
  await rule.getByRole('button', { name: 'Delete change rule' }).click();
  await expectShown(page, 40);
  await expect(rule).toHaveCount(0);
});
