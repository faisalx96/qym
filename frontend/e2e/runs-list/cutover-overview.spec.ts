/**
 * Overview behaviours of test_overview_performance_browser.py not asserted by overview.spec.ts:
 * which reads the page makes, a projection still being built, and a failed trend with Retry.
 * (The cards' numbers come from /api/dashboard/kpis: tests/platform/test_runs_kpis.py.)
 */
import { test, expect } from '@playwright/test';
import { APP } from '../helpers';
import { capture, freshProject } from './support';

const overviewUrl = (slug: string) => `${APP}/projects/${slug}/overview`;

test('the lists read 8 live, 5 recent and 5 approved runs, none of them live runs in the recent list', async ({
  page,
  request,
}) => {
  const s = await freshProject(request, 12);
  const runs = capture(page, 'runs');
  await page.goto(overviewUrl(s.project.slug));
  await expect(page.getByRole('region', { name: 'Recent runs' }).getByRole('row')).toHaveCount(6);
  await expect.poll(() => runs.all().length).toBeGreaterThanOrEqual(3);
  const byLimit = (limit: number) => runs.all().filter((r) => r.body.limit === limit);
  expect(byLimit(8).length).toBeGreaterThanOrEqual(1);
  const [live] = byLimit(8);
  expect(live!.body.filters.statuses).toEqual(expect.arrayContaining(['RUNNING']));
  const fives = byLimit(5);
  const recent = fives.find((r) => (r.body.filters.statuses ?? []).length > 1)!;
  expect(recent.body.filters.statuses).not.toContain('RUNNING');
  const approved = fives.find(
    (r) => r.body.filters.statuses?.length === 1 && r.body.filters.statuses[0] === 'APPROVED',
  )!;
  expect(approved).toBeTruthy();
  // no horizontal page scroll at 1280
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('a projection still being built is announced on the cards, not shown as a finished zero', async ({
  page,
  request,
}) => {
  const s = await freshProject(request, 4);
  await page.route(/\/api\/dashboard\/kpis$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.freshness = { ...(body.freshness ?? {}), updating: true, backfilling: true, unpublished_runs: 9 };
    await route.fulfill({ response, json: body });
  });
  await page.goto(overviewUrl(s.project.slug));
  await expect(page.getByLabel('Project KPIs')).toContainText('Updating…');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a failed trend read is an error with Retry, then the chart returns', async ({ page, request }) => {
  const s = await freshProject(request, 12);
  let fail = true;
  await page.route('**/api/dashboard/trend', (route) =>
    fail ? route.fulfill({ status: 503, json: { detail: 'down' } }) : route.continue(),
  );
  await page.goto(overviewUrl(s.project.slug));
  const card = page.getByRole('region', { name: 'Trend' });
  const retry = card.getByRole('button', { name: /Retry/ });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('trend-chart')).toHaveCount(0);
  fail = false;
  await retry.click();
  await expect(card.getByTestId('trend-chart')).toBeVisible({ timeout: 20_000 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
