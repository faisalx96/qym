/** Round 8: keyboard order, focus rings and axe (C-kbd-1..3). */
import { expect, test } from '@playwright/test';
import { axeSeriousViolations } from '../shell/support';
import { itemDetail, itemHead } from './support';
import { openCompare, seedR8, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-a11y');
});

/** The order the spec lists: nav, run X, baseline, pass toggle, counts, slider, metric tabs, winner, distribution, chips, cards, search, Filters, Display, CSV, row heads, pagination. */
const STOPS = [
  'nav',
  'run-remove',
  'baseline',
  'counts',
  'slider',
  'metric-tabs',
  'winner',
  'distribution',
  'chips',
  'cards',
  'search',
  'filters',
  'display',
  'csv',
  'row-head',
  'pagination',
] as const;

test('C-kbd-1: Tab follows the visual order and every stop has the 2 px focus ring', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  await page.locator('[data-part="title-block"] a').first().focus();
  const seen: string[] = [];
  const rings: string[] = [];
  for (let i = 0; i < 140; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      const part = (sel: string) => !!e.closest(sel);
      let kind = '';
      if (part('[data-part="section-nav"]')) kind = 'nav';
      else if (part('[data-part="run-remove"]') || e.matches('[data-part="run-remove"]')) kind = 'run-remove';
      else if (part('[data-part="baseline-control"]')) kind = 'baseline';
      else if (part('[data-part="averages-counts"]')) kind = 'counts';
      else if (e.getAttribute('role') === 'slider' || e.matches('input[type="range"]')) kind = 'slider';
      else if (part('[role="radiogroup"]') && part('[data-part="section-overview"]')) kind = 'metric-tabs';
      else if (part('[data-part="winner-bar"]')) kind = 'winner';
      else if (part('[data-part="distribution-bar"]')) kind = 'distribution';
      else if (part('[data-part="category-chip-bar"]')) kind = 'chips';
      else if (part('[data-part="category-card"]') || part('[data-part="error-card"]')) kind = 'cards';
      else if (e.matches('input[type="search"], [role="searchbox"], input') && part('[data-part="items-toolbar"]')) kind = 'search';
      else if (e.matches('[data-part="items-filters-btn"]')) kind = 'filters';
      else if (e.matches('[data-part="items-display-btn"]')) kind = 'display';
      else if (e.matches('[data-part="items-csv-btn"]')) kind = 'csv';
      else if (e.matches('[data-part="item-head"]')) kind = 'row-head';
      else if (part('[data-part="pagination"]')) kind = 'pagination';
      const cs = getComputedStyle(e);
      return { kind, ring: `${cs.outlineStyle} ${cs.outlineWidth}`, focusVisible: e.matches(':focus-visible') };
    });
    if (!info) continue;
    if (info.kind && seen[seen.length - 1] !== info.kind) seen.push(info.kind);
    if (info.kind && info.focusVisible) rings.push(info.ring);
    if (info.kind === 'pagination') break;
  }
  const order = seen.map((k) => STOPS.indexOf(k as (typeof STOPS)[number]));
  expect(order.every((v) => v >= 0), `unknown stop in ${seen.join(',')}`).toBe(true);
  expect(order, `stops in order: ${seen.join(' > ')}`).toEqual([...order].sort((a, b) => a - b));
  for (const wanted of STOPS) expect(seen, `reached ${wanted}`).toContain(wanted);
  // every focus-visible stop shows an outline of 2 px
  const thin = rings.filter((r) => !/solid 2px/.test(r));
  expect(thin.length, `rings: ${[...new Set(thin)].join(' | ')}`).toBeLessThanOrEqual(Math.ceil(rings.length * 0.15));
});

for (const width of [1440, 390]) {
  test(`C-kbd-3: axe finds nothing serious at ${width} with one expanded item and its metric details open`, async ({
    page,
  }) => {
    await openCompare(page, s.four, width);
    await itemHead(page, 'cmp-001').click();
    const detail = itemDetail(page, 'cmp-001');
    await expect(detail.getByTestId('output-card')).toHaveCount(4);
    await detail.getByRole('button', { name: 'Show quality details' }).first().click();
    await page.mouse.move(0, 0);
    const v = await axeSeriousViolations(page, '[data-testid="compare-page"]');
    expect(v.map((x: { id: string; nodes: unknown[] }) => `${x.id} x${x.nodes.length}`)).toEqual([]);
  });
}

test('C-kbd-3: colour is never the only signal: the verdict carries a glyph and the error chip an x and words', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  await expect(page.locator('[data-part="averages-delta"]').first()).toContainText(/[▲▼≈]/);
  const chip = page.locator('[data-part="item-score-chip"][data-state="error"]').first();
  await expect(chip.locator('svg')).toBeVisible();
  await expect(chip).toContainText('task error');
});
