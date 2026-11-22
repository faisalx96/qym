/** J4 + scenario 10: repeat runs (samples=3): analysis tab, ?pass=N, heatmap layout, pass columns, latency filter. */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  itemButton,
  itemPane,
  itemRow,
  itemsCount,
  metricRow,
  metricTable,
  openRun,
  paneBlock,
  params,
  seedProject,
  seedRepeat,
  type Seeded,
} from './support';

let s: Seeded;
let repeat: string;

test.beforeAll(async () => {
  s = await seedProject('rd-repeat');
  repeat = await seedRepeat(s);
});

/** The pass toggles of a multi-pass item: any number of passes in view, one output column each (17 Nov I1). */
const passSwitch = (pane: Locator) => pane.getByRole('group', { name: 'Passes in view' });
const passChip = (pane: Locator, n: number) =>
  passSwitch(pane).getByRole('button', { name: new RegExp(`^Pass ${n}\\b`) });

/** Put pass n alone in view with the pass toggles and wait until the one Output block is the one of that pass. */
async function showPass(pane: Locator, n: number): Promise<void> {
  if ((await passChip(pane, n).getAttribute('aria-pressed')) !== 'true') await passChip(pane, n).click();
  const chips = passSwitch(pane).getByRole('button', { name: /^Pass \d+/ });
  for (const chip of await chips.all()) {
    const name = (await chip.textContent()) ?? '';
    if (!name.startsWith(`Pass ${n}`) && (await chip.getAttribute('aria-pressed')) === 'true')
      await chip.click();
  }
  await expect(paneBlock(pane, 'output')).toHaveCount(1);
  await expect(paneBlock(pane, 'output')).toHaveAttribute('aria-label', `Output of pass ${n}`);
}

/** Text of the "quality" column for the visible rows of the table, keyed by item number. */
async function qualityByItem(page: Page): Promise<Record<string, string>> {
  const rows = page.locator('tr[data-item-id]');
  const out: Record<string, string> = {};
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const text = await rows.nth(i).innerText();
    const num = /#(\d+)/.exec(text)?.[1];
    const pct = /(\d+(?:\.\d+)?%)/.exec(text.replace(/\n/g, ' '))?.[1];
    if (num && pct) out[num] = pct;
  }
  return out;
}

test.describe('repeat analysis (J4)', () => {
  test('the Repeat section shows pass@k stats, per-pass table, curve and distribution', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'panel=repeat');
    const panel = page.getByTestId('repeat-analysis');
    await expect(panel).toBeVisible();
    await expect(page.locator('#run-section-repeat')).toBeInViewport();
    await expect(panel).toContainText('Pass@3');
    await expect(panel).toContainText('Consistency');
    const passes = panel.getByRole('grid', { name: 'Passes' });
    await expect(passes.getByRole('link', { name: 'Open pass 2' })).toHaveAttribute('href', /\?pass=2/);
    await expect(panel.getByRole('region', { name: 'Performance across attempts' })).toBeVisible();
    // the curve can be shown as a table
    await panel.getByRole('radio', { name: 'Table' }).click({ force: true });
    await expect(panel.getByRole('radio', { name: 'Table' })).toBeChecked();
    // switching metric (a Select since round 3) re-renders and writes ?metric=
    await panel
      .getByRole('button', { name: /Metric/ })
      .first()
      .click();
    await page.getByRole('option', { name: 'quality' }).click();
    await expect.poll(() => params(page).get('metric')).toBe('quality');
  });

  test('a distribution bar filters the items to "N of 3 passes passed"', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'panel=repeat');
    const bar = page
      .getByRole('group', { name: 'Items by number of passes that passed' })
      .getByRole('button', {
        name: /3 of 3 passes passed/,
      });
    await bar.click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(60);
    expect((await itemsCount(page))[0]).toBe(33);
    await expect.poll(() => params(page).get('filters') ?? '').toContain('repeat');
    await page.getByTestId('nav-clear-filters').click();
    await expect.poll(() => itemsCount(page)).toEqual([60, 60]);
  });

  test('the Repeat section is absent on a single-pass view', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'pass=2');
    await expect(page.locator('#run-section-repeat')).toHaveCount(0);
  });
});

test.describe('?pass=N (scenario 10)', () => {
  test('?pass=2 shows "Pass 2/3" and per-pass values', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'pass=1');
    await expect(page.getByText('Pass 1/3').first()).toBeVisible();
    const p1 = await qualityByItem(page);
    expect(Object.keys(p1).length).toBeGreaterThan(5);
    await openRun(page, s.slug, repeat, 'pass=2');
    await expect(page.getByText('Pass 2/3').first()).toBeVisible();
    await expect(page).toHaveTitle(/Pass 2/);
    const p2 = await qualityByItem(page);
    const common = Object.keys(p1).filter((k) => k in p2 && k !== '1');
    expect(common.length).toBeGreaterThan(5);
    expect(common.some((k) => p1[k] !== p2[k])).toBe(true);
    // item #1 failed in pass 2 only
    await expect(itemRow(page, 1)).toContainText('Error');
    await openRun(page, s.slug, repeat, 'pass=1');
    await expect(itemRow(page, 1)).not.toContainText('Error');
  });

  test("an opened item in ?pass=3 shows that pass' metric rows and its output, with no pass switch", async ({
    page,
  }) => {
    await openRun(page, s.slug, repeat, 'pass=3&item=sql-006');
    const card = itemPane(page, 'sql-006');
    await expect(card).toBeVisible();
    await expect(metricRow(card, 'correct')).toBeVisible();
    await expect(metricRow(card, 'quality')).toBeVisible();
    await expect(paneBlock(card, 'output')).toContainText(/SELECT\s+name\s+FROM\s+customers/);
    // one pass in view: one Score column, no column for each pass and no pass switch
    await expect(metricTable(card).getByRole('columnheader', { name: 'Score', exact: true })).toBeVisible();
    await expect(passSwitch(card)).toHaveCount(0);
    await expect.poll(() => params(page).get('pass')).toBe('3');
  });

  test('the "Pass N/M" pill links back to all passes', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'pass=2');
    const hero = page.getByRole('region', { name: 'Run summary' });
    const pill = hero.getByRole('link', { name: 'Pass 2/3' });
    await expect(pill).toHaveAttribute('title', /Return to all passes/);
    await pill.click();
    await expect.poll(() => params(page).get('pass')).toBeNull();
    await expect(page.locator('#run-section-repeat')).toBeAttached();
    await expect(page).not.toHaveTitle(/Pass 2/);
  });
});

test.describe('all-passes item pane', () => {
  test('shows an output column and a score column for each pass in view, and the trace of the first pass in view', async ({
    page,
  }) => {
    await openRun(page, s.slug, repeat);
    await itemButton(page, 2).click();
    const card = itemPane(page, 'sql-002');
    await expect(card).toBeVisible();
    // a run of 3 passes: the pane opens with every pass in view, one Output column each
    await expect(passSwitch(card).getByRole('button')).toHaveCount(3);
    for (const n of [1, 2, 3]) await expect(passChip(card, n)).toHaveAttribute('aria-pressed', 'true');
    await expect(paneBlock(card, 'output')).toHaveCount(3);
    await expect(paneBlock(card, 'output').first()).toHaveAttribute('aria-label', 'Output of pass 1');
    await expect(card.getByRole('button', { name: 'Copy the output of pass 1', exact: true })).toBeVisible();
    // the Metrics table: a column for each pass in view, then the mean
    const table = metricTable(card);
    await expect(table.getByRole('columnheader', { name: /^Pass \d/ })).toHaveCount(3);
    await expect(table.getByRole('columnheader', { name: 'Mean', exact: true })).toBeVisible();
    // one pass in view: its reasons show in a column of their own
    await showPass(card, 3);
    await expect(table.getByRole('columnheader', { name: /^Pass \d/ })).toHaveCount(1);
    await expect(table.getByRole('columnheader', { name: /^Pass 3/ })).toBeVisible();
    // the seed gives sql-002 no judge reasons, so the table has no Reason column
    await expect(table.getByRole('columnheader', { name: /^Reason/ })).toHaveCount(0);
    await showPass(card, 2);
    // the Open trace tile opens the trace of the pass in view (the seed gives a trace to each third item only)
    await card.getByRole('button', { name: 'Close item', exact: true }).click();
    await expect(card).toHaveCount(0);
    await itemButton(page, 1).click();
    const first = itemPane(page, 'sql-001');
    await showPass(first, 3);
    await first.getByRole('button', { name: 'Open trace', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Trace' })).toBeVisible();
    await expect.poll(() => params(page).get('trace')).toBe('sql-001');
    await expect.poll(() => params(page).get('trace_pass')).toBe('3');
  });
});

test.describe('heatmap layout (scenario 10, J4.5)', () => {
  test('Display > Layout Heatmap sets ?view=heatmap and renders item x pass cells', async ({ page }) => {
    await openRun(page, s.slug, repeat);
    await page.getByRole('button', { name: 'Display' }).click();
    await page.getByRole('radiogroup', { name: 'Layout' }).getByText('Heatmap').click();
    await expect.poll(() => params(page).get('view')).toBe('heatmap');
    const grid = page.getByRole('grid', { name: /by item and pass/ });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: 'Pass 3' })).toBeVisible();
    const rows = await grid.getByRole('row').count();
    expect(rows).toBeGreaterThan(3);
    // the heatmap is virtualized: the 60 items are not all in the DOM at once
    expect(rows).toBeLessThanOrEqual(61);
    await page.keyboard.press('Escape');
    // reload keeps the layout
    await page.reload();
    await expect(page.getByRole('grid', { name: /by item and pass/ })).toBeVisible();
    expect(params(page).get('view')).toBe('heatmap');
  });

  test('?view=heatmap deep link renders cells; a failed pass is marked and a cell opens the item', async ({
    page,
  }) => {
    await openRun(page, s.slug, repeat, 'view=heatmap');
    const grid = page.getByRole('grid', { name: /by item and pass/ });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('button', { name: 'Item #1 pass 2: error' })).toBeVisible();
    await grid.getByRole('button', { name: 'Item #2 pass 1: True' }).click();
    await expect(itemPane(page, 'sql-002')).toBeVisible();
    await expect.poll(() => params(page).get('item')).toBe('sql-002');
    expect(params(page).get('view')).not.toBe('heatmap');
  });
});

test.describe('heatmap readability (final review F6)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the item column is capped, rows light up on hover, and 30 rows show before "Show more"', async ({
    page,
  }) => {
    await openRun(page, s.slug, repeat, 'view=heatmap');
    const grid = page.getByRole('grid', { name: /by item and pass/ });
    await expect(grid).toBeVisible();
    // the block is as wide as its columns, not the 1100 px of the page
    expect((await grid.boundingBox())!.width).toBeLessThan(640);
    const first = grid.locator('[data-heat-row]').first();
    const idle = await first.evaluate((el) => getComputedStyle(el).backgroundColor);
    await first.hover();
    await expect.poll(() => first.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(idle);
    // 60 items: the first 30, then a button for 30 more
    await expect(page.getByText('Showing 30 of 60 items')).toBeVisible();
    expect(await grid.locator('[data-heat-row]').count()).toBeLessThanOrEqual(30);
    await page.getByRole('button', { name: 'Show 30 more' }).click();
    await expect(page.getByText('Showing 60 of 60 items')).toBeVisible();
  });
});

test.describe('latency filter (scenario 10)', () => {
  test('a histogram bar on the repeat run sets a latency filter chip', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'panel=latency');
    const bars = page.getByRole('group', { name: /Latency histogram/ }).getByRole('button');
    await expect(bars.first()).toBeVisible();
    const n = await bars.count();
    await bars.nth(Math.floor(n / 2)).click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(60);
    await expect.poll(() => params(page).get('filters') ?? '').toContain('latency');
    await expect(
      page
        .locator('[data-run-filters]')
        .getByText(/(ms|s)/i)
        .first(),
    ).toBeVisible();
    await page.getByTestId('nav-clear-filters').click();
    await expect.poll(() => itemsCount(page)).toEqual([60, 60]);
  });
});

test.describe('loaded bodies survive a rows refetch', () => {
  test('an open item keeps its per-pass outputs after the rows go stale and the page is revisited', async ({
    page,
  }) => {
    // October 2026: the compact refetch replaced the hydrated pass attempts with their stripped form while the row
    // still counted as loaded, so every pass read as if it had no output until the item was reopened.
    test.setTimeout(60_000);
    await openRun(page, s.slug, repeat);
    await itemButton(page, 2).click();
    const card = itemPane(page, 'sql-002');
    const output = paneBlock(card, 'output');
    const everyPassHasItsOutput = async () => {
      for (const n of [1, 2, 3]) {
        await showPass(card, n);
        await expect(output).toContainText(/SELECT\s+name\s+FROM\s+customers/);
        await expect(output.getByText('Nothing was recorded')).toHaveCount(0);
      }
    };
    await everyPassHasItsOutput();
    // past staleTime (10 s), a revisit refetches the compact rows over the cached, hydrated ones
    await page.waitForTimeout(11_000);
    const refetch = page.waitForRequest((r) => /view=compact&fields=/.test(r.url()));
    await page.getByRole('link', { name: /Runs/ }).first().click();
    await expect(page.getByRole('link', { name: /Runs/ }).first()).toBeVisible();
    await page.goBack();
    await refetch;
    await expect(card).toBeVisible();
    await everyPassHasItsOutput();
    expect(params(page).get('item')).toBe('sql-002');
  });
});
