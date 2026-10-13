/** J1: load the project home, KPI agreement, empty / filtered-empty / error / stale states. */
import { test, expect } from '@playwright/test';
import { createProject, uniqueSlug, APP } from '../helpers';
import {
  broadcastRunStatus,
  dataRows,
  freshProject,
  openRuns,
  runsUrl,
  sharedProject,
  table,
} from './support';

test.describe('runs list: load (J1)', () => {
  test('rows render with the status-bar count and a sorted-by-time default', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await expect(dataRows(page)).toHaveCount(13);
    await expect(page.getByTestId('status-bar')).toContainText('13 runs');
    await expect(page.getByTestId('status-bar')).toContainText(/Last updated/);
    // default sort: Date descending
    await expect(page.locator('th[aria-sort]', { hasText: 'Date' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    // Status and Signals are separate columns, Actions is last
    const heads = await page.locator('[data-testid="runs-table"] thead th').allInnerTexts();
    expect(heads.join('|')).toMatch(/status[\s\S]*signals/i);
    expect(heads[heads.length - 1]).toMatch(/actions/i);
  });

  test('topbar KPIs equal the Overview KPI cards and /api/dashboard/kpis', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    const res = await request.post('/api/dashboard/kpis', {
      data: { project_slug: s.project.slug, filters: {} },
    });
    expect(res.ok()).toBeTruthy();
    const { kpis } = (await res.json()) as {
      kpis: {
        runs: number;
        runs_with_errors: number;
        models: number;
        items: number;
        execution_success: number;
      };
    };

    await openRuns(page, s.project.slug);
    const topbar = page.locator('[data-topbar-stats]');
    await expect(topbar).toBeVisible();
    const topText = (await topbar.innerText()).replace(/\s+/g, ' ');
    expect(topText).toContain(`${kpis.runs} runs`);
    expect(topText).toContain(`${kpis.models} models`);
    expect(topText).toContain(`${kpis.items.toLocaleString('en-US')} items`);
    expect(topText).toMatch(/\d+(\.\d)?% execution success/);
    expect(topText).toMatch(/run(s)? with errors/);

    await page.goto(`${APP}/projects/${s.project.slug}/overview`);
    const cards = page.getByLabel('Project KPIs');
    await expect(cards).toBeVisible();
    const cardText = (await cards.innerText()).replace(/\s+/g, ' ');
    // every topbar value token appears on the Overview cards too
    const values = [...topText.matchAll(/(\d[\d,.]*%?|<0\.1%)\s+(?=run|model|item|execution)/g)].map(
      (m) => m[1]!,
    );
    expect(values.length).toBeGreaterThanOrEqual(5);
    for (const v of values) expect(cardText, `value ${v}`).toContain(v);
    // and the Overview topbar shows the same chips
    const topOnOverview = (await topbar.innerText()).replace(/\s+/g, ' ');
    expect(topOnOverview).toBe(topText);
  });

  test('empty project shows "No evaluation runs found"', async ({ page, request }) => {
    const p = await createProject(request, 'Empty', uniqueSlug('empty'));
    await page.goto(runsUrl(p.slug));
    await expect(page.getByText('No evaluation runs found')).toBeVisible();
    await expect(page.getByRole('link', { name: /log your first run/ })).toBeVisible();
  });

  test('a filter with no result shows "No runs match current filters" and Clear filters restores rows', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await page.goto(runsUrl(s.project.slug, 'task=text2sql&dataset=cnn-sample'));
    await expect(page.getByText('No runs match current filters')).toBeVisible();
    await expect(page.getByTestId('status-bar')).toContainText('0 of');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(dataRows(page).first()).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });

  test('first-load failure shows the error state; Retry loads the rows', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    let fail = true;
    await page.route('**/api/dashboard/runs', (route) =>
      fail ? route.fulfill({ status: 500, json: { detail: 'boom' } }) : route.continue(),
    );
    await page.goto(runsUrl(s.project.slug));
    const err = page.getByRole('alert').filter({ hasText: 'Could not load runs' });
    await expect(err).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No evaluation runs found')).toHaveCount(0);
    fail = false;
    await err.getByRole('button', { name: /Retry/ }).click();
    await expect(dataRows(page).first()).toBeVisible();
    await expect(err).toHaveCount(0);
  });

  test('a failed filter change keeps the previous rows and says the change is not applied', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 6);
    await openRuns(page, s.project.slug);
    const before = await dataRows(page).count();
    await page.route('**/api/dashboard/runs', (route) =>
      route.fulfill({ status: 500, json: { detail: 'down' } }),
    );
    await page.getByRole('button', { name: /^Date/ }).first().click();
    const banner = page.getByRole('status').filter({ hasText: /Showing data from/ });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText('not applied');
    await expect(dataRows(page)).toHaveCount(before);
    await expect(page.getByRole('alert').filter({ hasText: 'Could not load runs' })).toHaveCount(0);
  });

  test('a later refresh failure keeps the rows and shows the stale banner', async ({ page, request }) => {
    const s = await freshProject(request, 4);
    await openRuns(page, s.project.slug);
    const before = await dataRows(page).count();
    await page.route('**/api/dashboard/runs', (route) =>
      route.fulfill({ status: 500, json: { detail: 'down' } }),
    );
    await broadcastRunStatus(page, [s.runs[0]!.id], 'COMPLETED');
    const banner = page.getByRole('status').filter({ hasText: /Showing data from/ });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).not.toContainText('not applied'); // same view: only the refresh failed
    await expect(dataRows(page)).toHaveCount(before);
    await expect(table(page).getByRole('progressbar', { name: 'Refreshing' })).toBeVisible();
    await expect(page.getByTestId('status-bar')).toContainText('refresh failed');
    // Retry from the banner recovers
    await page.unroute('**/api/dashboard/runs');
    await banner.getByRole('button', { name: /Retry/ }).click();
    await expect(banner).toHaveCount(0);
    await expect(table(page).getByRole('progressbar', { name: 'Refreshing' })).toHaveCount(0);
  });
});
