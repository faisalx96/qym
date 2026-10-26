/** Round 8: Performance by category and Error distribution (C-cat-1..5, C-err-1..3). */
import { expect, test } from '@playwright/test';
import { expectShown, urlParams } from './support';
import { box, noSidewaysScroll, openCompare, part, seedR8, shell, within, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-cat');
});

test('C-cat-1: the chip bar is in the head: label Categories, 26 high chips "key N", toggling is URL-backed', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const bar = part(page, 'category-chip-bar');
  await expect(bar).toContainText('Categories');
  const chips = bar.getByRole('button');
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toContainText(/^complexity\s*3$/);
  within((await box(chips.first())).h, 26, 1, 'chip height');
  await expect(part(page, 'category-grid')).toHaveCount(2);
  await chips.nth(1).click(); // domain off
  await expect(part(page, 'category-grid')).toHaveCount(1);
  expect(urlParams(page).getAll('catKeys')).toEqual(['complexity']);
  await page.reload();
  await expect(part(page, 'category-grid')).toHaveCount(1);
  // at 390 the chips wrap under the title
  await openCompare(page, s.four, 390);
  const head = part(page, 'section-categories').locator('[data-part="section-head"]');
  expect((await box(bar)).y).toBeGreaterThan((await box(head.locator('h2'))).y);
  await noSidewaysScroll(page);
});

test('C-cat-2/3/4: 3-up cards with a value rail, a header row, run rows with a run-colour bar and a baseline tick', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440, { catKeys: 'complexity' });
  const cards = part(page, 'category-card');
  await expect(cards).toHaveCount(3);
  within((await box(cards.first())).w, 388, 3, 'card width');
  within((await box(cards.first())).h, 185, 4, 'card height (4 runs)');
  const tops = await cards.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size);
  expect(tops).toBe(1);
  // rails: easy score-4, medium score-3, hard score-1
  const rails = await cards.evaluateAll((els) => els.map((e) => getComputedStyle(e).borderInlineStartColor));
  expect(new Set(rails).size).toBe(3);
  const token = (n: string) => page.evaluate((v) => {
    const el = document.createElement('i');
    el.style.color = `var(${v})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, n);
  const easy = cards.filter({ hasText: /^easy/ });
  expect(await easy.evaluate((e) => getComputedStyle(e).borderInlineStartColor)).toBe(await token('--score-4'));
  expect(await cards.filter({ hasText: /^hard/ }).evaluate((e) => getComputedStyle(e).borderInlineStartColor)).toBe(await token('--score-1'));
  const title = await easy.locator('span').first().evaluate((e) => ({ s: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight }));
  expect(title.s).toBe('13px');
  expect(Number(title.w)).toBe(650);
  await expect(easy).toContainText(/Run.*Average.*Latency.*Change/);
  // rows
  const rows = easy.locator('[data-part="category-run-row"]');
  await expect(rows).toHaveCount(4);
  within((await box(rows.first())).h, 27, 2, 'run row');
  const track = rows.nth(1).locator('[data-part="category-track"]');
  within((await box(track)).h, 8, 1, 'bar');
  const fill = await track.locator('span').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  const swatch = await rows.nth(1).locator('[data-part="run-name"]').evaluate((e) => getComputedStyle(e.firstElementChild!).backgroundColor);
  expect(fill).toBe(swatch);
  await expect(rows.first().locator('[data-part="category-tick"]')).toHaveCount(0); // the baseline has no tick
  const tick = rows.nth(1).locator('[data-part="category-tick"]');
  within((await box(tick)).w, 1, 0.5, 'tick width');
  within((await box(tick)).h - (await box(track)).h, 4, 1, 'tick is 4 px taller than the bar');
  await expect(rows.first()).toContainText('Baseline');
  await expect(rows.nth(1)).toContainText('pts');
  for (const [w, cols, cw] of [
    [1024, 2, 380],
    [390, 1, 277],
  ] as const) {
    await openCompare(page, s.four, w, { catKeys: 'complexity' });
    const ys = await part(page, 'category-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(ys).size, `${w}: columns`).toBe(cols);
    within((await box(part(page, 'category-card').first())).w, cw, 3, `${w} card width`);
    await noSidewaysScroll(page);
  }
});

test('C-cat-3: the column header row is hidden at 390', async ({ page }) => {
  await openCompare(page, s.four, 390, { catKeys: 'complexity' });
  const cols = part(page, 'category-card').first().locator('[aria-hidden="true"]').first();
  expect(await cols.isVisible()).toBe(false);
});

test('C-cat-5: a card filters, shows the banner and the Filters badge, scrolls to the list; no sidebar, no width change', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440, { catKeys: 'complexity' });
  const before = (await box(part(page, 'section-categories'))).w;
  const easy = part(page, 'category-card').filter({ hasText: /^easy/ });
  const n = Number(/^easy\s*(\d+)/i.exec((await easy.innerText()).trim())![1]);
  await easy.click();
  await expectShown(page, n);
  await expect(part(page, 'baseline-delta-banner')).toContainText('Complexity: easy');
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  await expect(page.getByRole('complementary', { name: 'Quick filters' })).toHaveCount(0);
  await expect
    .poll(async () => Math.abs((await box(part(page, 'section-items'))).y - (await box(part(page, 'section-nav'))).bottom - 12), { timeout: 5000 })
    .toBeLessThanOrEqual(6);
  expect((await box(part(page, 'section-categories'))).w).toBe(before);
  void shell;
  // Enter and Space activate the card
  await part(page, 'category-card').filter({ hasText: /^easy/ }).focus();
  await page.keyboard.press('Enter');
  await expectShown(page, 40);
  await page.keyboard.press('Space');
  await expectShown(page, n);
});

test('C-err-1/2: groups with a count, cards 287 wide with a rail, every run listed (zeros included) with its change', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const groups = part(page, 'error-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.first()).toContainText(/task errors/i);
  await expect(groups.nth(1)).toContainText(/metric errors/i);
  await expect(groups.first().locator('svg').first()).toBeVisible();
  const cards = part(page, 'error-card');
  const timeout = cards.filter({ hasText: /TimeoutError/ });
  within((await box(timeout)).w, 287, 3, 'error card width');
  within((await box(timeout)).h, 149, 3, 'error card height with 4 runs');
  const token = (n: string) => page.evaluate((v) => {
    const el = document.createElement('i');
    el.style.color = `var(${v})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, n);
  expect(await timeout.evaluate((e) => getComputedStyle(e).borderInlineStartColor)).toBe(await token('--error'));
  expect(await cards.filter({ hasText: /JudgeError/ }).evaluate((e) => getComputedStyle(e).borderInlineStartColor)).toBe(await token('--metric-error'));
  // every run is listed in every card: the run with no errors (cand-c-same) shows 0
  for (const card of await cards.all()) await expect(card.locator('[data-part="error-run"]')).toHaveCount(4);
  const rows = timeout.locator('[data-part="error-run"]');
  await expect(rows.first()).toContainText('Baseline');
  await expect(rows.nth(3)).toContainText('0');
  await expect(rows.nth(3)).toContainText('−2');
  await expect(rows.nth(2)).toContainText('+1');
  const count = await rows.nth(0).locator('td').nth(1).evaluate((e) => getComputedStyle(e).fontFamily);
  expect(count).toMatch(/mono/i);
});

test('C-err-1: 8 runs list every run too and the card stays at most 240 high', async ({ page }) => {
  await openCompare(page, s.eight, 1440);
  const timeout = part(page, 'error-card').filter({ hasText: /TimeoutError/ });
  await expect(timeout.locator('[data-part="error-run"]')).toHaveCount(8);
  expect((await box(timeout)).h).toBeLessThanOrEqual(240);
});

test('C-err-3: the card is a button; click, Enter and Space filter the items with no layout change', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const card = part(page, 'error-card').filter({ hasText: /TimeoutError/ });
  await expect(card).toHaveAttribute('role', 'button');
  const before = (await box(part(page, 'section-errors'))).w;
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(part(page, 'baseline-delta-banner')).toContainText('Task error');
  const shown = await page.getByRole('status').filter({ hasText: /of 40 items/ }).textContent();
  expect(Number(/^(\d+) of/.exec(shown ?? '')![1])).toBeLessThan(40);
  expect((await box(part(page, 'section-errors'))).w).toBe(before);
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
});
