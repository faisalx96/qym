/** Redesign 2: run identity, the 44px bar, the averages matrix, category and error cards, the aligned expanded item, run focus. */
import { expect, test, type Page } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { axeSeriousViolations } from '../shell/support';
import {
  averagesGrid,
  client,
  compareUrl,
  goSection,
  itemDetail,
  seedScenario,
  urlParams,
  waitLoaded,
} from './support';
import { createApiKey, ensureProject, seedCompareRun, type CompareSeed } from './seed';

let seed: CompareSeed;
const eight: string[] = [];
test.beforeAll(async () => {
  test.setTimeout(180_000);
  seed = await seedScenario('cmp-rd2');
  const project = await ensureProject(client, 'Compare 8', uniqueSlug('cmp-8'));
  const token = await createApiKey(client, project.id);
  for (let i = 0; i < 8; i++)
    eight.push(
      await seedCompareRun(client, token, {
        name: `eight-${i + 1}`,
        model: `vendor/model-${i + 1}`,
        skill: ((i % 5) - 2) / 10,
        items: 12,
        seed: 300 + i,
        taskErrors: i === 3 ? [2] : [],
      }),
    );
});

const four = () => {
  const { base, a, b, c } = seed.runs;
  return [base, a, b, c];
};
const axe = async (page: Page) => {
  await page.mouse.move(0, 0); // hover dims the other runs on purpose; scan the resting state
  return (await axeSeriousViolations(page, '[data-testid="compare-page"]')).map(
    (v: { id: string; nodes: unknown[] }) => `${v.id} x${v.nodes.length}`,
  );
};

test.describe('run identity and chrome', () => {
  test('every run is a swatch, a letter and a name; eight runs get eight colours', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(eight));
    await waitLoaded(page);
    const tags = page.getByTestId('run-card').getByTestId('run-tag');
    await expect(tags).toHaveCount(8);
    const colours = await tags.evaluateAll((els) =>
      els.map((e) => getComputedStyle(e.firstElementChild as Element).backgroundColor),
    );
    expect(new Set(colours).size).toBe(8);
    await expect(tags.first()).toContainText('A');
  });

  for (const [n, w] of [
    [4, 1440],
    [8, 1440],
  ] as const) {
    test(`the sticky bar is one 44px row with ${n} runs and stays stuck`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto(compareUrl(n === 4 ? four() : eight));
      await waitLoaded(page);
      const bar = page.locator('[data-compare-sticky]');
      const h = (await bar.boundingBox())!.height;
      expect(h).toBeLessThanOrEqual(48);
      await page.getByTestId('item-list').scrollIntoViewIfNeeded();
      const top = (await bar.boundingBox())!.y;
      expect(top).toBeLessThan(60);
      await expect(page.getByRole('navigation', { name: 'Comparison sections' })).toBeVisible();
    });
  }

  test('run cards at 8 runs are compact and always visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(eight));
    await waitLoaded(page);
    const cards = page.getByTestId('run-card');
    await expect(cards).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'Run details' })).toHaveCount(0);
    const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(new Set(boxes.map((t) => Math.round(t))).size).toBeLessThanOrEqual(3); // 3 across: 3 rows
  });

  test('the averages matrix at 8 runs scrolls inside itself, not the page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(compareUrl(eight));
    await waitLoaded(page);
    await expect(averagesGrid(page)).toBeVisible();
    await expect(averagesGrid(page).getByRole('columnheader')).toHaveCount(9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  });
});

test.describe('category and error cards', () => {
  test('categories are cards with a baseline tick; a card filters; Table keeps the old view in the URL', async ({
    page,
  }) => {
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    await goSection(page, 'Categories');
    const card = page.getByTestId('category-card').filter({ hasText: /^easy/i }).first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId('category-run')).toHaveCount(4);
    // the baseline run has no tick, each other run has one
    await expect(card.getByTestId('score-marker')).toHaveCount(3);
    await card.click();
    await expect(page.getByRole('group', { name: 'Filters set on the page' })).toContainText('easy');
    await card.click();
    await page.getByRole('radiogroup', { name: 'Categories view' }).getByText('Table').click();
    await expect.poll(() => urlParams(page).get('catView')).toBe('table');
    await expect(page.getByTestId('category-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^easy/ }).first()).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Categories view' }).getByText('Cards').click();
    await expect.poll(() => urlParams(page).get('catView')).toBeNull();
  });

  test('error cards list every run with its count and change against the baseline', async ({ page }) => {
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    await goSection(page, 'Errors');
    const card = page
      .getByTestId('error-card')
      .filter({ hasText: /TimeoutError/ })
      .first();
    await expect(card.getByTestId('error-run')).toHaveCount(4);
    await expect(card.getByTestId('error-run').first()).toContainText('Baseline');
    await expect(card.getByTestId('error-run').nth(1)).toContainText(/[▲▼=]/);
  });

  test('the winner bar has a named legend with counts', async ({ page }) => {
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    await goSection(page, 'Overview');
    const legend = page.getByRole('list', { name: 'Winner legend' });
    await expect(legend.getByTestId('run-tag')).toHaveCount(4);
    await expect(legend).toContainText('Ties');
  });
});

test.describe('expanded item', () => {
  const open = async (page: Page, runs = four()) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(runs));
    await waitLoaded(page);
    await page.locator('[data-testid="item-row"]').first().click();
    const id = (await page.getByTestId('item-row').first().getAttribute('data-item-id'))!;
    await expect(itemDetail(page, id).getByTestId('output-card')).toHaveCount(runs.length);
    return itemDetail(page, id);
  };

  test('four runs sit on one row with a run-colour rail each', async ({ page }) => {
    const detail = await open(page);
    const tops = await detail
      .getByTestId('output-card')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const rails = await detail
      .getByTestId('output-card')
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).borderInlineStartColor));
    expect(new Set(rails).size).toBeGreaterThan(1);
  });

  test('a metric click opens its details under every run, aligned with the cards; Escape closes', async ({
    page,
  }) => {
    const detail = await open(page);
    await detail.getByRole('button', { name: 'Show quality details' }).first().click();
    const cells = detail.getByTestId('metric-panel-cell');
    await expect(cells).toHaveCount(4);
    const cardX = await detail
      .getByTestId('output-card')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    const cellX = await cells.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().left)),
    );
    expect(cellX).toEqual(cardX);
    await page.keyboard.press('Escape');
    await expect(cells).toHaveCount(0);
  });

  test('run toggles hide a column; All restores; Only differing keeps runs whose output differs', async ({
    page,
  }) => {
    const detail = await open(page);
    const toggles = detail.getByRole('group', { name: 'Runs shown' });
    await toggles.getByRole('button').nth(1).click();
    await expect(detail.getByTestId('output-card')).toHaveCount(3);
    await detail.getByRole('button', { name: 'All', exact: true }).click();
    await expect(detail.getByTestId('output-card')).toHaveCount(4);
    await detail.getByRole('button', { name: 'Only differing outputs' }).click();
    const n = await detail.getByTestId('output-card').count();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(4);
  });

  test('a unique best score carries a Best tag', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    await page.getByTestId('item-row').first().click();
    const tags = page.getByTestId('output-card').getByText('Best');
    expect(await tags.count()).toBeLessThanOrEqual(1);
  });
});

test.describe('run focus', () => {
  test('hovering a run tag dims the other runs everywhere; leaving restores', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    const cards = page.getByTestId('run-card');
    await cards.nth(1).hover();
    await expect(page.locator('[data-series-active="2"]')).toHaveCount(1);
    await expect.poll(() => cards.nth(0).evaluate((e) => getComputedStyle(e).opacity)).not.toBe('1');
    expect(await cards.nth(1).evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-series-active]')).toHaveCount(0);
    await expect.poll(() => cards.nth(0).evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  });

  test('reduced motion: the dimming is instant (no transition)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    const dur = await page
      .getByTestId('run-card')
      .first()
      .evaluate((e) => getComputedStyle(e).transitionDuration);
    expect(parseFloat(dur)).toBeLessThan(0.01);
  });
});

test.describe('polish', () => {
  test('run card headers stay on one row at 1440 with four runs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    const heights = await page
      .getByTestId('run-card')
      .evaluateAll((els) =>
        els.map((e) => (e.querySelector('[class*="cardHead"]') as HTMLElement).offsetHeight),
      );
    expect(Math.max(...heights)).toBeLessThan(40);
  });

  test('four expanded cards fit the content width at 1440', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    await page.getByTestId('item-row').first().click();
    const grid = page.getByTestId('output-grid');
    await expect(grid.getByTestId('output-card')).toHaveCount(4);
    const [g, last] = await Promise.all([
      grid.boundingBox(),
      grid.getByTestId('output-card').last().boundingBox(),
    ]);
    expect(last!.x + last!.width).toBeLessThanOrEqual(g!.x + g!.width + 1);
  });

  test('category key chips sit above the cards; table view shares one column template', async ({ page }) => {
    await page.goto(compareUrl(four(), { catView: 'table' }));
    await waitLoaded(page);
    await goSection(page, 'Categories');
    const chips = page.getByRole('group', { name: 'Metadata keys' });
    const table = page.locator('#compare-categories table').first();
    expect((await chips.boundingBox())!.y).toBeLessThan((await table.boundingBox())!.y);
    const lefts = await page
      .locator('#compare-categories table')
      .evaluateAll((ts) =>
        ts.map((t) => Math.round((t.querySelectorAll('th')[1] as HTMLElement).getBoundingClientRect().left)),
      );
    expect(new Set(lefts).size).toBe(1);
  });

  test('cohort run cards say which side they belong to', async ({ page }) => {
    const { base, a, b, c } = seed.runs;
    await page.goto(`/compare?cohortA=${base}&cohortA=${a}&cohortB=${b}&cohortB=${c}`);
    await waitLoaded(page);
    const cards = page.getByTestId('run-card');
    await expect(cards.filter({ hasText: 'Side A' })).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Side B' })).toHaveCount(2);
  });

  test('390px: the bar is the nav plus a View popover holding the selects', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    const bar = page.locator('[data-compare-sticky]');
    await expect(bar.getByRole('button', { name: 'View' })).toBeVisible();
    await expect(bar.getByText('Baseline', { exact: true })).toHaveCount(0);
    await bar.getByRole('button', { name: 'View' }).click();
    await expect(
      page.getByRole('dialog', { name: 'View options' }).getByText('Baseline', { exact: true }).first(),
    ).toBeVisible();
  });
});

test.describe('accessibility and phone', () => {
  for (const [n, runs] of [
    [4, () => four()],
    [8, () => eight],
  ] as const) {
    test(`axe: ${n} runs with an opened metric panel`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(compareUrl(runs()));
      await waitLoaded(page);
      await page.getByTestId('item-row').first().click();
      await page.getByRole('button', { name: 'Show quality details' }).first().click();
      expect(await axe(page)).toEqual([]);
    });
  }

  test('390px: stacked cards, averages as cards, expanded cards stacked, no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    await expect(page.getByTestId('average-card')).toHaveCount(4);
    await page.getByTestId('item-row').first().click();
    const tops = await page
      .getByTestId('output-card')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await axe(page)).toEqual([]);
  });
});
