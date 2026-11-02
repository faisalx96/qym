/* eslint-disable @typescript-eslint/no-explicit-any -- API bodies are untyped JSON here */
/**
 * WP-D: clone, rerun and starting points with several dataset versions and tasks (spec-d QD-63 to QD-70).
 */
import { expect } from '@playwright/test';
import { expPath, getExperiment, launchExperiment, resetFakes, test } from '../support';
import { captureExperimentPosts, nameBox, openHome } from './launchSupport';
import { addDataset, chooseDataset, datasetsCard, dsBox, seedMulti, setVersions, type MultiFixture } from './multiSupport';

test.setTimeout(180_000);
test.use({ actionTimeout: 10_000 });

let f: MultiFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedMulti(request);
});

const PAIRS = [
  { dataset: 'support-tickets', version: 'v3' },
  { dataset: 'support-tickets', version: 'v2' },
  { dataset: 'billing-faq', version: 'v2' },
  { dataset: 'billing-faq', version: 'v1' },
];
async function original(request: Parameters<typeof launchExperiment>[0], shape: 'combined' | 'one_each' = 'one_each') {
  return launchExperiment(request, f.project.id, {
    name: 'source experiment',
    environment_ids: [f.production.id, f.staging.id],
    spec: {
      evaluator: { datasets: PAIRS, run_shape: shape, task: { [f.production.id]: 'route-ticket' }, config: { samples: 1 } },
      slot_bindings: { 'endpoint:primary': { connection_id: f.connectionId } },
      env_overrides: {},
    },
  });
}
const cloneUrl = (id: string, q = '') => `/projects/${f.project.slug}/experiments/new?clone=${id}${q}`;

test.describe('clone, rerun and starting points', () => {
  test('QD-63, QD-70: a clone shows the same datasets, shape and tasks, and launches the same jobs', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const x: any = await original(request);
    expect(x.job_count).toBe(8);
    const posts = captureExperimentPosts(page);
    await page.goto(cloneUrl(x.id));
    await expect(datasetsCard(page)).toBeVisible();
    await expect(page.getByTestId('pair-count')).toHaveText('4 dataset versions from 2 datasets');
    await expect(page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' })).toBeChecked();
    const task = page.locator('[data-env-task]');
    await expect(task.getByRole('button', { name: /Task of production/ })).toContainText('Route a ticket');
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeEnabled({ timeout: 15_000 });
    await expect.poll(() => posts.dryRuns.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const spec = posts.dryRuns.at(-1)!.body.spec;
    expect(spec.evaluator.datasets).toEqual(PAIRS);
    expect(spec.evaluator.run_shape).toBe('one_each');
    expect(spec.evaluator.task).toEqual({ [f.production.id]: 'route-ticket' });
    // Rerun: launch the cloned document; the same number of jobs per environment.
    await nameBox(page).fill('rerun of source');
    const launch = page.getByRole('button', { name: 'Launch as is' });
    await expect(launch).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByText(/8 runs to launch/).first()).toBeAttached();
    await launch.click();
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const again: any = await getExperiment(request, f.project.id, page.url().split('/').pop()!);
    const perEnv = (e: any) => e.jobs.reduce((m: any, j: any) => ({ ...m, [j.environment_id]: (m[j.environment_id] ?? 0) + 1 }), {});
    expect(perEnv(again)).toEqual(perEnv(x));
    expect(again.selection).toEqual(x.selection);
    // QD-63: the cloned dry run's job bodies equal the original's.
    const keyOf = (j: any) => `${j.environment_id}:${j.dataset_index}:${JSON.stringify(j.dataset)}:${JSON.stringify(j.task)}`;
    expect(again.jobs.map(keyOf).sort()).toEqual(x.jobs.map(keyOf).sort());
  });

  test('QD-64: a task of an environment that is no longer part of the launch is dropped with a note', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const x: any = await original(request, 'combined');
    // Disable production: the clone leaves it out and says what happened to its task.
    const off = await request.put(`/v1/projects/${f.project.id}/eval-environments/${f.production.id}`, { data: { is_active: false } });
    expect(off.ok(), await off.text()).toBeTruthy();
    await page.goto(cloneUrl(x.id));
    await expect(datasetsCard(page)).toBeVisible();
    await expect(page.getByText('Task for production was not carried (environment not selected)')).toBeVisible();
    await expect(page.locator('[data-env-task]')).toHaveCount(0);
  });

  test('QD-66: choosing a starting point never touches the datasets or the shape', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await chooseDataset(page, 'support-tickets');
    await setVersions(page, 'support-tickets', ['v2', 'v3']);
    await addDataset(page, 'billing-faq');
    await page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' }).click({ force: true });
    await page.getByRole('radio', { name: /From scratch/ }).click();
    const confirm = page.getByRole('button', { name: 'Change starting point' });
    if (await confirm.count()) await confirm.click();
    await expect(page.getByTestId('pair-count')).toHaveText('3 dataset versions from 2 datasets');
    await expect(page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' })).toBeChecked();
    await expect(dsBox(page, 'billing-faq')).toBeVisible();
  });

  test('QD-68: the best-run card names the first dataset and the others', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await chooseDataset(page, 'support-tickets');
    await expect(page.getByText('The configuration of a top-scoring official run on support-tickets.')).toBeVisible();
    await addDataset(page, 'billing-faq');
    await expect(page.getByText('The configuration of a top-scoring official run on support-tickets and 1 more dataset.')).toBeVisible();
    await addDataset(page, 'refund-cases');
    await expect(page.getByText(/on support-tickets and 2 more datasets\./)).toBeVisible();
  });

  test('QD-69: the default-preset editor keeps the single Dataset select, no run shape, and offers the task row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${f.project.slug}/environments/${f.production.id}/default-preset/edit`);
    await expect(page.getByTestId('editor-entry')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Choose a dataset/ })).toBeVisible();
    await expect(page.getByTestId('datasets-fieldset')).toHaveCount(0);
    await expect(page.getByTestId('run-shape')).toHaveCount(0);
    await expect(page.locator('[data-env-task]')).toHaveCount(1);
  });

  test('the experiments list is unchanged by dataset lists (QD-D11)', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await original(request);
    await page.goto(expPath(f.project.slug));
    await expect(page.getByText('source experiment').first()).toBeVisible();
  });
});
