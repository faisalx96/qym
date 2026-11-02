/**
 * Navigation across the shipped pages (cutover of test_p1_navigation_browser.py): Back restores the
 * Runs page, its sort/page/scroll and cached rows; run names, chart labels and dataset cards are real
 * links; Back to a run, a review link or a compare item left at the top stays at the top; a trace
 * left open leaves no overlay. Hero link targets are Vitest (heroLinks.test.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { APP, trackPageLoads } from '../helpers';
import { seedClassic, seedProject, openRun } from '../run-detail/support';
import { openRuns, sharedProject, dataRows } from './support';

/** The nearest scrolling ancestor of `selector` (the pages scroll inside the shell, not the window). */
const scrollHost = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluateHandle((node) => {
      let el: HTMLElement | null = node as HTMLElement;
      while (el && el !== document.body) {
        const o = getComputedStyle(el).overflowY;
        if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 20) return el;
        el = el.parentElement;
      }
      return document.scrollingElement as HTMLElement;
    });
const top = async (page: Page, selector: string) =>
  (await scrollHost(page, selector)).evaluate((el) => (el as HTMLElement).scrollTop);
const setTop = async (page: Page, selector: string, v: number | 'end') =>
  (await scrollHost(page, selector)).evaluate((el, value) => {
    (el as HTMLElement).scrollTop = value === 'end' ? (el as HTMLElement).scrollHeight : value;
  }, v);

const firstRunName = async (page: Page) =>
  (await dataRows(page).first().locator('td[data-col="run"] a').innerText()).trim();

test.describe('Runs list history', () => {
  test('Back restores sort, page, scroll position and the rows, without a full load', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    const s = await sharedProject(request, 55, 'big');
    await openRuns(page, s.project.slug);
    const loads = trackPageLoads(page);
    await page.locator('th', { hasText: 'Model' }).getByRole('button').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('model-asc');
    await expect(page.locator('th', { hasText: 'Model' })).toHaveAttribute('aria-sort', 'ascending');
    // Page 1: a run opened, Back. (Wait for the sorted rows: the old order stays dimmed while they load.)
    await expect(page.getByTestId('runs-table').getByRole('progressbar', { name: 'Refreshing' })).toHaveCount(
      0,
    );
    await expect(dataRows(page).first()).toBeVisible();
    const first = await firstRunName(page);
    await dataRows(page).nth(12).locator('td[data-col="run"] a').click();
    await expect(page).toHaveURL(/\/runs\//);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/projects/${s.project.slug}\\?`));
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ sort: 'model-asc' });
    await expect(dataRows(page).first()).toBeVisible();
    expect(await firstRunName(page)).toBe(first);
    // Page 2: the page number comes back with the sort.
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    await expect.poll(() => firstRunName(page)).not.toBe(first); // the rows of page 2 have arrived
    const firstOn2 = await firstRunName(page);
    await dataRows(page).first().locator('td[data-col="run"] a').click();
    await expect(page).toHaveURL(/\/runs\//);
    await page.goBack();
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ sort: 'model-asc', page: '2' });
    await expect(dataRows(page).first()).toBeVisible();
    await expect.poll(() => firstRunName(page)).toBe(firstOn2);
    expect(loads.count()).toBe(0);
  });

  // The Runs table scrolls inside its own container; Back puts it back.
  test('Back restores the Runs table scroll position', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    const s = await sharedProject(request, 55, 'big');
    await openRuns(page, s.project.slug);
    const rows = '[data-testid="runs-table"] tbody tr[data-run-id]';
    await setTop(page, rows, 240);
    await expect.poll(() => top(page, rows)).toBeGreaterThan(100);
    await page.waitForTimeout(400); // the offset is saved once scrolling settles
    const target = await top(page, rows);
    await dataRows(page).nth(12).locator('td[data-col="run"] a').click();
    await expect(page).toHaveURL(/\/runs\//);
    await page.goBack();
    await expect(dataRows(page).first()).toBeVisible();
    await expect.poll(async () => Math.abs((await top(page, rows)) - target)).toBeLessThanOrEqual(2);
  });

  test('Back shows the cached rows at once while the list revalidates', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const first = await firstRunName(page);
    await dataRows(page).first().locator('td[data-col="run"] a').click();
    await expect(page).toHaveURL(/\/runs\//);
    const held: Array<() => void> = [];
    await page.route('**/api/dashboard/runs', async (route) => {
      held.push(() => void route.continue());
    });
    await page.goBack();
    await expect(dataRows(page).first()).toBeVisible();
    expect(await firstRunName(page)).toBe(first);
    // Whether or not the list asks again, what was on screen is still there.
    await page.waitForTimeout(500);
    await expect(dataRows(page).first()).toBeVisible();
    expect(await firstRunName(page)).toBe(first);
    await page.unroute('**/api/dashboard/runs');
    held.forEach((release) => release());
  });

  // Back to a run URL that still names ?item= leaves the reader where Back puts them (this was a known failure
  // until the items table moved onto the windowed DataTable and landed deep links once).
  test('Back to a run restores its scroll instead of jumping to the open item', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    const p = await seedProject('nav-back-run');
    const runId = await seedClassic(p);
    await openRun(page, p.slug, runId);
    await page.getByRole('button', { name: 'Open item #3', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBeTruthy();
    const sel = '[data-testid="items-count"]';
    await setTop(page, sel, 'end');
    await page.waitForTimeout(500);
    const target = await top(page, sel);
    expect(target).toBeGreaterThan(300);
    // the run details are folded by default on the report page; the strip tags link to the filtered list
    await page
      .locator('a[href*="?model="]')
      .first()
      .evaluate((a) => (a as HTMLAnchorElement).click());
    await expect(page).toHaveURL(new RegExp(`/projects/${p.slug}\\?`));
    await page.goBack();
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect
      .poll(async () => Math.abs((await top(page, sel)) - target), { timeout: 10_000 })
      .toBeLessThanOrEqual(2);
    await page.waitForTimeout(1500);
    expect(Math.abs((await top(page, sel)) - target)).toBeLessThanOrEqual(2);
  });
});

test.describe('links', () => {
  test('run names are links; j moves real focus to a row and Enter opens it in-app', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const link = dataRows(page).first().locator('td[data-col="run"] a');
    expect(await link.getAttribute('href')).toMatch(new RegExp(`/projects/${s.project.slug}/runs/`));
    const loads = trackPageLoads(page);
    await page.locator('body').click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/runs\//);
    expect(loads.count()).toBe(0);
  });

  test('chart run labels are links and the legend entries are toggle buttons', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await page.goto(`${APP}/projects/${s.project.slug}/charts`);
    const label = page.getByTestId('charts-page').locator('a[href*="/runs/"]').first();
    await expect(label).toBeVisible();
    expect(await label.getAttribute('href')).toContain(`/projects/${s.project.slug}/runs/`);
    const legend = page.getByTestId('charts-page').getByRole('button', { pressed: true }).first();
    await expect(legend).toBeVisible();
    await legend.click();
    await expect(
      page.getByTestId('charts-page').getByRole('button', { pressed: false }).first(),
    ).toBeVisible();
  });

  test("Compare output cards link to the item on each run's page", async ({ page }) => {
    const p1 = await seedProject('nav-cmp');
    const a = await seedClassic(p1);
    const b = await seedClassic(p1);
    await page.goto(`${APP}/compare?runs=${a}&runs=${b}&item=item-0003`);
    const links = page.locator('[data-testid="output-card"] a[href*="?item="]');
    await expect(links.first()).toBeVisible({ timeout: 20_000 });
    const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(hrefs.slice(0, 2)).toEqual([
      `/projects/${p1.slug}/runs/${a}?item=item-0003`,
      `/projects/${p1.slug}/runs/${b}?item=item-0003`,
    ]);
  });

  test('leaving a run with its trace open leaves no overlay behind', async ({ page }) => {
    const p = await seedProject('nav-trace');
    const runId = await seedClassic(p);
    await openRun(page, p.slug, runId);
    await page.getByRole('button', { name: 'Open trace of item #7', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Trace' })).toBeVisible();
    await page.goBack().catch(() => undefined);
    await page.goto(`${APP}/projects/${p.slug}`);
    await expect(page.getByRole('dialog', { name: 'Trace' })).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/tv-open/);
    await expect(dataRows(page).first()).toBeVisible();
  });
});
