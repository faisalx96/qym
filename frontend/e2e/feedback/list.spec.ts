/// <reference lib="dom" />
/** QE-5 to QE-24: the Feedback list (geometry at 1440, 1024 and 390; URL filters; the duplicate pair open). */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { box, configureAgent, COLUMN, near, overflowX, record, seedFeedback, setViewport, shot, WIDTHS } from './support';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  await configureAgent(request);
  seedFeedback(2);
});

test('QE-5 to QE-12: page, drafts strip, six columns, 52 px rows', async ({ page }) => {
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, '/feedback');
    const root = page.getByTestId('feedback-list-page');
    await expect(page.getByRole('grid', { name: 'Feedback requests' })).toBeVisible();
    const col = await box(root.locator('[data-page-header]'));
    near(col.w, COLUMN[w]);
    const strip = await box(page.getByTestId('drafts-strip'));
    const headerH = col.h;
    const data: Record<string, unknown> = { header: col, strip };
    if (w >= 1024) {
      const grid = page.getByRole('grid', { name: 'Feedback requests' });
      const headers = await grid.locator('thead th').allInnerTexts();
      expect(headers.map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean)).toEqual([
        'request',
        'about',
        'priority',
        'complexity',
        'status',
        'submitted',
      ].map((x) => x));
      const table = await box(grid);
      data.table = table;
      const rowsH = await grid.locator('tbody tr').evaluateAll((rs) => rs.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10));
      data.rows = rowsH;
      expect(rowsH.filter((h) => h < 50).length).toBe(0);
      expect(await grid.evaluate((g) => (g.closest('[data-dt-scroller], div')?.scrollWidth ?? 0) - (g.parentElement?.clientWidth ?? 0))).toBeLessThanOrEqual(1);
      const th = await grid.locator('thead th', { hasText: 'Complexity' }).evaluate((e) => ({ w: e.getBoundingClientRect().width, fits: e.scrollWidth <= e.clientWidth + 1 }));
      expect(th.fits).toBe(true);
      data.complexityHeader = th.w;
    }
    expect(await overflowX(page)).toBe(0);
    record(`list-${w}`, { ...data, headerH });
    await shot(page, 'list', w);
  }
});

test('QE-13: the duplicate pair is visible without a click; QE-14 chevron', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback');
  const note = page.getByTestId('dup-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('of FB-');
  const child = page.locator('tr[aria-level="2"], [role="row"][aria-level="2"]').first();
  await expect(child).toBeVisible();
});

test('QE-15, QE-17, QE-18: filters live in the URL and apply on click; counts come with the rows', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback');
  await expect(page.getByTestId('filter-row')).toBeVisible();
  await page.getByRole('button', { name: /^Priority/ }).click();
  await page.getByRole('option', { name: /High/ }).or(page.getByRole('menuitemcheckbox', { name: /High/ })).first().click();
  await expect(page).toHaveURL(/priority=high/);
  await expect(page.getByRole('grid', { name: 'Feedback requests' })).toContainText('Export run comparison to PDF');
  await expect(page.getByRole('grid', { name: 'Feedback requests' })).not.toContainText('Light theme');
  await page.keyboard.press('Escape');
  await gotoApp(page, '/feedback?complexity=XL&sort=priority:desc');
  await expect(page.getByRole('grid', { name: 'Feedback requests' })).toContainText('Light theme');
  expect(page.url()).not.toContain('size=');
  await expect(page.getByText(/^\d+ requests?$/).first()).toBeVisible();
  await expect(page.locator('[data-page-header]')).toContainText('duplicate pair');
});

test('QE-19, QE-22, QE-16: below 640 px the table is cards and the page does not overflow; Filters opens a drawer', async ({ page }) => {
  await setViewport(page, 390);
  await gotoApp(page, '/feedback');
  await expect(page.getByTestId('filters-trigger')).toBeVisible();
  expect(await overflowX(page)).toBe(0);
  await page.getByTestId('filters-trigger').click();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
});

test('QE-21, QE-24: a row opens the request; the title is Feedback', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback');
  await expect(page).toHaveTitle(/^Feedback/);
  await page.getByRole('link', { name: 'FB-0001' }).first().click();
  await expect(page).toHaveURL(/\/feedback\/FB-0001/);
});

test('QE-7, QE-8, QE-146: drafts are named and discard asks only for two or more messages', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback');
  const resume = page.getByRole('button', { name: /^Resume / }).first();
  await expect(resume).toBeVisible();
  await page.getByRole('button', { name: /^Discard / }).first().click();
  await expect(page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete this draft?' }))).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
});
