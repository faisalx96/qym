/** J4 + scenario 10: repeat runs (samples=3): analysis tab, ?pass=N, heatmap layout, pass columns, latency filter. */
import { test, expect, type Page } from '@playwright/test';
import { itemButton, itemsCount, openRun, params, seedProject, seedRepeat, type Seeded } from './support';

let s: Seeded;
let repeat: string;

test.beforeAll(async () => {
  s = await seedProject('rd-repeat');
  repeat = await seedRepeat(s);
});

/** Text of the "quality" column for the visible rows of the table, keyed by item number. */
async function qualityByItem(page: Page): Promise<Record<string, string>> {
  const rows = page.getByRole('row').filter({ has: page.getByRole('button', { name: /^Open item #\d+$/ }) });
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
  test('the Repeat tab shows pass@k stats, per-pass table, curve and distribution', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'panel=repeat');
    const panel = page.getByTestId('repeat-analysis');
    await expect(panel).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Repeat' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toContainText('Pass@3');
    await expect(panel).toContainText('Consistency');
    const passes = panel.getByRole('table', { name: 'Passes' });
    await expect(passes.getByRole('link', { name: 'Open pass 2' })).toHaveAttribute('href', /\?pass=2/);
    await expect(panel.getByRole('region', { name: 'Performance across attempts' })).toBeVisible();
    // the curve can be shown as a table
    await panel.getByRole('radio', { name: 'Table' }).click({ force: true });
    await expect(panel.getByRole('radio', { name: 'Table' })).toBeChecked();
    // switching metric re-renders
    await panel.getByRole('radio', { name: 'quality' }).click({ force: true });
    await expect(panel.getByRole('radio', { name: 'quality' })).toBeChecked();
  });

  test('a distribution bar filters the items to "N of 3 passes passed"', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'panel=repeat');
    const bar = page
      .getByRole('group', { name: 'Items by number of passes that passed' })
      .getByRole('button', {
        name: /^3 of 3 passes passed/,
      });
    await bar.click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(60);
    expect((await itemsCount(page))[0]).toBe(33);
    await expect.poll(() => params(page).get('filters') ?? '').toContain('repeat');
    await page.getByTestId('clear-filters').click();
    await expect.poll(() => itemsCount(page)).toEqual([60, 60]);
  });

  test('the Repeat tab is absent on a single-pass view', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'pass=2');
    await expect(page.getByRole('tab', { name: 'Repeat' })).toHaveCount(0);
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
    await expect(page.getByRole('row', { name: /^Open item #1 / })).toContainText('Error');
    await openRun(page, s.slug, repeat, 'pass=1');
    await expect(page.getByRole('row', { name: /^Open item #1 / })).not.toContainText('Error');
  });

  test("an opened item in ?pass=2 shows that pass' chips and its per-pass output", async ({ page }) => {
    await openRun(page, s.slug, repeat, 'pass=3&item=sql-006');
    const card = page.locator('[data-testid=item-card][data-item-id="sql-006"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[role=listitem][data-metric=correct]')).toBeVisible();
    await expect(card.locator('[role=listitem][data-metric=quality]')).toBeVisible();
    await expect(card.locator('[data-kind=output]')).toContainText('SELECT name FROM customers');
    await expect.poll(() => params(page).get('pass')).toBe('3');
  });

  test('the "Pass N/M" pill links back to all passes', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'pass=2');
    const hero = page.getByRole('region', { name: 'Run summary' });
    const pill = hero.getByRole('link', { name: 'Pass 2/3' });
    await expect(pill).toHaveAttribute('title', /Return to all passes/);
    await pill.click();
    await expect.poll(() => params(page).get('pass')).toBeNull();
    await expect(page.getByRole('tab', { name: 'Repeat' })).toBeVisible();
    await expect(page).not.toHaveTitle(/Pass 2/);
  });
});

test.describe('all-passes item card', () => {
  test('shows one output column per pass, with pass toggles and per-pass trace buttons', async ({ page }) => {
    await openRun(page, s.slug, repeat);
    await itemButton(page, 2).click();
    const card = page.locator('[data-testid=item-card][data-item-id="sql-002"]');
    await expect(card).toBeVisible();
    const cols = card.getByRole('group', { name: 'Outputs by pass' }).or(card.getByLabel('Outputs by pass'));
    await expect(cols.first()).toBeVisible();
    await expect(card.getByRole('button', { name: /Show pass \d/ }).first()).toBeVisible();
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
    await expect(page.locator('[data-testid=item-card][data-item-id="sql-002"]')).toBeVisible();
    await expect.poll(() => params(page).get('item')).toBe('sql-002');
    expect(params(page).get('view')).not.toBe('heatmap');
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
    await expect(page.getByRole('button', { name: /Remove filter .*(ms|s)/i }).first()).toBeVisible();
    await page.getByTestId('clear-filters').click();
    await expect.poll(() => itemsCount(page)).toEqual([60, 60]);
  });
});
