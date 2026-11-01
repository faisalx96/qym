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
    // the signals sit in the Status cell (no Signals column), and the row menu column is last
    const heads = await page
      .locator('[data-testid="runs-table"] thead th')
      .evaluateAll((ths) => ths.map((th) => th.getAttribute('data-col')));
    expect(heads).not.toContain('signals');
    expect(heads[heads.length - 1]).toBe('actions');
  });

  test('the topbar has no KPI strip; the Overview KPI cards equal /api/dashboard/kpis', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    const res = await request.post('/api/dashboard/kpis', {
      data: { project_slug: s.project.slug, filters: {} },
    });
    expect(res.ok()).toBeTruthy();
    const { kpis } = (await res.json()) as { kpis: { runs: number; models: number; items: number } };

    // C150: each page keeps its own counts (the Runs footer, the Dashboard tiles), none in the topbar.
    await openRuns(page, s.project.slug);
    await expect(page.locator('[data-topbar-stats]')).toHaveCount(0);
    await expect(page.getByTestId('status-bar')).toContainText(`${kpis.runs} runs`);

    await page.goto(`${APP}/projects/${s.project.slug}/overview`);
    await expect(page.locator('[data-topbar-stats]')).toHaveCount(0);
    const cards = page.getByLabel('Project KPIs');
    await expect(cards).toBeVisible();
    const cardText = (await cards.innerText()).replace(/\s+/g, ' ');
    expect(cardText).toContain(String(kpis.runs));
    expect(cardText).toContain(String(kpis.models));
    expect(cardText).toContain(kpis.items.toLocaleString('en-US'));
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
    const err = page.getByRole('alert').filter({ hasText: 'Couldn’t load runs' });
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
    await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t load runs' })).toHaveCount(0);
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
