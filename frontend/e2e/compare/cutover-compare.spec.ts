/**
 * Compare behaviours of test_performance_views_browser.py (step latency lanes per compared
 * column; a slow superseded search never replaces the newest results).
 */
import { expect, test, type Route } from '@playwright/test';
import { compareUrl, client, expectShown, seedScenario, urlParams, waitLoaded } from './support';
import { createApiKey, seedTracedRun, type CompareSeed } from './seed';

let seed: CompareSeed;
let traced: string;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-cutover');
  const token = await createApiKey(client, seed.projectId);
  traced = await seedTracedRun(client, token, 'traced');
});

const group = (ms: number) => ({
  phase: 'task',
  kind: 'TOOL',
  step_type: 'lookup',
  n: 1,
  error_count: 0,
  mean_ms: ms,
  median_ms: ms,
  p5_ms: ms,
  p25_ms: ms,
  p75_ms: ms,
  p95_ms: ms,
});

test('the Steps tab shows one lane per compared run, with the change against the baseline', async ({
  page,
}) => {
  const { base, a } = seed.runs;
  const requests: string[] = [];
  await page.route(/\/api\/runs\/step-latency\?/, (route: Route) => {
    requests.push(route.request().url());
    const refs = new URL(route.request().url()).searchParams.get('run_ids')!.split(',');
    route.fulfill({
      json: {
        run_ids: refs,
        rollup: 'name',
        passes: [],
        trace_count: refs.length,
        groups: [group(100)],
        groups_by_ref: Object.fromEntries(refs.map((ref, i) => [ref, [group(100 + i * 50)]])),
      },
    });
  });
  await page.goto(compareUrl([traced, base, a]));
  await waitLoaded(page);
  await page.getByRole('tab', { name: 'Steps' }).click();
  // One pooled request carries every lane (group_by=ref) and the columns in order.
  await expect.poll(() => requests.length).toBe(1);
  const q = new URL(requests[0]!).searchParams;
  expect(q.get('group_by')).toBe('ref');
  expect(q.get('run_ids')!.split(',')).toEqual([traced, base, a]);
  const table = page.getByRole('region', { name: 'Step latency' });
  await expect(table.getByRole('columnheader')).toHaveCount(4); // Step + one per run
  await expect(table.getByRole('rowheader', { name: /lookup/ })).toBeVisible();
  await expect(table.getByRole('cell').nth(0)).toContainText('100ms');
  await expect(table.getByRole('cell').nth(1)).toContainText('150ms');
  await expect(table.getByRole('cell').nth(1)).toContainText('+50%');
  // Removing a column re-requests only the remaining lanes.
  await page
    .getByRole('button', { name: /^Remove / })
    .last()
    .click();
  await expect.poll(() => urlParams(page).getAll('runs')).toEqual([traced, base]);
  await page.getByRole('tab', { name: 'Steps' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(new URL(requests[1]!).searchParams.get('run_ids')!.split(',')).toEqual([traced, base]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a slow superseded search never replaces the newest results', async ({ page }) => {
  const { base, a } = seed.runs;
  const held: Array<() => void> = [];
  await page.route(/\/items\/search/, async (route: Route) => {
    const body = route.request().postDataJSON() as { conditions?: Array<{ value: string }> };
    if (body.conditions?.some((c) => c.value === 'Question 1')) {
      const response = await route.fetch();
      await new Promise<void>((resolve) => held.push(resolve));
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  const box = page.getByRole('searchbox', { name: 'Search items' });
  await box.fill('Question 1');
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await box.fill('Question 17');
  await expect.poll(() => urlParams(page).get('q')).toBe('Question 17');
  await expectShown(page, 1);
  held.forEach((release) => release());
  await page.waitForTimeout(500);
  await expectShown(page, 1);
  await expect(page.getByTestId('item-row')).toHaveCount(1);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
