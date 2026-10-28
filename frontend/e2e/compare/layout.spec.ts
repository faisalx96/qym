/** Scenario 12: a 20-run comparison must not scroll the page sideways; the run key and every row's chips show all 20 runs. */
import { expect, test } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { client, compareUrl, waitLoaded } from './support';
import { noSidewaysScroll, part } from './r8';
import { createApiKey, ensureProject, seedCompareRun } from './seed';

const ids: string[] = [];
test.beforeAll(async () => {
  test.setTimeout(180_000);
  const project = await ensureProject(client, 'Compare 20', uniqueSlug('cmp-20'));
  const token = await createApiKey(client, project.id);
  for (let i = 0; i < 20; i++) {
    ids.push(
      await seedCompareRun(client, token, {
        name: `run-${i + 1}`,
        model: `vendor/model-${String(i + 1).padStart(2, '0')}`,
        skill: ((i % 7) - 3) / 20,
        items: 10,
        seed: 100 + i,
        taskErrors: i % 5 === 0 ? [2] : [],
      }),
    );
  }
});

const LETTERS = 'ABCDEFGHIJKLMNOPQRST'.split('');

for (const width of [1440, 1024]) {
  test(`20 runs at ${width}px: no horizontal page scroll and all 20 runs keyed and charted as chips`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(compareUrl(ids));
    await waitLoaded(page);
    await expect(page.getByText('20 columns')).toBeVisible();
    await expect(page.getByTestId('item-row')).toHaveCount(10);
    const overflow = () =>
      page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        bw: document.body.scrollWidth,
        iw: window.innerWidth,
      }));
    await expect.poll(async () => (await overflow()).sw).toBeLessThanOrEqual(width);
    expect((await overflow()).bw).toBeLessThanOrEqual(width);
    // the window itself cannot be scrolled sideways
    await page.evaluate(() => window.scrollTo(500, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);

    // the run key above the list names every run with its letter A..T; each row has one score chip per run
    const key = page.locator('[data-part="run-key"] [data-part="run-letter"]');
    expect(await key.allTextContents()).toEqual(LETTERS);
    await expect(page.getByTestId('item-row').first().locator('[data-part="item-score-chip"]')).toHaveCount(20);
    // the Averages table scrolls inside its own region, never the page
    const [sw, cw] = await part(page, 'averages-table').evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(sw).toBeGreaterThan(cw);
    await noSidewaysScroll(page);
    expect((await overflow()).sw).toBeLessThanOrEqual(width);
  });
}

test('20 runs: an expanded item shows 8 cards and "Show all 20 runs" reveals the rest without horizontal page scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(compareUrl(ids));
  await waitLoaded(page);
  await page.locator('[data-part="item-head"]').first().click();
  await expect(page.getByTestId('output-card')).toHaveCount(8);
  await page.getByRole('button', { name: 'Show all 20 runs' }).click();
  await expect(page.getByTestId('output-card')).toHaveCount(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});
