/** Scenario 11: keyboard operation, visible focus, accessible names and an axe-core scan. */
import { expect, test, type Page } from '@playwright/test';
import { axeSeriousViolations } from '../shell/support';
import { compareUrl, itemHead, seedScenario, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-a11y');
});

const open4 = async (page: Page) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
};

test('keyboard: Tab reaches the toolbar; Enter toggles Filters; Display popover and CSV dialog close with Escape and return focus', async ({
  page,
}) => {
  await open4(page);
  const search = page.getByRole('searchbox', { name: 'Search items' });
  await search.focus();
  await page.keyboard.press('Tab');
  const filters = page.getByRole('button', { name: /^Filters/ });
  await expect(filters).toBeFocused();
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('filter-builder')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('filter-builder')).toHaveCount(0);

  // Quick filters (round 8, H2) sits between Filters and Display; it opens the facet list beside the items
  await page.keyboard.press('Tab');
  const facets = page.getByRole('button', { name: 'Quick filters' });
  await expect(facets).toBeFocused();
  await expect(facets).toHaveAttribute('aria-expanded', 'false');

  // Display popover: Enter opens, Escape closes and focus returns to the trigger
  await page.keyboard.press('Tab');
  const display = page.getByRole('button', { name: 'Display' });
  await expect(display).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radiogroup', { name: 'Text mode' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('radiogroup', { name: 'Text mode' })).toHaveCount(0);
  await expect(display).toBeFocused();

  // CSV dialog
  await page.keyboard.press('Tab');
  const csv = page.getByRole('button', { name: 'CSV' });
  await expect(csv).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Export CSV' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(csv).toBeFocused();
});

test('item rows: visible keyboard focus ring; Enter expands and collapses', async ({ page }) => {
  await open4(page);
  const rowBtn = itemHead(page, 'cmp-001');
  // focus by keyboard so :focus-visible applies
  await page.getByRole('searchbox', { name: 'Search items' }).focus();
  for (let i = 0; i < 40 && !(await rowBtn.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(rowBtn).toBeFocused();
  const ring = await rowBtn.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      matches: el.matches(':focus-visible'),
      style: s.outlineStyle,
      width: s.outlineWidth,
      shadow: s.boxShadow,
    };
  });
  expect(ring.matches).toBe(true);
  const hasOutline = ring.style !== 'none' && parseFloat(ring.width) > 0;
  const hasShadow = ring.shadow !== 'none' && ring.shadow !== '';
  expect(hasOutline || hasShadow, `row focus indicator: ${JSON.stringify(ring)}`).toBe(true);
  expect(hasOutline, `row has no outline (computed ${JSON.stringify(ring)})`).toBe(true);

  await expect(rowBtn).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(rowBtn).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('item-detail')).toBeVisible();
  // collapsing right after the expand must not be undone when the ?item= URL catches up
  await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBe('cmp-001');
  await expect(page.getByTestId('output-card')).toHaveCount(4); // bodies loaded
  await page.keyboard.press('Enter');
  await expect(rowBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('item-detail')).toHaveCount(0);
});

test('every control has an accessible name; remove buttons say what they remove', async ({ page }) => {
  await open4(page);
  const cards = page.getByRole('list', { name: 'Runs in this comparison' });
  const names = await cards
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? ''));
  // per card: remove only (round 8: the baseline is chosen in the Averages head, there is no star button)
  expect(names).toHaveLength(4);
  expect(names.filter((n) => /^Remove .+ from the comparison$/.test(n))).toHaveLength(4);
  const unnamed = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll(
        '[data-testid="compare-page"] button, [data-testid="compare-page"] input, [data-testid="compare-page"] [role="tab"]',
      ),
    )) {
      const name = (
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        (el as HTMLElement).innerText ||
        (el as HTMLInputElement).labels?.[0]?.textContent ||
        el.getAttribute('title') ||
        ''
      ).trim();
      if (!name) bad.push(el.outerHTML.slice(0, 120));
    }
    return bad;
  });
  expect(unnamed).toEqual([]);
  // landmarks
  await expect(page.getByRole('region', { name: 'Item-by-item comparison' })).toBeAttached();
  await expect(page.getByRole('main')).toHaveCount(1); // the shell's; the items list must not nest a second main
  await expect(page.getByRole('navigation', { name: 'Comparison sections' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Per-run averages' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Per-run averages' })).toBeVisible();
});

const axeScan = async (page: Page) => {
  const v = await axeSeriousViolations(page, '[data-testid="compare-page"]');
  return v.map(
    (x) => `${x.id} (${x.impact}): ${x.help} x${x.nodes.length} e.g. ${x.nodes[0]?.target.join(' ')}`,
  );
};

test('axe: no serious or critical violations on the loaded Compare page', async ({ page }) => {
  await open4(page);
  expect(await axeScan(page)).toEqual([]);
});

test('axe: no serious or critical violations with an expanded item', async ({ page }) => {
  await open4(page);
  await itemHead(page, 'cmp-001').click();
  await expect(page.getByTestId('output-card')).toHaveCount(4);
  expect(await axeScan(page)).toEqual([]);
});

test('axe: no serious or critical violations in the Sweep view', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(`/compare?cohortA=${b}&cohortA=${base}&cohortB=${a}&cohortB=${c}&tab=sweep`);
  await expect(page.getByTestId('sweep-view')).toBeVisible();
  expect(await axeScan(page)).toEqual([]);
});

test('phone width: no horizontal page scroll, with and without an expanded item', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open4(page);
  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await width()).toBeLessThanOrEqual(390);
  await itemHead(page, 'cmp-001').click();
  await expect(page.getByTestId('output-card')).toHaveCount(4);
  expect(await width()).toBeLessThanOrEqual(390);
});

test.describe('light theme', () => {
  test.use({ colorScheme: 'light' });
  test('axe: no serious or critical violations with an expanded item', async ({ page }) => {
    await open4(page);
    await itemHead(page, 'cmp-001').click();
    await expect(page.getByTestId('output-card')).toHaveCount(4);
    expect(await axeScan(page)).toEqual([]);
  });
});
