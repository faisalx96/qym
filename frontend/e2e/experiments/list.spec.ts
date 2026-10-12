/**
 * Brief 06 §2.1 + scenario 1: experiments list, filters in the URL, live note,
 * empty / no-match states and the legacy query-string redirects.
 */
import { expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_A,
  createEnvironment,
  expPath,
  experimentSpec,
  finishJob,
  launchExperiment,
  resetFakes, test,
  seedProject,
  waitForSubmitted,
} from './support';
import { pickSelect, query } from './ui';

test.setTimeout(90_000);

test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

test.describe('experiments list', () => {
  test('empty project shows the empty state with a launch action', async ({ page, request }) => {
    const { project } = await seedProject(request, 'explist-empty');
    await gotoApp(page, expPath(project.slug));
    await expect(page).toHaveTitle(/Experiments/);
    await expect(page.getByText('No experiments yet')).toBeVisible();
    await page.getByRole('link', { name: 'New experiment' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/experiments/new`));
  });

  test('status, created-by-me and versioning facet persist in the URL across reload; live note; no-match state', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'explist');
    const env = await createEnvironment(request, project.id, 'staging');
    const spec = experimentSpec(connectionId);
    const done = await launchExperiment(request, project.id, {
      name: 'finished one',
      environment_ids: [env.id],
      spec,
    });
    const live = await launchExperiment(request, project.id, {
      name: 'still going',
      environment_ids: [env.id],
      spec,
    });
    await waitForSubmitted(request, project.id, done.id);
    await finishJob(request, project.id, done.id, done.jobs[0]!.id, 'FAILED', 'boom');

    await gotoApp(page, expPath(project.slug));
    const table = page.getByRole('grid', { name: 'Experiments' });
    await expect(table.getByText('finished one')).toBeVisible();
    await expect(table.getByText('still going')).toBeVisible();
    await expect(page.getByText('2 experiments').first()).toBeVisible();
    await expect(page.getByText('Refreshes automatically while experiments run')).toBeVisible();
    // env names are resolved client-side
    await expect(table.getByText('staging').first()).toBeVisible();

    // status filter
    await pickSelect(page, /Status$/, 'failed');
    await expect.poll(() => query(page).get('status')).toBe('FAILED');
    await expect(table.getByText('still going')).toHaveCount(0);
    await expect(table.getByText('finished one')).toBeVisible();
    // nothing queued or running is listed any more: no auto-refresh promise
    await expect(page.getByText('Refreshes automatically while experiments run')).toHaveCount(0);

    // created by me (dev@local is the creator of both)
    await page.getByText('Created by me').click();
    await expect.poll(() => query(page).get('mine')).toBe('1');

    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'Created by me' })).toBeChecked();
    await expect(page.getByRole('button', { name: /Status$/ })).toContainText('failed');
    await expect(table.getByText('finished one')).toBeVisible();
    await expect(table.getByText('still going')).toHaveCount(0);

    // no history entries were added by the filters (replace, not push)
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(3);

    // a status without rows: no-match state with Clear filters
    await pickSelect(page, /Status$/, 'cancelled');
    await expect(page.getByText('No matching experiments')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(() => page.url().includes('?')).toBe(false);
    await expect(table.getByText('still going')).toBeVisible();

    // row click opens the detail in-app
    await table.getByText('still going').click();
    await expect(page).toHaveURL(new RegExp(`/experiments/${live.id}`));
    await expect(page.locator(`[data-exp-detail="${live.id}"]`)).toBeVisible();
  });

  test('versioning facet filter from the runs the project reports', async ({ page, request }) => {
    const { project, connectionId } = await seedProject(request, 'explist-ver');
    const env = await createEnvironment(request, project.id, 'staging');
    const res = await request.get(`/v1/projects/${project.id}/experiments?include_versioning_facets=true`);
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toHaveProperty('versioning_facets');
    await launchExperiment(request, project.id, {
      name: 'versioned',
      environment_ids: [env.id],
      spec: experimentSpec(connectionId),
    });
    // facets come from run versioning metadata; with no runs the toolbar has no facet selects,
    // while a ?versioning= param in the URL still filters (and survives reload).
    await gotoApp(page, `${expPath(project.slug)}?versioning=agent_version%3Dnope`);
    await expect(page.getByText('No matching experiments')).toBeVisible();
    // the key in the URL keeps its select: humanised label, value, and the key in the tooltip
    const facet = page.locator('[data-exp-versioning="agent_version"]');
    await expect(facet).toHaveAttribute('title', 'Evaluation Service versioning: agent_version');
    await expect(facet.getByRole('button', { name: /Agent version/ })).toContainText('nope');
    await page.reload();
    await expect(page.getByText('No matching experiments')).toBeVisible();
    expect(query(page).getAll('versioning')).toEqual(['agent_version=nope']);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('grid', { name: 'Experiments' }).getByText('versioned')).toBeVisible();
  });

  test('legacy query-string links redirect to their routes', async ({ page, request }) => {
    const { project, connectionId } = await seedProject(request, 'explist-legacy');
    const env = await createEnvironment(request, project.id, 'staging');
    const x = await launchExperiment(request, project.id, {
      name: 'legacy target',
      environment_ids: [env.id],
      spec: experimentSpec(connectionId),
    });
    const base = expPath(project.slug);

    await page.goto(`${base}?experiment=${x.id}`);
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/experiments/${x.id}$`));
    await expect(page.locator(`[data-exp-detail="${x.id}"]`)).toBeVisible();

    await page.goto(`${base}?new=1&env=${env.id}`);
    await expect(page).toHaveURL(new RegExp(`/experiments/new\\?env=${env.id}`));

    await page.goto(`${base}?view=environments`);
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/environments$`));
    await expect(page.locator('[data-environments-page]')).toBeVisible();

    await page.goto(`${base}?environment=${env.id}`);
    await expect(page).toHaveURL(new RegExp(`/environments/${env.id}$`));
    await expect(page.locator('[data-environment-page]')).toBeVisible();
  });
});

// keep the fake port referenced for the unused-import check when specs are trimmed
void FAKE_A;
