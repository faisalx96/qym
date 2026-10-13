/** Experiments list and queue on DataTable v2: column menu, card layout at phone width, bulk bar. */
import { expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_B,
  createEnvironment,
  expPath,
  experimentSpec,
  launchExperiment,
  pauseEnvironment,
  resetFakes,
  seedProject,
  test,
} from './support';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

/** One paused environment holding a sweep of three queued jobs. */
async function seed(request: Parameters<typeof seedProject>[0]) {
  const { project, connectionId } = await seedProject(request, 'tables');
  const production = await createEnvironment(request, project.id, 'production', { port: FAKE_B });
  await pauseEnvironment(request, project.id, production.id, FAKE_B);
  await launchExperiment(request, project.id, {
    name: 'held sweep',
    environment_ids: [production.id],
    spec: experimentSpec(connectionId, { sweep: [10, 30, 60] }),
  });
  return project;
}
const jobsGrid = (page: Page) => page.getByRole('grid', { name: 'Queued jobs in dispatch order' });

test('queue: the Columns menu reveals the hidden "Created by" column', async ({ page, request }) => {
  const project = await seed(request);
  await gotoApp(page, expPath(project.slug, '/queue'));
  await expect(jobsGrid(page).getByRole('row')).not.toHaveCount(1);
  await expect(jobsGrid(page).getByRole('columnheader', { name: /Created by/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.getByRole('dialog', { name: 'Columns' }).getByText('Created by', { exact: true }).click();
  await expect(jobsGrid(page).getByRole('columnheader', { name: /Created by/ })).toHaveCount(1);
});

test('queue: selecting jobs adds the selection actions and keeps the filters', async ({ page, request }) => {
  const project = await seed(request);
  await gotoApp(page, expPath(project.slug, '/queue'));
  await expect(jobsGrid(page).getByRole('row')).not.toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Selection actions' })).toHaveCount(0);
  await jobsGrid(page).getByRole('row').nth(1).locator('label').first().click();
  const bar = page.getByRole('region', { name: 'Selection actions' });
  await expect(bar).toContainText('1 selected');
  await expect(bar.getByRole('button', { name: 'Cancel selected (1)' })).toBeEnabled();
  await expect(page.getByText('Environment', { exact: true }).first()).toBeVisible();
  await bar.getByRole('button', { name: 'Clear selection' }).click();
  await expect(bar).toHaveCount(0);
});

test('queue at 390px: jobs become cards with a row actions menu', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = await seed(request);
  await gotoApp(page, expPath(project.slug, '/queue'));
  const cards = page.getByRole('list', { name: 'Queued jobs in dispatch order' }).getByRole('listitem');
  await expect(cards.first()).toBeVisible();
  await expect(jobsGrid(page)).toHaveCount(0);
  await cards.first().getByRole('button', { name: 'Row actions' }).click();
  await expect(page.getByRole('menuitem', { name: /^Cancel/ })).toBeVisible();
});
