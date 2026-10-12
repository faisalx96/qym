/** Shared helpers for the compare specs. */
import { expect, type Page } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { seedCompareScenario, type CompareSeed, type SeedClient } from './seed';

export const PLATFORM_URL = `http://127.0.0.1:${process.env.QYM_PLATFORM_PORT ?? '8800'}`;
export const client: SeedClient = { baseUrl: PLATFORM_URL };

export async function seedScenario(prefix: string): Promise<CompareSeed> {
  return seedCompareScenario(client, uniqueSlug(prefix));
}

/** `/app/compare?runs=..&runs=..&extra` */
export function compareUrl(refs: string[], extra: Record<string, string | string[]> = {}): string {
  const p = new URLSearchParams();
  refs.forEach((r) => p.append('runs', r));
  for (const [k, v] of Object.entries(extra)) (Array.isArray(v) ? v : [v]).forEach((x) => p.append(k, x));
  return `/app/compare?${p.toString()}`;
}

export function cohortUrl(a: string[], b: string[], extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  a.forEach((r) => p.append('cohortA', r));
  b.forEach((r) => p.append('cohortB', r));
  for (const [k, v] of Object.entries(extra)) p.append(k, v);
  return `/app/compare?${p.toString()}`;
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
  const t = (await page.getByRole('status').filter({ hasText: /of \d+ items/ }).first().textContent()) ?? '';
  return Number(/(\d+) of \d+ items/.exec(t)?.[1] ?? NaN);
}

export async function expectShown(page: Page, n: number): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: /of \d+ items/ }).first()).toContainText(`${n} of `);
}
