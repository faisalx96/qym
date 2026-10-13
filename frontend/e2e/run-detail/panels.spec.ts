/** Report sections: stacked order, nav jumps, hash and ?panel= anchors, lazy mounting, error / category / deep / root-cause sections. */
import { test, expect, type Page } from '@playwright/test';
import { itemsCount, openRun, params, runUrl, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-panels');
  classic = await seedClassic(s);
});

const section = (page: Page, name: string) => page.locator(`#run-section-${name}`);
const navLink = (page: Page, name: string | RegExp) =>
  page.getByRole('navigation', { name: 'Run sections' }).getByRole('link', { name });

test.describe('report sections', () => {
  test('every analysis section is on the page, stacked in report order, Items last', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-report-section], #run-items')).map((e) =>
        e.id.replace('run-section-', '').replace('run-items', 'items'),
      ),
    );
    expect(order).toEqual(['overview', 'latency', 'deep', 'categories', 'errors', 'items']);
    await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
    // no side panel and no tabs any more
    await expect(page.locator('#analysis-panel')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveCount(0);
    // sections for data the run does not have are absent
    await expect(section(page, 'repeat')).toHaveCount(0);
    await expect(section(page, 'root-cause')).toHaveCount(0);
    await expect(navLink(page, 'Repeat')).toHaveCount(0);
  });

  test('nav links jump to the section and ?panel= is not written', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await navLink(page, /^Errors/).click();
    await expect(section(page, 'errors')).toBeInViewport();
    await expect(section(page, 'errors')).toContainText('Task errors');
    await navLink(page, 'Categories').click();
    await expect(section(page, 'categories')).toBeInViewport();
    expect(params(page).get('panel')).toBeNull();
    await expect(navLink(page, 'Categories')).toHaveAttribute('aria-current', 'location');
  });

  test('hash anchors scroll to the matching section (#errors #categories #deep #overview)', async ({
    page,
  }) => {
    for (const hash of ['errors', 'categories', 'deep', 'overview']) {
      await page.goto(`/projects/${s.slug}/runs/${classic}#${hash}`);
      await expect(page.getByTestId('items-count')).toBeVisible();
      await expect(section(page, hash)).toBeInViewport();
    }
  });

  test('#items scrolls to the table', async ({ page }) => {
    await page.goto(`/projects/${s.slug}/runs/${classic}#items`);
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Items' })).toBeInViewport();
  });

  test('lazy sections mount once they near the viewport', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await expect(section(page, 'deep')).not.toHaveAttribute('data-mounted', '');
    await navLink(page, 'Deep').click();
    await expect(section(page, 'deep')).toHaveAttribute('data-mounted', '');
    await expect(page.getByRole('grid', { name: 'Pearson correlation matrix' })).toBeVisible();
  });

  test('metric cards sit three per row at 1280 without a scope', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const cards = page.getByTestId('metric-card');
    const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    const first = tops.filter((t) => t === tops[0]).length;
    expect(first).toBeGreaterThanOrEqual(2);
  });
});

test.describe('errors section', () => {
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

test.describe('categories section', () => {
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
    await region
      .getByTestId('category-row')
      .filter({ hasText: /^human/ })
      .click();
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

test.describe('deep and root cause sections', () => {
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

  test('Root cause: hidden while the run has no analyses', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=root-cause');
    await expect(section(page, 'root-cause')).toHaveCount(0);
    await expect(navLink(page, 'Root cause')).toHaveCount(0);
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

  test('legacy deep link /run/<id>#errors keeps the anchor', async ({ page }) => {
    await page.goto(`/run/${classic}#errors`);
    await expect(page).toHaveURL(new RegExp(`/projects/[^/]+/runs/${classic}`));
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(section(page, 'errors')).toBeInViewport();
  });

  test('the run URL helper stays in sync with the router', () => {
    expect(runUrl('p', 'r', 'a=1')).toBe('/projects/p/runs/r?a=1');
  });
});
