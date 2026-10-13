/**
 * Runs-list behaviours of test_runs_list_p1_browser.py that the other runs-list
 * specs do not assert: the command bar never widens the page, a live refresh keeps an
 * open filter (and its focus), stray keys never blank the table, the Charts page has
 * no row shortcuts, and a failed submit says why.
 */
import { test, expect } from '@playwright/test';
import { APP } from '../helpers';
import {
  broadcastRunStatus,
  dataRows,
  freshProject,
  openFacet,
  openRuns,
  rowOf,
  sharedProject,
  table,
  urlParams,
} from './support';

for (const view of ['table', 'charts'] as const) {
  for (const width of [1024, 1280]) {
    test(`the command bar wraps instead of widening the ${view} page at ${width}px`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const s = await sharedProject(request, 12);
      const url =
        view === 'table'
          ? `${APP}/projects/${s.project.slug}?status=completed`
          : `${APP}/projects/${s.project.slug}/charts?status=completed`;
      await page.goto(url);
      await expect(page.getByRole('button', { name: /^Clear filters$/ }).first()).toBeVisible();
      const m = await page.evaluate(() => {
        const root = document.scrollingElement!;
        const clear = Array.from(document.querySelectorAll('button')).find((b) =>
          /^Clear filters$/.test(b.textContent ?? ''),
        );
        const trigger = document.querySelector('[data-testid="filters-trigger"]');
        return {
          page: [root.scrollWidth, root.clientWidth],
          clearRight: clear!.getBoundingClientRect().right,
          triggerRight: trigger ? trigger.getBoundingClientRect().right : 0,
        };
      });
      expect(m.page[0]).toBeLessThanOrEqual(m.page[1]);
      expect(m.clearRight).toBeLessThanOrEqual(width);
      expect(m.triggerRight).toBeLessThanOrEqual(width);
    });
  }
}

test('a live refresh keeps an open Filters popover and the focus inside it', async ({ page, request }) => {
  const s = await freshProject(request, 6);
  await openRuns(page, s.project.slug);
  await openFacet(page, 'Status');
  const panel = page.getByTestId('filters-panel');
  const box = panel.getByRole('checkbox').first();
  await box.focus();
  const label = await box.evaluate((el) => el.closest('label')?.textContent ?? '');
  const runId = s.runs[0]!.id;
  let refetches = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/api/dashboard/runs')) refetches++;
  });
  await broadcastRunStatus(page, [runId], 'FAILED');
  await expect.poll(() => refetches, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Status\b/ })).toHaveAttribute('aria-expanded', 'true');
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="filters-panel"]'))),
  ).toBe(true);
  expect(
    await panel
      .getByRole('checkbox')
      .first()
      .evaluate((el) => el.closest('label')?.textContent ?? ''),
  ).toBe(label);
});

test('stray view keys never blank the runs table', async ({ page, request }) => {
  const s = await sharedProject(request, 12);
  await openRuns(page, s.project.slug);
  await page.locator('body').click({ position: { x: 3, y: 3 } });
  for (const key of ['h', 'm', 't', 'Control+c', 'Meta+j']) await page.keyboard.press(key);
  await expect(table(page)).toBeVisible();
  await expect(dataRows(page).first()).toBeVisible();
  await expect(page.locator('[data-testid="runs-table"] tbody tr[data-focused]')).toHaveCount(0);
  expect(new URL(page.url()).pathname.endsWith(`/projects/${s.project.slug}`)).toBe(true);
});

test('the Charts page has no runs-list shortcuts', async ({ page, request }) => {
  const s = await sharedProject(request, 12);
  await page.goto(`${APP}/projects/${s.project.slug}/charts`);
  await expect(page.getByTestId(/^chart-card-/).first()).toBeVisible();
  await page.locator('body').click({ position: { x: 3, y: 3 } });
  for (const key of ['m', 'h', 't', '1', 'j', 'x', 'c']) await page.keyboard.press(key);
  await expect(page).toHaveURL(/\/charts/);
  expect(urlParams(page).has('range')).toBe(false);
  await expect(page.getByTestId(/^chart-card-/).first()).toBeVisible();
});

test('a failed submit says why and leaves the row as it was', async ({ page, request }) => {
  const s = await freshProject(request, 4);
  const NAME = 'text2sql-gpt-4o-000';
  await page.route(/\/v1\/runs\/.*\/submit|\/api\/runs\/.*\/submit/, (route) =>
    route.fulfill({
      status: 409,
      json: { detail: 'Only a completed, failed or rejected run can be submitted' },
    }),
  );
  await openRuns(page, s.project.slug);
  await rowOf(page, NAME)
    .getByRole('button', { name: `Submit ${NAME} for review` })
    .click();
  const dlg = page.getByRole('dialog', { name: `Submit ${NAME} for review` });
  await dlg.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(dlg).toContainText('Only a completed, failed or rejected run can be submitted');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(rowOf(page, NAME).getByRole('button', { name: `Submit ${NAME} for review` })).toBeVisible();
});

test('a delete dialog starts on Cancel, Enter cancels without deleting, Tab stays inside, Escape gives focus back', async ({
  page,
  request,
}) => {
  const s = await freshProject(request, 4);
  const NAME = 'text2sql-gpt-4o-000';
  const deletes: string[] = [];
  page.on('request', (r) => {
    if (
      r.method() !== 'GET' &&
      /\/runs\/delete|\/api\/runs\/delete|\/v1\/runs\//.test(r.url()) &&
      /delete/i.test(r.url())
    )
      deletes.push(r.url());
  });
  await openRuns(page, s.project.slug);
  const trigger = rowOf(page, NAME).getByRole('button', { name: `Delete ${NAME}` });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: `Delete ${NAME}?` }));
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')),
    ).toBe(true);
  }
  await dlg.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Enter');
  await expect(dlg).toHaveCount(0);
  expect(deletes).toEqual([]);
  await expect(rowOf(page, NAME)).toBeVisible();
  // Reopen and leave with Escape: nothing deleted, focus back on the Delete button.
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(deletes).toEqual([]);
  await expect(trigger).toBeFocused();
});

test('an unchanged refresh after a failed one clears the stale banner by itself', async ({
  page,
  request,
}) => {
  const s = await freshProject(request, 4);
  await openRuns(page, s.project.slug);
  await page.route('**/api/dashboard/runs', (route) =>
    route.fulfill({ status: 500, json: { detail: 'down' } }),
  );
  await broadcastRunStatus(page, [s.runs[0]!.id], 'COMPLETED');
  const banner = page.getByRole('status').filter({ hasText: /Showing data from/ });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await page.unroute('**/api/dashboard/runs');
  // Same filters, same rows: the next answer equals the page on screen.
  await broadcastRunStatus(page, [s.runs[0]!.id], 'COMPLETED');
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
  await expect(table(page).locator('table')).not.toHaveAttribute('data-dimmed', '');
});

test('a Charts table sorts another column on the first click: metrics highest first, text A to Z', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 12);
  await page.goto(`${APP}/projects/${s.project.slug}/charts`);
  const table = page.getByTestId('chart-card-text2sql').getByRole('grid');
  await expect(table).toBeVisible();
  const quality = table.locator('thead th', { hasText: /^quality/i });
  await quality.getByRole('button').click();
  await expect(quality).toHaveAttribute('aria-sort', 'descending');
  const model = table.locator('thead th', { hasText: /^model/i });
  await model.getByRole('button').click();
  await expect(model).toHaveAttribute('aria-sort', 'ascending');
  await expect(
    table.locator('thead th[aria-sort="ascending"], thead th[aria-sort="descending"]'),
  ).toHaveCount(1);
});
