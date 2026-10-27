/** Round 8: page frame and section nav (C-page-1..7, C-nav-1..3). */
import { expect, test, type Page } from '@playwright/test';
import { box, noSidewaysScroll, openCompare, part, seedR8, shell, within, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-page');
});

const SECTIONS = ['runs', 'averages', 'overview', 'categories', 'errors', 'items'] as const;
const heights = async (page: Page) => {
  const out: Record<string, number> = {};
  for (const k of SECTIONS) out[k] = (await box(part(page, `section-${k}`))).h;
  return out;
};

test('C-page-1: the first screen at 1440x900 shows all four run cards and the whole Averages table', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const card = await box(part(page, 'run-card'));
  const table = await box(part(page, 'averages-table'));
  expect(card.bottom).toBeLessThanOrEqual(530);
  expect(table.bottom).toBeLessThanOrEqual(900);
  expect((await part(page, 'run-card').count())).toBe(4);
});

for (const width of [1440, 1024, 390]) {
  test(`C-page-2/3: one sticky element (the 36 px nav) and no sideways scroll at ${width}`, async ({ page }) => {
    await openCompare(page, s.four, width);
    const sticky = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((e) => getComputedStyle(e).position === 'sticky' && !e.closest('table, [data-part=averages-table]'))
        .map((e) => e.getAttribute('data-part')),
    );
    expect(sticky).toEqual(['section-nav']);
    within((await box(part(page, 'section-nav'))).h, 36, 1, 'nav height');
    await noSidewaysScroll(page);
  });
}

test('C-page-3: eight runs scroll sideways only inside the Averages table at 1024', async ({ page }) => {
  await openCompare(page, s.eight, 1024);
  await noSidewaysScroll(page);
  const [sw, cw] = await part(page, 'averages-table').evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw).toBeGreaterThan(cw);
  expect(sw).toBeGreaterThanOrEqual(1104 - 2);
});

test('C-page-3: eight runs fit the Averages table at 1440 without scroll', async ({ page }) => {
  await openCompare(page, s.eight, 1440);
  const [sw, cw] = await part(page, 'averages-table').evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  await noSidewaysScroll(page);
});

for (const [n, width] of [
  [4, 1440],
  [8, 1440],
  [8, 1024],
] as const) {
  test(`C-page-4: no run, column, category or toggle name is cut at ${width} with ${n} runs`, async ({ page }) => {
    await openCompare(page, n === 4 ? s.four : s.eight, width);
    const bad = await page.evaluate(() => {
      const sel =
        '[data-part=run-name], [data-part=averages-colhead], [data-part=category-run-row], [data-part=output-toggle]';
      return Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((e) => getComputedStyle(e).textOverflow === 'ellipsis' || e.scrollWidth > e.clientWidth + 1)
        .map((e) => `${e.getAttribute('data-part')}: ${e.textContent?.slice(0, 40)}`);
    });
    expect(bad).toEqual([]);
  });
}

test('C-page-5: section heights, 4 runs at 1440', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const h = await heights(page);
  // every section grew by the panel (owner decision H6): 30 px of padding and border minus the 14 px lead-in it replaced
  within(h.runs!, 328, 6, 'runs');
  within(h.averages!, 371, 6, 'averages');
  within(h.overview!, 409, 6, 'overview');
  within(h.errors!, 490, 6, 'errors'); // 440 + 16 panel + 34 wrapped error messages (owner decision H6)
  within(h.items!, 1391, 6, 'items');
  // one metadata key: the section is the head plus one row of cards
  await part(page, 'category-chip-bar').getByRole('button', { name: /^domain/ }).click();
  within((await box(part(page, 'section-categories'))).h, 301, 6, 'categories with one key');
});

test('C-page-5 (1024): runs, averages 4 runs; overview amended to the measured 480', async ({ page }) => {
  await openCompare(page, s.four, 1024);
  const h = await heights(page);
  within(h.runs!, 552, 6, 'runs');
  within(h.averages!, 392, 6, 'averages');
  within(h.overview!, 496, 6, 'overview (amended: the legend names carry letters, 2 lines)');
});

test('C-page-5 (390): averages and items stay within their ceilings', async ({ page }) => {
  await openCompare(page, s.four, 390);
  const h = await heights(page);
  expect(h.averages!).toBeLessThanOrEqual(1200);
  expect(h.items!).toBeLessThanOrEqual(2600); // amended from 1820 (chips with letters wrap under the title) and from 2200 (the panel padding wraps the chips to two lines at 390, measured 2571; owner decision H6)
});

test('C-page-6: eight runs keep the 4-run recipe (two rows of cards, no Run-details button)', async ({ page }) => {
  await openCompare(page, s.eight, 1440);
  const h = await heights(page);
  within(h.runs!, 584, 8, 'runs (amended: the letter badge wraps one more name; +16 for the panel, owner decision H6)');
  within(h.averages!, 418, 8, 'averages (amended: column heads wrap to 3 lines with letters)');
  within(h.overview!, 409, 6, 'overview');
  within(h.errors!, 708, 8, 'errors'); // 620 + 16 panel + 72 wrapped messages (owner decision H6)
  within(h.items!, 1391, 8, 'items');
  await expect(page.getByRole('button', { name: /Run details/ })).toHaveCount(0);
  const tops = await part(page, 'run-card').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size);
  expect(tops).toBe(2);
});

test('C-page-7: section order and one description line per head', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const order = await page.locator('[data-report-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-part')));
  expect(order).toEqual(SECTIONS.map((k) => `section-${k}`));
  for (const k of SECTIONS) {
    const head = part(page, `section-${k}`).locator('[data-part=section-head]');
    await expect(head.locator('h2')).toHaveCount(1);
    await expect(head.locator('p')).toHaveCount(1);
  }
});

test('C-nav-1: links only, 36 px, sticky', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const nav = part(page, 'section-nav');
  await expect(nav.getByRole('link')).toHaveCount(6);
  await expect(nav.locator('select, input, [role=slider], button')).toHaveCount(0);
  expect(await nav.evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
  within((await box(nav)).h, 36, 1, 'nav');
  // stays pinned after scrolling
  await shell(page).evaluate((el) => el.scrollTo(0, 2000));
  within((await box(nav)).y, (await box(shell(page))).y, 2, 'nav stays at the top of the scroller');
});

test('C-nav-2: a click puts the section 12 px under the nav; the active link follows; keyboard works', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const nav = part(page, 'section-nav');
  await nav.getByRole('link', { name: 'Overview' }).click();
  await expect.poll(async () => Math.round((await box(part(page, 'section-overview'))).y - (await box(nav)).bottom)).toBeGreaterThanOrEqual(8);
  within((await box(part(page, 'section-overview'))).y - (await box(nav)).bottom, 12, 4, 'section top under nav');
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'location');
  await nav.getByRole('link', { name: 'Errors' }).focus();
  await page.keyboard.press('Enter');
  await expect(nav.getByRole('link', { name: 'Errors' })).toHaveAttribute('aria-current', 'location');
});

test('C-nav-3: at 390 the nav scrolls inside itself, 36 high, no wrap', async ({ page }) => {
  await openCompare(page, s.four, 390);
  const nav = part(page, 'section-nav').locator('nav');
  within((await box(part(page, 'section-nav'))).h, 36, 1, 'nav');
  const wraps = await nav.evaluate((el) => new Set(Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().y))).size);
  expect(wraps).toBe(1);
  await noSidewaysScroll(page);
});
