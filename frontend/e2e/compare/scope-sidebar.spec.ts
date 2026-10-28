/** Compare: scope sidebar, deep-link landing position, removing a run keeps the scroll position. */
import { test, expect, type Page } from '@playwright/test';
import { compareUrl, seedScenario, waitLoaded, goSection } from './support';
import { box, part, within } from './r8';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-scope');
});

const four = () => [seed.runs.base, seed.runs.a, seed.runs.b, seed.runs.c];
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Quick filters' });

// Owner decision H2 (round 8): the Quick-filters facet list stays, opened from the items toolbar, beside the list only.
const facetsBtn = (page: Page) => page.locator('[data-part="items-facets-btn"]');

test('H2: the sidebar is closed by default and a search, count button or card never opens it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(compareUrl(four(), { q: 'policy' }));
  await waitLoaded(page);
  await expect(sidebar(page)).toHaveCount(0);
  await expect(facetsBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('scope-bar')).toHaveCount(0);
  await page.getByRole('button', { name: /^Clear \d/ }).click();
  await page.getByRole('table', { name: 'Per-run averages' }).getByRole('button', { name: /improved/ }).first().click();
  await expect(page.getByTestId('baseline-delta-banner')).toBeVisible();
  await expect(sidebar(page)).toHaveCount(0);
});

test('H2: open at 1440 the sidebar sits beside the list only; every section above keeps its width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(compareUrl(four()));
  await waitLoaded(page);
  const widths = async () => ({
    runs: (await box(part(page, 'run-grid'))).w,
    avg: (await box(part(page, 'averages-table'))).w,
    ov: (await box(part(page, 'stat-grid'))).w,
    head: (await box(part(page, 'items-toolbar'))).w,
    list: (await box(part(page, 'item-list'))).w,
  });
  const closed = await widths();
  await facetsBtn(page).click();
  await expect(facetsBtn(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar(page)).toBeVisible();
  await expect(sidebar(page).getByRole('group', { name: 'Active filters' })).toBeVisible();
  const open = await widths();
  expect(open.runs).toBe(closed.runs);
  expect(open.avg).toBe(closed.avg);
  expect(open.ov).toBe(closed.ov);
  expect(open.head, 'the toolbar keeps its full width').toBe(closed.head);
  // the item cards narrow by the 300 px column and the 24 px gap
  within(closed.list - open.list, 300 + 24, 12, 'list width taken by the sidebar');
  const items = await box(part(page, 'section-items'));
  // the aside slides in: wait for it to settle before measuring
  await expect.poll(async () => (await box(sidebar(page))).right).toBeLessThanOrEqual(items.right + 1);
  const side = await box(sidebar(page));
  expect(side.y).toBeGreaterThan((await box(part(page, 'items-toolbar'))).y);
  // a facet filters the list and the toolbar count says so
  const different = sidebar(page).getByRole('button', { name: 'Different outputs' }).first();
  await different.click();
  await expect(different).toHaveAttribute('aria-pressed', 'true');
  // Clear all clears the filters and leaves the sidebar as the reader had it
  await sidebar(page).getByRole('button', { name: 'Clear all' }).click();
  await expect(sidebar(page)).toBeVisible();
  // Hide closes it, focus returns to the toolbar button
  await sidebar(page).getByRole('button', { name: 'Hide quick filters' }).click();
  await expect(sidebar(page)).toHaveCount(0);
  await expect(facetsBtn(page)).toHaveAttribute('aria-expanded', 'false');
  expect((await widths()).list).toBe(closed.list);
});

test('H2: below 1200 px the facet list is a drawer; Escape closes it and focus returns to the button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(compareUrl(four()));
  await waitLoaded(page);
  const before = (await box(part(page, 'item-list'))).w;
  await facetsBtn(page).focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Quick filters' });
  await expect(drawer).toBeVisible();
  expect((await box(part(page, 'item-list'))).w, 'the drawer does not squeeze the list').toBe(before);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(facetsBtn(page)).toBeFocused();
});

for (const hash of ['#errors', '?panel=errors', '#categories', '#items']) {
  test(`deep link ${hash} lands with the section under the nav`, async ({ page }) => {
    const url = compareUrl(four());
    await page.goto(hash.startsWith('#') ? `${url}${hash}` : `${url}&${hash.slice(1)}`);
    await waitLoaded(page);
    const id = hash.replace(/^#|^\?panel=/, '');
    const section = page.locator(`#compare-${id}`);
    const nav = page.getByRole('navigation', { name: 'Comparison sections' });
    await expect
      .poll(
        async () => {
          const n = (await nav.boundingBox())!;
          const sec = (await section.boundingBox())!;
          return Math.abs(sec.y - (n.y + n.height));
        },
        { timeout: 6000 },
      )
      .toBeLessThan(120);
  });
}

test('removing a run keeps the reading position', async ({ page }) => {
  // the run cards carry the remove buttons; the page keeps its position when the run set reloads
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(compareUrl(four()));
  await waitLoaded(page);
  await goSection(page, 'Runs');
  await expect(page.locator('#compare-runs')).toBeInViewport();
  const before = await page.evaluate(() => document.getElementById('shell-content')!.scrollTop);
  expect(before).toBeGreaterThan(50);
  await page
    .getByRole('button', { name: /^Remove .* from the comparison$/ })
    .last()
    .click();
  await waitLoaded(page);
  await expect(page.getByTestId('run-card')).toHaveCount(3);
  await expect
    .poll(async () => page.evaluate(() => document.getElementById('shell-content')!.scrollTop))
    .toBeGreaterThan(before - 60);
});
