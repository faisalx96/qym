/** Redesign 2: run identity, the 44px bar, the averages matrix, category and error cards, the item pane, run focus. */
import { expect, test, type Page } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { axeSeriousViolations } from '../shell/support';
import {
  averagesGrid,
  client,
  compareUrl,
  goSection,
  itemDetail,
  itemPane,
  paneOutputs,
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
  const found = await axeSeriousViolations(page, '[data-testid="compare-page"]');
  // an open item pane is in a portal on the body, outside the page element: scan it too
  if (await itemPane(page).count())
    found.push(...(await axeSeriousViolations(page, '[data-testid="item-pane"]')));
  return found.map((v: { id: string; nodes: unknown[] }) => `${v.id} x${v.nodes.length}`);
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
    test(`the sticky nav is one 36px row with ${n} runs and stays stuck`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto(compareUrl(n === 4 ? four() : eight));
      await waitLoaded(page);
      const bar = page.locator('[data-compare-sticky]');
      const h = (await bar.boundingBox())!.height;
      expect(h).toBeLessThanOrEqual(37);
      await page.getByTestId('item-list').scrollIntoViewIfNeeded();
      const top = (await bar.boundingBox())!.y;
      expect(top).toBeLessThan(60);
      await expect(page.getByRole('navigation', { name: 'Comparison sections' })).toBeVisible();
    });
  }

  test('run cards at 8 runs keep the full 4-up card and are always visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(eight));
    await waitLoaded(page);
    const cards = page.getByTestId('run-card');
    await expect(cards).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'Run details' })).toHaveCount(0);
    const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(new Set(boxes.map((t) => Math.round(t))).size).toBe(2); // 4 across: 2 rows, the same card as at 4 runs
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
    await expect(card.locator('[data-part="category-tick"]')).toHaveCount(3);
    await card.click();
    await expect(page.getByTestId('baseline-delta-banner')).toContainText('easy');
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
    await expect(card.getByTestId('error-run').nth(1)).toContainText(/[+−=]/);
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

test.describe('item pane', () => {
  const open = async (page: Page, runs = four()) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(runs));
    await waitLoaded(page);
    await page.locator('[data-testid="item-row"]').first().click();
    const id = (await page.getByTestId('item-row').first().getAttribute('data-item-id'))!;
    await expect(paneOutputs(itemDetail(page, id))).toHaveCount(runs.length);
    return itemDetail(page, id);
  };

  test('one button opens the details of a metric for every run; the same button closes them; Escape closes the pane', async ({
    page,
  }) => {
    const detail = await open(page);
    const show = detail.getByRole('button', { name: 'Show the details of quality', exact: true });
    // the details are closed until the reader opens them
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await expect(detail.locator('[data-part="metric-details"]')).toHaveCount(0);
    await show.click();
    const hide = detail.getByRole('button', { name: 'Hide the details of quality', exact: true });
    await expect(hide).toHaveAttribute('aria-expanded', 'true');
    // one details row under the metric, with one group for each run that scored it
    const details = detail.locator('[data-part="metric-details"]');
    await expect(details).toHaveCount(1);
    await expect(details.getByRole('group', { name: /^Details of quality, / })).toHaveCount(4);
    await hide.click();
    await expect(details).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
  });

  test('output chips hide an output; one stays on; All restores; "Only the ones that differ from the baseline" keeps the outputs that differ', async ({
    page,
  }) => {
    const detail = await open(page);
    // above three runs: one on/off chip for each output
    const chips = detail.getByRole('group', { name: 'Outputs in view' }).getByRole('button');
    await expect(chips).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(chips.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await expect(paneOutputs(detail)).toHaveCount(3);
    for (const i of [0, 2]) await chips.nth(i).click();
    await expect(paneOutputs(detail)).toHaveCount(1);
    // the last output stays on: its chip is locked (aria-disabled)
    await expect(chips.nth(3)).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.nth(3)).toHaveAttribute('aria-disabled', 'true');
    await detail.getByRole('button', { name: 'All', exact: true }).click();
    await expect(paneOutputs(detail)).toHaveCount(4);
    await detail.getByRole('button', { name: 'Only the ones that differ from the baseline' }).click();
    const n = await paneOutputs(detail).count();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(4);
  });

  test('two runs: no output chips; Expected and each output have a tone rail; the baseline output has the Baseline mark', async ({
    page,
  }) => {
    const { base, a } = seed.runs;
    const detail = await open(page, [base, a]);
    await expect(detail.getByRole('group', { name: 'Outputs in view' })).toHaveCount(0);
    // Expected is gold; an output is green only when it passed and red when it failed
    await expect(detail.locator('section[data-part="expected"]')).toHaveAttribute('data-tone', 'gold');
    for (const out of await paneOutputs(detail).all())
      await expect(out).toHaveAttribute('data-tone', /^(success|danger|neutral)$/);
    await expect(detail.locator('[data-part="baseline-tag"]').first()).toBeVisible();
    await expect(
      detail.getByRole('radiogroup', { name: 'Mark the differences from' }).getByRole('radio'),
    ).toHaveCount(3);
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
  test('run card head: status badge and remove button share the first row at 1440 with four runs', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    const gaps = await page.getByTestId('run-card').evaluateAll((els) =>
      els.map((e) => {
        const status = e.querySelector('[data-part="run-status"]')!.getBoundingClientRect();
        const remove = e.querySelector('[data-part="run-remove"]')!.getBoundingClientRect();
        return Math.abs(status.top + status.height / 2 - (remove.top + remove.height / 2));
      }),
    );
    expect(Math.max(...gaps)).toBeLessThanOrEqual(8);
  });

  test('the outputs of four runs fit the width of the item pane at 1440', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    await page.getByTestId('item-row').first().click();
    const pane = itemPane(page);
    await expect(paneOutputs(pane)).toHaveCount(4);
    const g = (await pane.boundingBox())!;
    for (const out of await paneOutputs(pane).all()) {
      const o = (await out.boundingBox())!;
      expect(o.x).toBeGreaterThanOrEqual(g.x);
      expect(o.x + o.width).toBeLessThanOrEqual(g.x + g.width + 1);
    }
    // the pane leaves the start of the list in view and the page does not scroll sideways
    expect(g.x).toBeGreaterThanOrEqual(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
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
    await expect(
      cards.filter({ has: page.locator('[data-part="run-letter"]', { hasText: /^A\d$/ }) }),
    ).toHaveCount(2);
    await expect(
      cards.filter({ has: page.locator('[data-part="run-letter"]', { hasText: /^B\d$/ }) }),
    ).toHaveCount(2);
  });

  test('390px: the sticky bar holds the links, then the page controls on a second row; the Baseline select sits by the page title', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    const bar = page.locator('[data-compare-sticky]');
    await expect(bar.getByRole('link')).toHaveCount(6);
    // K6 (C154): Metric, the slider and Filters wrap under the links
    const controls = bar.locator('[data-part="page-controls"]');
    expect((await controls.boundingBox())!.y).toBeGreaterThan(
      (await bar.getByRole('link').first().boundingBox())!.y,
    );
    await expect(page.locator('[data-part="title-block"] [data-part="baseline-control"]')).toBeVisible();
  });
});

test.describe('accessibility and phone', () => {
  for (const [n, runs] of [
    [4, () => four()],
    [8, () => eight],
  ] as const) {
    test(`axe: ${n} runs with the item pane and its metric details open`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(compareUrl(runs()));
      await waitLoaded(page);
      await page.getByTestId('item-row').first().click();
      const pane = itemPane(page);
      await expect(paneOutputs(pane)).toHaveCount(n);
      // up to four runs the Metrics table has a row for each metric; above four it has a row for each run
      await pane.getByRole('button', { name: /^Show the details of every (metric|run)$/ }).click();
      await expect(pane.locator('[data-part="metric-details"]').first()).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }

  test('390px: stacked cards, averages as cards, the outputs of the pane stacked, no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(compareUrl(four()));
    await waitLoaded(page);
    await expect(page.locator('[data-part="averages-table"] section[data-row]')).toHaveCount(4);
    await page.getByTestId('item-row').first().click();
    await expect(paneOutputs(itemPane(page))).toHaveCount(4);
    const tops = await paneOutputs(itemPane(page)).evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // the pointer rests where the click left it; after the section panel moved the lists it sits over an error row, whose siblings dim (--dim-opacity)
    await page.mouse.move(0, 0);
    expect(await axe(page)).toEqual([]);
  });
});
