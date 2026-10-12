/** Analysis side panel: tabs, ?panel=, hash anchors, error / category / deep / root-cause tabs, collapse, narrow viewport. */
import { test, expect, type Page } from '@playwright/test';
import { itemsCount, openRun, params, runUrl, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-panels');
  classic = await seedClassic(s);
});

const tab = (page: Page, name: string | RegExp) =>
  page.getByRole('tab', { name });

test.describe('analysis panel tabs', () => {
  test('Overview is the default; tabs switch the panel and write ?panel=', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await expect(page.locator('#analysis-panel')).toBeVisible();
    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
    await tab(page, /^Errors/).click();
    await expect.poll(() => params(page).get('panel')).toBe('errors');
    await expect(page.getByRole('tabpanel')).toContainText('Task errors');
    await tab(page, 'Categories').click();
    await expect.poll(() => params(page).get('panel')).toBe('categories');
    await tab(page, 'Overview').click();
    await expect.poll(() => params(page).get('panel')).toBeNull();
    // tabs only exist for data the run has
    await expect(tab(page, 'Repeat')).toHaveCount(0);
    await expect(tab(page, /Reviews/)).toHaveCount(0);
  });

  test('arrow keys move between tabs', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await tab(page, 'Overview').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Errors/)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Categories')).toBeFocused();
  });

  test('hash anchors open the matching tab (#errors #categories #deep #root-cause #overview)', async ({
    page,
  }) => {
    for (const [hash, name] of [
      ['errors', /^Errors/],
      ['categories', 'Categories'],
      ['deep', 'Deep'],
      ['root-cause', 'Root cause'],
      ['overview', 'Overview'],
    ] as const) {
      await page.goto(`/app/projects/${s.slug}/runs/${classic}#${hash}`);
      await expect(page.getByTestId('items-count')).toBeVisible();
      await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
    }
  });

  test('#items scrolls to the table', async ({ page }) => {
    await page.goto(`/app/projects/${s.slug}/runs/${classic}#items`);
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Items' })).toBeInViewport();
  });

  test('the panel collapses and the Analysis button brings it back', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page.getByRole('button', { name: 'Collapse analysis panel' }).click();
    await expect(page.locator('#analysis-panel')).toBeHidden();
    await page.getByRole('button', { name: 'Analysis', exact: true }).click();
    await expect(page.locator('#analysis-panel')).toBeVisible();
  });

  test('under 1200px the panel is a drawer opened by the Analysis button', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openRun(page, s.slug, classic);
    await expect(tab(page, 'Overview')).toHaveCount(0);
    const open = page.getByRole('button', { name: 'Analysis', exact: true });
    await open.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(open).toBeFocused();
  });
});

test.describe('errors tab', () => {
  test('error cards group by message and filter the table on click', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=errors');
    const cards = page.getByTestId('error-card');
    await expect(cards).toHaveCount(3);
    const timeout = cards.filter({ hasText: 'TimeoutError' });
    await expect(timeout).toContainText('6');
    await timeout.click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBe(6);
    await expect.poll(() => params(page).get('filters') ?? '').toContain('errors');
    await expect(page.getByRole('button', { name: /Remove filter .*Task error/i }).first()).toBeVisible();
    // clicking again toggles the filter off
    await timeout.click();
    await expect.poll(() => itemsCount(page)).toEqual([240, 240]);
  });

  test('a metric error card filters to the items whose scorer failed', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=errors');
    await page.getByTestId('error-card').filter({ hasText: 'JudgeError' }).click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBe(8);
    await page.getByTestId('clear-filters').click();
    await expect.poll(() => itemsCount(page)).toEqual([240, 240]);
  });
});

test.describe('categories tab', () => {
  test('category rows show averages and filter by metadata value', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=categories');
    const rows = page.getByTestId('category-row');
    await expect(rows.first()).toBeVisible();
    const easy = rows.filter({ hasText: /^easy/ }).first();
    await expect(easy).toContainText('items');
    await easy.click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(240);
    await expect(page.getByRole('button', { name: /Remove filter Complexity: easy/ })).toBeVisible();
    await expect.poll(() => params(page).get('filters') ?? '').toContain('complexity');
    await page.getByTestId('clear-filters').click();
    await expect.poll(() => itemsCount(page)).toEqual([240, 240]);
  });

  test('a metadata key that is not a built-in facet (source) filters the table', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=categories');
    const region = page.getByRole('region', { name: 'source' });
    await region.getByTestId('category-row').filter({ hasText: /^human/ }).click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBe(120);
    await expect(page.getByRole('button', { name: /Remove filter source: human/ })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('items-count')).toBeVisible();
    expect((await itemsCount(page))[0]).toBe(120);
  });

  test('the chip bar toggles category groups', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=categories');
    const group = page.getByRole('group', { name: 'Categories' });
    const complexity = group.getByRole('button', { name: /^complexity/ });
    await expect(complexity).toHaveAttribute('aria-pressed', 'true');
    await complexity.click();
    await expect(complexity).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('region', { name: 'complexity' })).toHaveCount(0);
  });
});

test.describe('deep and root cause tabs', () => {
  test('Deep: correlation matrix cells plot the pair', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=deep');
    const grid = page.getByRole('grid', { name: 'Pearson correlation matrix' });
    await expect(grid).toBeVisible();
    await grid.getByRole('button', { name: 'exact_match versus hallucination: -0.66' }).click();
    const rel = page.getByRole('region', { name: 'Metric relationship' });
    await expect(rel).toBeVisible();
    await expect(rel).toContainText('exact_match');
    await expect(rel).toContainText('hallucination');
  });

  test('Root cause: empty state offers Auto-Analyze; the link goes to the analyzer route', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=root-cause');
    await expect(page.getByText(/No root causes recorded yet/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Auto-Analyze' }).first()).toHaveAttribute(
      'href',
      new RegExp(`/projects/${s.slug}/runs/${classic}/analyzer$`),
    );
  });
});

test.describe('analysis metric and threshold', () => {
  test('changing the analysis metric re-scopes Pass/Fail and writes ?metric=', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page.getByRole('button', { name: /Analysis metric/ }).click();
    await page.getByRole('listbox').getByRole('option', { name: 'hallucination' }).click();
    await expect.poll(() => params(page).get('metric')).toBe('hallucination');
    await page.getByRole('radio', { name: 'Fail' }).click({ force: true });
    await expect(page.getByTestId('filter-banner')).toContainText('hallucination');
  });

  test('legacy deep link /app/run/<id>#errors keeps the anchor', async ({ page }) => {
    await page.goto(`/app/run/${classic}#errors`);
    await expect(page).toHaveURL(new RegExp(`/projects/[^/]+/runs/${classic}`));
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(tab(page, /^Errors/)).toHaveAttribute('aria-selected', 'true');
  });

  test('the run URL helper stays in sync with the router', () => {
    expect(runUrl('p', 'r', 'a=1')).toBe('/app/projects/p/runs/r?a=1');
  });
});
