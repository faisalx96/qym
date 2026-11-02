/**
 * Auto-analysis on the runs list (C133): starting one is the first item of the row menu ('Open auto-analysis'); the
 * Analysis column shows only 'N causes' and 'Analyzing', and is not drawn when no row on the page has one.
 */
import { test, expect } from '@playwright/test';
import { openRowMenu, openRuns, rowOf, sharedProject } from './support';

test('a finished run starts its auto-analysis from the row menu; no idle Analyze button in the row', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 12);
  await openRuns(page, s.project.slug);
  const row = rowOf(page, 'text2sql-gpt-4o-000');
  await expect(row.locator('[data-testid="analyze-action"][data-state="idle"]')).toHaveCount(0);
  const menu = await openRowMenu(page, row);
  const item = menu.getByRole('menuitem').first();
  await expect(item).toHaveText('Open auto-analysis');
  await item.click();
  await expect(page).toHaveURL(/\/analy/);
});

test('a run with an analysis in flight reads Analyzing', async ({ page, request }) => {
  const s = await sharedProject(request, 12);
  const runId = s.runs[0]!.id;
  await page.route('**/api/analysis-jobs/active-runs', (route) =>
    route.fulfill({ json: { run_ids: [runId] } }),
  );
  await openRuns(page, s.project.slug);
  const states = await page
    .locator('[data-testid="analyze-action"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.state));
  await expect
    .poll(
      async () => (await page.locator('[data-testid="analyze-action"][data-state="running"]').count()) > 0,
    )
    .toBe(true);
  expect(states.length).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="analyze-action"][data-state="running"]').first()).toHaveText(
    'Analyzing',
  );
});
