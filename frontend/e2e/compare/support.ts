/** Shared helpers for the compare specs. */
import { expect, type Locator, type Page } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { seedCompareScenario, type CompareSeed, type SeedClient } from './seed';

export const PLATFORM_URL = `http://127.0.0.1:${process.env.QYM_PLATFORM_PORT ?? '8800'}`;
export const client: SeedClient = { baseUrl: PLATFORM_URL };

export async function seedScenario(prefix: string): Promise<CompareSeed> {
  return seedCompareScenario(client, uniqueSlug(prefix));
}

/** `/compare?runs=..&runs=..&extra` */
export function compareUrl(refs: string[], extra: Record<string, string | string[]> = {}): string {
  const p = new URLSearchParams();
  refs.forEach((r) => p.append('runs', r));
  for (const [k, v] of Object.entries(extra)) (Array.isArray(v) ? v : [v]).forEach((x) => p.append(k, x));
  return `/compare?${p.toString()}`;
}

export function cohortUrl(a: string[], b: string[], extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  a.forEach((r) => p.append('cohortA', r));
  b.forEach((r) => p.append('cohortB', r));
  for (const [k, v] of Object.entries(extra)) p.append(k, v);
  return `/compare?${p.toString()}`;
}

export function urlParams(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

/** Waits until the loaded compare page shows its item list. */
export async function waitLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId('compare-page')).toBeVisible();
  await expect(page.getByTestId('item-list')).toBeVisible();
}

/** Number shown in the "N of M items" status. */
export async function shownCount(page: Page): Promise<number> {
  const t =
    (await page
      .getByRole('status')
      .filter({ hasText: /of \d+ items/ })
      .first()
      .textContent()) ?? '';
  return Number(/(\d+) of \d+ items/.exec(t)?.[1] ?? NaN);
}

export async function expectShown(page: Page, n: number): Promise<void> {
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /of \d+ items/ })
      .first(),
  ).toContainText(`${n} of `);
}

/** Jump to a report section through the sticky "Comparison sections" nav (sections are stacked, not tabs). */
export async function goSection(page: Page, name: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Comparison sections' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
}

/** The item pane of one item (the item opens in a pane at the side of the list; it is found by item id). */
export const itemDetail = (page: Page, id: string) =>
  page.locator(`[data-testid="item-pane"][data-item-id="${id}"]`);

/** The item pane (`<aside aria-label="Item #n">`, in a portal on the body). One item is open at a time. */
export const itemPane = (page: Page) => page.getByTestId('item-pane');

/** The output blocks of a pane: one for each run in view, in the order of the runs (`aria-label="Output of <run>"`). */
export const paneOutputs = (pane: Locator) => pane.locator('section[data-part="output"]');

/** The Metrics table of the compare pane: a row for each metric and a column for each run (a row for each run above 4 runs). */
export const paneMetrics = (pane: Locator) => pane.getByRole('table', { name: 'Metrics of each run' });

/** Open an item in the pane from its row and wait for the output of each run. Returns the pane. */
export async function openItem(page: Page, id: string, outputs?: number): Promise<Locator> {
  // the start of the row: an open pane covers the rest of the list (it leaves 240 px of it in view)
  await itemHead(page, id).click({ position: { x: 24, y: 16 } });
  const pane = itemDetail(page, id);
  await expect(pane).toBeVisible();
  if (outputs !== undefined) await expect(paneOutputs(pane)).toHaveCount(outputs);
  return pane;
}

/** Close the item pane with its red Close tile (the pane covers most of the row, so a second click on the row can miss). */
export async function closeItem(page: Page): Promise<void> {
  await itemPane(page).getByRole('button', { name: 'Close item', exact: true }).click();
  await expect(itemPane(page)).toHaveCount(0);
}

/** The baseline select trigger (K1: by the page title, not in the sticky bar). */
export const baselineSelect = (page: Page) =>
  page.locator('[data-part="baseline-control"]').getByRole('button', { name: /Baseline/ });

/** Open the baseline select and pick the option whose text matches. */
export async function pickBaseline(page: Page, option: RegExp): Promise<void> {
  await baselineSelect(page).click();
  await page.getByRole('option', { name: option }).click();
}

/** The "Per-run averages" matrix (a table; at 390 px a group of per-metric blocks). */
export const averagesGrid = (page: Page) => page.getByRole('table', { name: 'Per-run averages' });

/** The head of one item row: the one tab stop (role=button) that opens the item in the pane; `aria-current` when open. */
export const itemHead = (page: Page, id: string) =>
  page.locator(`[data-testid="item-row"][data-item-id="${id}"] [data-part="item-head"]`);

/** Open the inline Filters panel (it lists the active filters in its head). */
export async function openFilters(page: Page): Promise<void> {
  const btn = page.locator('[data-part="items-filters-btn"]');
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  await expect(page.getByTestId('filter-builder')).toBeVisible();
}

/** The active filters as chips, in the open Filters panel head. */
export const activeFilters = (page: Page) => page.getByRole('group', { name: 'Filters set on the page' });

/** One matrix cell: metric row id (`m:quality`, `latency`, `errors`) and column key (run id). */
export const averageCell = (page: Page, row: string, column: string) =>
  page.locator(`[data-testid="average-cell"][data-row="${row}"][data-column="${column}"]`);
