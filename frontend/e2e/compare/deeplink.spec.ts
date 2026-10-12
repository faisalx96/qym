/** J2: every URL param restores its control; stale params are ignored. */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl, expectShown, seedScenario, urlParams, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-deep');
});

const inViewport = async (page: Page, sel: string) =>
  page.locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.top < window.innerHeight && r.bottom > 0;
  });

test('a full deep link restores metric, filters, search, sort, page and the open item; reload keeps it', async ({
  page,
}) => {
  const { base, a, b, c } = seed.runs;
  const filters = JSON.stringify({ complexity: ['easy', 'medium'] });
  await page.goto(
    compareUrl([base, a, b, c], {
      metric: 'correct',
      sort: 'score_desc',
      page: '2',
      item: 'cmp-040',
      filters,
      q: 'policy',
    }),
  );
  await waitLoaded(page);
  // search + filters + metric
  await expect(page.getByRole('searchbox', { name: 'Search items' })).toHaveValue('policy');
  await expectShown(page, 27);
  await expect(page.getByRole('group', { name: 'Filters set on the page' })).toContainText(
    'Complexity: easy, medium',
  );
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  await expect(page.getByRole('button', { name: /^correct Metric$/ })).toBeVisible();
  await expect(page.locator('[aria-label="Change against the baseline"]')).toContainText('+17.5 pts');
  // sort in the Display popover
  await page.getByRole('button', { name: 'Display' }).click();
  await expect(page.getByRole('button', { name: /Score, high to low/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // the item: on its page, expanded, scrolled into view
  const row = page.locator('[data-testid="item-row"][data-item-id="cmp-040"]');
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { expanded: true }).first()).toBeVisible();
  await expect(row.getByTestId('item-detail')).toBeVisible();
  // the page param follows the item (score_desc moves cmp-040 off page 2); the rest of the link is kept
  expect(urlParams(page).get('item')).toBe('cmp-040');
  expect(urlParams(page).get('sort')).toBe('score_desc');
  expect(urlParams(page).get('metric')).toBe('correct');

  // reload restores the same state
  await page.reload();
  await waitLoaded(page);
  await expectShown(page, 27);
  await expect(
    page.locator('[data-testid="item-row"][data-item-id="cmp-040"]').getByTestId('item-detail'),
  ).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search items' })).toHaveValue('policy');
  expect(urlParams(page).get('item')).toBe('cmp-040');
});

test("?item= lands on the item's page, expands it and scrolls it into view once", async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c], { page: '2', item: 'cmp-040' }));
  await waitLoaded(page);
  expect(urlParams(page).get('page')).toBe('2');
  await expect(
    page.locator('[data-testid="item-row"][data-item-id="cmp-040"]').getByTestId('item-detail'),
  ).toBeVisible();
  // The late layout-shift correction must not re-scroll a reader who moved away.
  await expect.poll(() => inViewport(page, '#item-cmp-040'), { timeout: 4000 }).toBe(true);
  // once: scrolling away is not undone
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('?filter=errors restores the errors preset as a chip', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c], { filter: 'errors' }));
  await waitLoaded(page);
  await expect(page.getByRole('group', { name: 'Filters set on the page' })).toContainText('With errors');
  await expect
    .poll(async () => {
      const t =
        (await page
          .getByRole('status')
          .filter({ hasText: /of 40 items/ })
          .textContent()) ?? '';
      return Number(/(\d+) of 40/.exec(t)?.[1] ?? 40);
    })
    .toBeLessThan(40);
});

test('a stale or invalid filters JSON is ignored silently', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  for (const bad of [
    '{not json',
    JSON.stringify({
      rules: { op: 'xor', children: 3 },
      baseline: { metric: 'gone', columnKey: 'x', baselineKey: 'y', kind: 'improved' },
      categories: { nope: ['a'] },
    }),
    '[1,2]',
  ]) {
    await page.goto(compareUrl([base, a, b, c], { filters: bad }));
    await waitLoaded(page);
    await expectShown(page, 40);
    await expect(page.getByRole('group', { name: 'Filters set on the page' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});

test('an out-of-range page and an unknown item id do not break the page', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c], { page: '99', item: 'does-not-exist' }));
  await waitLoaded(page);
  await expect(page.getByTestId('item-row')).not.toHaveCount(0);
  await expect(page.getByTestId('item-detail')).toHaveCount(0);
});
