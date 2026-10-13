/** Compare: scope sidebar, deep-link landing position, removing a run keeps the scroll position. */
import { test, expect, type Page } from '@playwright/test';
import { compareUrl, seedScenario, waitLoaded, goSection } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-scope');
});

const four = () => [seed.runs.base, seed.runs.a, seed.runs.b, seed.runs.c];
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Quick filters' });

test('a search opens the scope bar and the sidebar with the Active group; Clear all closes both', async ({
  page,
}) => {
  await page.goto(compareUrl(four()));
  await waitLoaded(page);
  await expect(page.getByTestId('scope-bar')).toHaveCount(0);
  await expect(sidebar(page)).toHaveCount(0);
  await page.goto(compareUrl(four(), { q: 'policy' }));
  await waitLoaded(page);
  await expect(page.getByTestId('scope-bar')).toBeVisible();
  await expect(sidebar(page).getByRole('group', { name: 'Active filters' })).toBeVisible();
  await sidebar(page).getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByTestId('scope-bar')).toHaveCount(0);
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
  // a tall viewport keeps the run chips stuck, so the chip can be pressed without scrolling up
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(compareUrl(four()));
  await waitLoaded(page);
  await goSection(page, 'Categories');
  await expect(page.locator('#compare-categories')).toBeInViewport();
  const before = await page.evaluate(() => document.getElementById('shell-content')!.scrollTop);
  expect(before).toBeGreaterThan(300);
  await page
    .getByRole('button', { name: /^Remove .* from the comparison$/ })
    .last()
    .click();
  await waitLoaded(page);
  await expect(page.getByTestId('run-card')).toHaveCount(3);
  await expect
    .poll(async () => page.evaluate(() => document.getElementById('shell-content')!.scrollTop))
    .toBeGreaterThan(before - 400);
});
