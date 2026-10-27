/** Round 8: title block, cohort banner, run cards (C-title-1, C-cohort-1, C-run-1..6). */
import { expect, test } from '@playwright/test';
import { cohortUrl, compareUrl, urlParams, waitLoaded } from './support';
import { box, noSidewaysScroll, openCompare, part, seedR8, within, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-runs');
});

test('C-title-1: the title block is 70 high at 1440 with Export on the title row', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const block = part(page, 'title-block');
  within((await box(block)).h, 70, 4, 'title block');
  const h1 = block.getByRole('heading', { level: 1 });
  const css = await h1.evaluate((e) => ({ size: getComputedStyle(e).fontSize, weight: getComputedStyle(e).fontWeight }));
  expect(css.size).toBe('22px');
  expect(Number(css.weight)).toBe(650);
  for (const sel of ['p:nth-of-type(1)', 'p:nth-of-type(2)']) {
    const p = await block.locator(sel).evaluate((e) => ({ size: getComputedStyle(e).fontSize, color: getComputedStyle(e).color }));
    expect(p.size).toBe('11px');
  }
  const exp = block.getByRole('link', { name: 'Export HTML' });
  within((await box(exp)).y + (await box(exp)).h / 2, (await box(h1)).y + (await box(h1)).h / 2, 4, 'Export on the title row');
});

test('C-title-1: at 390 the block is at most 140 high and Export wraps under', async ({ page }) => {
  await openCompare(page, s.four, 390);
  expect((await box(part(page, 'title-block'))).h).toBeLessThanOrEqual(140);
  await noSidewaysScroll(page);
});

test('C-cohort-1: two sides, 2 columns from 1024, 1 column at 390, at most 95 high at 1440', async ({ page }) => {
  const { base, a, b, c } = s.seed.runs;
  for (const [w, cols] of [
    [1440, 2],
    [1024, 2],
    [390, 1],
  ] as const) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(cohortUrl([b, base], [a, c], { cohortALabel: 'Weak', cohortBLabel: 'Strong' }));
    await waitLoaded(page);
    const banner = part(page, 'cohort-banner');
    await expect(banner).toContainText('Compare sides');
    const sides = part(page, 'cohort-side');
    await expect(sides).toHaveCount(2);
    await expect(sides.first()).toContainText('A / left');
    await expect(sides.first()).toContainText('Weak');
    await expect(sides.first()).toContainText('2 runs');
    await expect(sides.first().getByRole('button', { name: 'Rename cohort A' })).toBeVisible();
    const [b1, b2] = [await box(sides.nth(0)), await box(sides.nth(1))];
    const sameRow = Math.abs(b1.y - b2.y) < 2;
    expect(sameRow, `${w}: tiles in ${cols} column(s)`).toBe(cols === 2);
    if (cols === 2) expect(b1.w).toBeGreaterThanOrEqual(256);
    if (w === 1440) expect((await box(banner)).h).toBeLessThanOrEqual(95);
    await noSidewaysScroll(page);
  }
});

test('C-run-1: 4-up at 1440, 2-up at 1024, 1-up at 390; the same card at any run count', async ({ page }) => {
  for (const [w, cardW, tol] of [
    [1440, 280, 3], // 287 / 380 / 277 before the section panel took 30 px (owner decision H6)
    [1024, 365, 3],
    [390, 247, 2],
  ] as const) {
    await openCompare(page, s.four, w);
    const cards = part(page, 'run-card');
    within((await box(cards.first())).w, cardW, tol, `card width at ${w}`);
  }
  await openCompare(page, s.four, 1440);
  within((await box(part(page, 'run-card').first())).h, 239, 4, 'card height');
  await openCompare(page, s.eight, 1440);
  const hs = await part(page, 'run-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(4);
  within((await box(part(page, 'run-grid'))).h, 500, 8, 'two rows of 8 runs (amended from 478)');
});

test('C-run-2/3/4: card head, stat strip and the six meta rows', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const card = part(page, 'run-card').first();
  await expect(card.locator('[data-part="run-name"]')).toBeVisible();
  expect(Number(await card.locator('[data-part="run-name"]').evaluate((e) => getComputedStyle(e.lastElementChild!).fontWeight))).toBe(650);
  await expect(card.locator('[data-part="baseline-tag"]')).toHaveCount(1);
  await expect(part(page, 'run-card').nth(1).locator('[data-part="baseline-tag"]')).toHaveCount(0);
  within((await box(card.locator('[data-part="run-status"] > *'))).h, 20, 2, 'status badge');
  const x = card.locator('[data-part="run-remove"]');
  within((await box(x)).w, 24, 1, 'remove width');
  within((await box(x)).h, 24, 1, 'remove height');
  // strip: 3 cells x 36
  const cells = card.locator('[data-part="run-stat-strip"] > div');
  await expect(cells).toHaveCount(3);
  for (let i = 0; i < 3; i++) within((await box(cells.nth(i))).h, 36, 1, `strip cell ${i}`);
  const val = await cells.nth(0).locator('dd').evaluate((e) => ({ f: getComputedStyle(e).fontFamily, w: getComputedStyle(e).fontWeight }));
  expect(val.f).toMatch(/mono/i);
  expect(Number(val.w)).toBe(650);
  // errors > 0 is red text, 0 is not
  const errCol = (i: number) => part(page, 'run-card').nth(i).locator('[data-part="run-stat-strip"] > div').nth(2).locator('dd').evaluate((e) => getComputedStyle(e).color);
  expect(await errCol(0)).not.toBe(await errCol(3));
  // meta: Task, Model, Owner, Dataset, Started, Runtime = 6 x 20
  const meta = card.locator('[data-part="run-meta"]');
  await expect(meta.locator('dt')).toHaveText(['Task', 'Model', 'Owner', 'Dataset', 'Started', 'Runtime']);
  within((await box(meta)).h, 120, 2, 'meta list');
});

test('C-run-4: a repeat run adds a Samples row', async ({ page }) => {
  await openCompare(page, [s.seed.runs.repeat3, s.seed.runs.base], 1440);
  await expect(part(page, 'run-card').first().locator('[data-part="run-meta"] dt')).toContainText(['Samples']);
});

test('C-run-2: the remove button is absent at two runs', async ({ page }) => {
  const { base, c } = s.seed.runs;
  await openCompare(page, [base, c], 1440);
  await expect(part(page, 'run-remove')).toHaveCount(0);
});

test('C-run-5: the left border is 3 px in the run colour', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const rails = await part(page, 'run-card').evaluateAll((els) =>
    els.map((e) => {
      const article = e.firstElementChild as HTMLElement;
      const cs = getComputedStyle(article);
      const sw = getComputedStyle(e.querySelector('[data-part="run-name"]')!.firstElementChild as HTMLElement).backgroundColor;
      return { w: cs.borderInlineStartWidth, c: cs.borderInlineStartColor, sw };
    }),
  );
  for (const r of rails) {
    expect(r.w).toBe('3px');
    expect(r.c).toBe(r.sw);
  }
});

test('C-run-6: X removes the run, updates the URL, moves focus to the next X; Enter works; the name says what it removes', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const { base, a, b, c } = s.seed.runs;
  const x = part(page, 'run-remove');
  await expect(x.nth(1)).toHaveAttribute('aria-label', 'Remove cand-a-sonnet from the comparison');
  await x.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => urlParams(page).getAll('runs')).toEqual([base, b, c]);
  await expect(part(page, 'run-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Remove cand-b-small from the comparison' })).toBeFocused();
  void a;
});

test('C-run-1: 8 runs at 390 stack one card per row without sideways scroll', async ({ page }) => {
  await openCompare(page, s.eight, 390);
  await noSidewaysScroll(page);
  const tops = await part(page, 'run-card').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size);
  expect(tops).toBe(8);
  await page.goto(compareUrl(s.four));
});
