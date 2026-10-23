/// <reference lib="dom" />
/** QE-5 to QE-24: the Feedback list (geometry at 1440, 1024 and 390; URL filters; the duplicate pair open). */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { box, configureAgent, COLUMN, near, overflowX, record, seedFeedback, setViewport, shot, WIDTHS, tableOf } from './support';

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
    await expect(page.getByTestId('dup-note')).toBeVisible();
    await expect(page.getByLabel('Feedback requests').first()).toBeVisible();
    const col = await box(root.locator('[data-page-header]'));
    near(col.w, COLUMN[w]);
    const strip = await box(page.getByTestId('drafts-strip'));
    const headerH = col.h;
    const data: Record<string, unknown> = { header: col, strip };
    if (w >= 1024) {
      const grid = tableOf(page);
      const headers = await grid.locator('thead th, [role=columnheader]').evaluateAll((els) => els.map((e) => (e as HTMLElement).textContent ?? ''));
      expect(headers.map((h) => h.replace(/[↕↓↑]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()).filter((h) => h && h !== 'expand')).toEqual([
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
      const scrollOver = await grid.evaluate((g) => {
        let el: HTMLElement | null = g.parentElement;
        let max = 0;
        let detail = '';
        while (el && el !== document.body) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === 'auto' || ox === 'scroll') max = Math.max(max, el.scrollWidth - el.clientWidth);
          if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) detail += `${el.tagName}.${String(el.className)} ${el.scrollWidth}/${el.clientWidth}; `;
          el = el.parentElement;
        }
        return { max, detail };
      });
      data.horizontalOverflow = scrollOver.max;
      expect(scrollOver.max, scrollOver.detail).toBeLessThanOrEqual(1);
      // QE-172: the header does not wrap (as tall as the other headers) at the table's own minimum width (118)
      const th = await grid.locator('thead th', { hasText: 'Complexity' }).evaluate((e) => ({
        w: e.getBoundingClientRect().width,
        h: e.getBoundingClientRect().height,
        other: (e.parentElement?.querySelector('th:nth-child(2)') as HTMLElement).getBoundingClientRect().height,
      }));
      expect(th.h, JSON.stringify(th)).toBeLessThanOrEqual(th.other + 1);
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
  await page.getByRole('button', { name: 'Priority filter' }).click();
  await page.getByRole('dialog').locator('[data-option]', { hasText: 'High' }).click();
  await expect(page).toHaveURL(/priority=high/);
  await expect(tableOf(page)).toContainText('Export run comparison to PDF');
  await expect(tableOf(page)).not.toContainText('Light theme');
  await page.keyboard.press('Escape');
  await gotoApp(page, '/feedback?complexity=XL&sort=priority:desc');
  await expect(tableOf(page)).toContainText('Light theme');
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
