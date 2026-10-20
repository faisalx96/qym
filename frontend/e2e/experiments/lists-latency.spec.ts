/** WP-B: the Latency-sensitive tag and filter in the experiments list and the queue (spec-b B5-59 to B5-68). */
import { expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_A,
  createEnvironment,
  expPath,
  experimentSpec,
  launchExperiment,
  resetFakes,
  seedProject,
  test,
  waitForSubmitted,
  pageOverflow,
} from './support';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

async function seed(request: Parameters<typeof seedProject>[0]) {
  const { project, connectionId } = await seedProject(request, 'lat-list');
  const env = await createEnvironment(request, project.id, 'staging', { port: FAKE_A });
  const flagged = await launchExperiment(request, project.id, {
    name: 'urgent',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId),
    latency_sensitive: true,
  });
  const plain = await launchExperiment(request, project.id, {
    name: 'ordinary',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId),
  });
  await waitForSubmitted(request, project.id, flagged.id);
  return { project, env, flagged, plain };
}

test('the list tags flagged experiments and filters them from the URL', async ({ page, request }) => {
  const { project } = await seed(request);
  await gotoApp(page, expPath(project.slug));
  const grid = page.getByRole('grid', { name: 'Experiments' });
  await expect(grid.getByRole('row')).toHaveCount(3);
  await expect(grid.getByTestId('latency-tag')).toHaveCount(1);
  await expect(grid.getByRole('row').filter({ hasText: 'urgent' }).getByTestId('latency-tag')).toBeVisible();
  const tag = await grid.getByTestId('latency-tag').boundingBox();
  expect(Math.round(tag!.width * 10) / 10).toBeCloseTo(98.4, 0);
  expect(Math.round(tag!.height)).toBe(20);

  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await expect(page).toHaveURL(/latency=1/);
  await expect(grid.getByRole('row')).toHaveCount(2);
  await expect(grid).not.toContainText('ordinary');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Latency-sensitive only' })).toBeChecked();
  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await expect(page).not.toHaveURL(/latency=1/);
  expect(await pageOverflow(page)).toBe('');
});

test('the queue tags flagged jobs, filters them and warns that others wait', async ({ page, request }) => {
  const { project } = await seed(request);
  await gotoApp(page, expPath(project.slug, '/queue'));
  await expect(page.getByTestId('latency-tag').first()).toBeVisible();
  const note = page.getByTestId('queue-latency-note');
  await expect(note).toHaveText('A latency-sensitive job is active on staging. Other jobs wait until it finishes.');
  expect(Math.round((await note.boundingBox())!.height * 10) / 10).toBeCloseTo(25.4, 0);
  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await expect(page).toHaveURL(/latency=1/);
  const grid = page.getByRole('grid', { name: 'Queued jobs in dispatch order' });
  await expect(grid.getByText('ordinary')).toHaveCount(0);
  await expect(grid.getByText('urgent').first()).toBeVisible();
});
