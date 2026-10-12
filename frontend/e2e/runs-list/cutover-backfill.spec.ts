/**
 * Backfill disclosure on the Runs page (cutover of test_dashboard_backfill_browser.py). The freshness
 * flags of the real answer are overwritten the way the server reports a project whose history is still
 * being projected; the real projection catching up is tests/platform/test_dashboard_backfill_api.py.
 */
import { test, expect, type Page } from '@playwright/test';
import { dataRows, openRuns, sharedProject } from './support';

interface Mode {
  backfilling: boolean;
  unpublished: number;
  empty?: boolean;
}

async function patchFreshness(page: Page, mode: Mode) {
  await page.route(/\/api\/dashboard\/(runs|overview)$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const freshness = {
      updating: mode.backfilling,
      backfilling: mode.backfilling,
      pending_partitions: 0,
      unpublished_runs: mode.unpublished,
      failed_partitions: 0,
      oldest_pending_at: null,
    };
    body.freshness = freshness;
    if (body.overview) body.overview.freshness = freshness;
    if (mode.empty) {
      body.rows = [];
      body.tasks = {};
      body.total_runs = 0;
      body.total_count = 0;
      if (body.overview) {
        body.overview.total_count = 0;
        body.overview.total_runs = 0;
      }
    }
    await route.fulfill({ response, json: body });
  });
}

test('while history is projected the published rows show, with the count still preparing', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 12);
  const mode: Mode = { backfilling: true, unpublished: 111 };
  await patchFreshness(page, mode);
  await openRuns(page, s.project.slug);
  await expect(page.getByTestId('status-bar')).toContainText('111 runs preparing · totals cover ready runs');
  expect(await dataRows(page).count()).toBeGreaterThan(5);
  // Nothing left to prepare: the note names the update only, then clears.
  mode.unpublished = 0;
  await page.reload();
  await expect(page.getByTestId('status-bar')).toContainText('Updating summaries');
  mode.backfilling = false;
  await page.reload();
  await expect(page.getByTestId('status-bar')).toContainText('Last updated');
  await expect(page.getByTestId('status-bar')).not.toContainText('preparing');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a project whose history is not published yet says so instead of "No evaluation runs found"', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 12);
  await patchFreshness(page, { backfilling: true, unpublished: 123, empty: true });
  await page.goto(`/projects/${s.project.slug}`);
  await expect(page.getByText('Run history is preparing')).toBeVisible();
  await expect(page.getByText('Available runs will appear automatically.')).toBeVisible();
  await expect(page.getByText('No evaluation runs found')).toHaveCount(0);
  await expect(page.getByTestId('status-bar')).toContainText('123 runs preparing');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
