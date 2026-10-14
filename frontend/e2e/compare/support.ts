/** Shared helpers for the compare specs. */
import { expect, type Page } from '@playwright/test';
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

/** The expanded detail of one item (a sibling row of the item-row, so it is found by item id). */
export const itemDetail = (page: Page, id: string) =>
  page.locator(`[data-testid="item-detail"][data-item-id="${id}"]`);

/** The sticky bar's baseline select trigger. */
export const baselineSelect = (page: Page) =>
  page.locator('[data-compare-sticky]').getByRole('button', { name: /Baseline/ });

/** Open the baseline select and pick the option whose text matches. */
export async function pickBaseline(page: Page, option: RegExp): Promise<void> {
  await baselineSelect(page).click();
  await page.getByRole('option', { name: option }).click();
}

/** The "Per-run averages" matrix (a DataTable grid). */
export const averagesGrid = (page: Page) => page.getByRole('grid', { name: 'Per-run averages' });

/** One matrix cell: metric row id (`m:quality`, `latency`, `errors`) and column key (run id). */
export const averageCell = (page: Page, row: string, column: string) =>
  page.locator(`[data-testid="average-cell"][data-row="${row}"][data-column="${column}"]`);
