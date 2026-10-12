/**
 * Runs-list error signals and the incomplete-ingest tag (cutover of test_dashboard_error_types_browser.py and
 * test_ingest_incomplete_browser.py). The wording per count is Vitest (signals.test.ts); here the buttons in the
 * table, their details dialog and focus, with the rows of the real answer overwritten.
 */
import { test, expect, type Page } from '@playwright/test';
import { dataRows, freshProject, openRuns } from './support';

const XSS = '<img src=x onerror="window.__injected=1">';

async function patchRows(page: Page, edit: (rows: Array<Record<string, unknown>>) => void) {
  await page.route(/\/api\/dashboard\/runs$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body.rows)) edit(body.rows);
    await route.fulfill({ response, json: body });
  });
}

test('error signals keep task errors, metric errors and retries distinct; the dialog names the metric and returns focus', async ({
  page,
  request,
}) => {
  const s = await freshProject(request, 4);
  await patchRows(page, (rows) => {
    Object.assign(rows[0]!, {
      task_error_count: 0,
      metric_error_count: 2,
      metric_error_counts: { accuracy: 2 },
      metric_scored_averages: { accuracy: 0.9 },
      metric_averages: { accuracy: 0.72, quality: 0.5, latency_s: 1 },
      metrics: ['accuracy', 'quality', 'latency_s'],
      total_retries: 0,
      execution_error_count: 1,
    });
    Object.assign(rows[1]!, {
      status: 'COMPLETED',
      task_error_count: 3,
      metric_error_count: 0,
      metric_error_counts: {},
      total_retries: 4,
      execution_error_count: 3,
    });
    Object.assign(rows[2]!, {
      task_error_count: null,
      metric_error_count: null,
      execution_error_count: 5,
      total_retries: 0,
    });
  });
  await openRuns(page, s.project.slug);
  const cell = (n: number) => dataRows(page).nth(n).locator('td[data-col="signals"]');
  const metric = cell(0).getByRole('button', { name: /metric errors? across/ });
  await expect(metric).toHaveText(/2/);
  const task = cell(1).getByRole('button', { name: /task errors? across/ });
  await expect(task).toHaveText(/3/);
  await expect(cell(1).getByRole('button', { name: /total retries/ })).toHaveText(/4/);
  await expect(cell(2).getByRole('button', { name: /breakdown is updating/ })).toHaveText(/5/);
  // colour tells task errors from metric errors
  const color = (b: ReturnType<typeof cell>) => b.evaluate((el) => getComputedStyle(el).color);
  expect(await color(metric)).not.toBe(await color(task));

  // scorer errors count as 0 in the mean; the cell says what the mean of the scored items is
  await expect(dataRows(page).nth(0).locator('[title^="Mean of scored items: 90.0%"]')).toBeVisible();
  await metric.click();
  const dialog = page.getByRole('dialog', { name: /^Errors in / });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('accuracy');
  await expect(dialog.getByRole('group', { name: 'Error counts' }).or(dialog)).toContainText('Metric errors');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(metric).toBeFocused();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a run flagged incomplete carries a tag whose reason reads as text', async ({ page, request }) => {
  const s = await freshProject(request, 4);
  await patchRows(page, (rows) => {
    rows[0]!.ingest_incomplete = {
      missing_items: 0,
      rejected_events: 1,
      reason: `The platform rejected 1 event: item_completed for item ${XSS}`,
    };
    rows[1]!.ingest_incomplete = null;
  });
  await openRuns(page, s.project.slug);
  const flagged = dataRows(page)
    .nth(0)
    .locator('td[data-col="signals"]')
    .getByRole('button', { name: /^Incomplete data\./ });
  await expect(flagged).toHaveAttribute(
    'aria-label',
    `Incomplete data. The platform rejected 1 event: item_completed for item ${XSS}`,
  );
  await expect(page.getByRole('button', { name: /^Incomplete data\./ })).toHaveCount(1);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __injected?: number }).__injected),
  ).toBeUndefined();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
