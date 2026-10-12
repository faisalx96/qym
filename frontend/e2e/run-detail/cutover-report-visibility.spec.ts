/**
 * Cutover of tests/platform/test_report_section_visibility_browser.py (run and compare): the analysis
 * reports follow the filtered data. When the filter leaves no error, root cause, category or score the
 * panels say so instead of drawing empty reports, they come back when the filter is cleared, a run with
 * no items has no analysis. (A recorded latency of 0 is dropped from the Latency tab: see the FINDINGS of
 * the cutover report.)
 */
import { test, expect, type Page } from '@playwright/test';
import { compareUrl, waitLoaded as waitCompareLoaded } from '../compare/support';
import { PERCENT, seedCustomRun, type CustomItem } from './cutover-support';
import { itemsCount, openRun, seedProject, type Seeded } from './support';

let s: Seeded;

const issues = { accuracy: { root_cause_issues: [{ category: 'Reasoning Error', subcategory: 'Missed evidence' }] } };
const items = (extra: Partial<CustomItem> = {}): CustomItem[] => [
  { id: 'item-0', input: 'reported question 0', error: 'Timeout: upstream unavailable', metadata: { domain: 'finance' } },
  {
    id: 'item-1',
    input: 'reported question 1',
    scores: { accuracy: { score: 0.45 } },
    metadata: { domain: 'finance', metric_analyses: issues },
  },
  { id: 'item-2', input: 'reported question 2', scores: { accuracy: { score: 0.65 } }, metadata: { domain: 'finance' } },
  { id: 'item-3', input: 'clean question', scores: { accuracy: { score: 0.95 } } },
  ...(extra.id ? [extra as CustomItem] : []),
];

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-reports');
});

async function tab(page: Page, name: string) {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

test('run page: errors, root causes and categories vanish with the filtered data and return', async ({ page }) => {
  const runId = await seedCustomRun(s, { name: 'reports', specs: { accuracy: PERCENT }, items: items() });
  await openRun(page, s.slug, runId);
  const search = page.getByRole('searchbox', { name: 'Search inputs and outputs' });

  await tab(page, 'Errors');
  await expect(page.getByText(/upstream unavailable/).first()).toBeVisible();
  await tab(page, 'Root cause');
  await expect(page.getByText('Reasoning Error').first()).toBeVisible();
  await tab(page, 'Categories');
  await expect(page.getByText('finance').first()).toBeVisible();

  // only the clean item is left: no error, no root cause, no metadata category
  await search.fill('clean question');
  await expect.poll(() => itemsCount(page)).toEqual([1, 4]);
  await tab(page, 'Errors');
  await expect(page.getByText('No errors in the current view.')).toBeVisible();
  await tab(page, 'Root cause');
  await expect(page.getByText('Reasoning Error')).toHaveCount(0);
  await expect(page.getByText(/No root causes recorded yet/)).toBeVisible();
  await tab(page, 'Categories');
  await expect(page.getByText('No metadata categories to break down.')).toBeVisible();

  // nothing matches: no scored items, and the search box stays to change it
  await search.fill('no matching question');
  await expect.poll(() => itemsCount(page)).toEqual([0, 4]);
  await tab(page, 'Overview');
  await expect(page.getByText('No scored items for the current filters.')).toBeVisible();
  await expect(search).toBeVisible();

  // clearing brings every report back
  await search.fill('');
  await expect.poll(() => itemsCount(page)).toEqual([4, 4]);
  await tab(page, 'Errors');
  await expect(page.getByText(/upstream unavailable/).first()).toBeVisible();
  await tab(page, 'Root cause');
  await expect(page.getByText('Reasoning Error').first()).toBeVisible();
  await tab(page, 'Categories');
  await expect(page.getByText('finance').first()).toBeVisible();
});

test('compare: the Errors and Root cause reports follow the filtered items and come back', async ({ page }) => {
  const a = await seedCustomRun(s, { name: 'cmp-a', specs: { accuracy: PERCENT }, items: items() });
  const b = await seedCustomRun(s, { name: 'cmp-b', specs: { accuracy: PERCENT }, items: items() });
  await page.goto(compareUrl([a, b]));
  await waitCompareLoaded(page);
  const search = page.getByRole('searchbox').first();
  await page.getByRole('tab', { name: /^Errors/ }).click();
  await expect(page.getByText(/upstream unavailable/).first()).toBeVisible();
  await page.getByRole('tab', { name: /^Root cause/ }).click();
  await expect(page.getByText('Reasoning Error').first()).toBeVisible();

  await search.fill('clean question');
  await page.getByRole('tab', { name: /^Errors/ }).click();
  await expect(page.getByText(/No errors among the 1 filtered items/)).toBeVisible();
  await page.getByRole('tab', { name: /^Root cause/ }).click();
  await expect(page.getByText('Reasoning Error')).toHaveCount(0);

  await search.fill('');
  await page.getByRole('tab', { name: /^Errors/ }).click();
  await expect(page.getByText(/upstream unavailable/).first()).toBeVisible();
});

test('run page: a run without items has no analysis, only its empty list', async ({ page }) => {
  const runId = await seedCustomRun(s, { name: 'no-items', specs: { accuracy: PERCENT }, items: [] });
  await page.goto(`/projects/${s.slug}/runs/${runId}`);
  await expect(page.getByRole('region', { name: 'Run summary' })).toBeVisible();
  await expect(page.getByTestId('items-count')).toContainText('0 of 0');
  await expect(page.getByTestId('metric-card')).toHaveCount(0);
  await expect(page.getByText('Reasoning Error')).toHaveCount(0);
  await expect(page.getByText('This run has no items yet.')).toBeAttached();
});

test('compare: runs without items have no analytics, only an empty list', async ({ page }) => {
  const a = await seedCustomRun(s, { name: 'cmp-empty-a', specs: { accuracy: PERCENT }, items: [] });
  const b = await seedCustomRun(s, { name: 'cmp-empty-b', specs: { accuracy: PERCENT }, items: [] });
  await page.goto(compareUrl([a, b]));
  await expect(page.getByTestId('compare-page')).toBeVisible();
  await expect(page.getByText('0 aligned items')).toBeVisible();
  await expect(page.getByText('Reasoning Error')).toHaveCount(0);
  await expect(page.getByText(/upstream unavailable/)).toHaveCount(0);
});
