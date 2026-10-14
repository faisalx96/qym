/** The Analyze action of the runs list: an explicit button whose state is written on it. */
import { test, expect } from '@playwright/test';
import { openRuns, rowOf, sharedProject } from './support';

test('finished runs show an Analyze button; live runs a dash; the button opens the analyzer', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 12);
  await openRuns(page, s.project.slug);
  const row = rowOf(page, 'text2sql-gpt-4o-000');
  const action = row.getByTestId('analyze-action');
  await expect(action).toHaveText('Analyze');
  await expect(action).toHaveAttribute('data-state', 'idle');
  await action.hover();
  const hovered = await action.evaluate((el) => getComputedStyle(el).color);
  expect(hovered).toBeTruthy();
  await action.click();
  await expect(page).toHaveURL(/\/analyzer/);
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
