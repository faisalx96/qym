/**
 * Cutover: experiment-detail behaviours the vanilla pytest suite protected
 * (test_experiment_matrix.py, test_promote_to_official.py, test_experiments_ui.py) that detail.spec.ts
 * does not exercise: "Retry failed" over several jobs asks for the HIGH acknowledgement once, and a
 * matrix cell hands a job over to the default preset editor.
 */
import { expect, type Request } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  createEnvironment,
  expPath,
  experimentSpec,
  finishJob,
  getExperiment,
  launchExperiment,
  resetFakes,
  seedProject,
  stopExperiment,
  test,
  waitForSubmitted,
} from './support';
import { expectToast } from './ui';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

test('Retry failed over several jobs confirms once, asks for the HIGH acknowledgement once and retries each', async ({
  page,
  request,
}) => {
  const { project, connectionId } = await seedProject(request, 'expretryall');
  const env = await createEnvironment(request, project.id, 'staging');
  const x = await launchExperiment(request, project.id, {
    name: 'two failures',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId, { sweep: [60, 90] }),
    priority: 'HIGH',
    acknowledge_preemption: true,
  });
  expect(x.jobs).toHaveLength(2);
  await waitForSubmitted(request, project.id, x.id);
  for (const job of x.jobs) await finishJob(request, project.id, x.id, job.id, 'FAILED', 'worker crashed');

  const bodies: Record<string, unknown>[] = [];
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && r.url().includes('/retry')) bodies.push((r.postDataJSON() ?? {}) as Record<string, unknown>);
  });
  await gotoApp(page, expPath(project.slug, `/${x.id}`));
  await page.getByRole('button', { name: 'Retry failed (2)' }).click();
  const confirm = page.locator('[role="alertdialog"],[role="dialog"]').last();
  await expect(confirm.getByRole('heading', { name: 'Retry 2 jobs?' })).toBeVisible();
  await confirm.getByRole('button', { name: 'Retry jobs' }).click();

  const ack = page.locator('[role="alertdialog"],[role="dialog"]').last();
  await expect(ack.getByRole('heading', { name: 'Retry at HIGH priority?' })).toBeVisible();
  await ack.getByRole('button', { name: 'Retry at HIGH' }).click();
  await expectToast(page, 'Queued 2 new attempts');

  // the first retry was refused until acknowledged; the second one already carried it
  expect(bodies).toHaveLength(3);
  expect(bodies[0]).not.toHaveProperty('acknowledge_preemption');
  expect(bodies[1]).toMatchObject({ acknowledge_preemption: true });
  expect(bodies[2]).toMatchObject({ acknowledge_preemption: true });
  const after = await getExperiment(request, project.id, x.id);
  expect(after.jobs).toHaveLength(4);
  expect(after.jobs.filter((j) => j.superseded)).toHaveLength(2);
  await stopExperiment(request, project.id, x.id);
});

test('a matrix cell hands its job to the default preset editor, which opens on the environment', async ({
  page,
  request,
}) => {
  const { project, connectionId } = await seedProject(request, 'exppromote');
  const env = await createEnvironment(request, project.id, 'staging');
  const x = await launchExperiment(request, project.id, {
    name: 'promotable',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId, 45),
  });
  await gotoApp(page, expPath(project.slug, `/${x.id}`));
  const job = x.jobs[0]!;
  await page.locator(`[data-exp-promote="${job.id}"]`).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${project.slug}/environments/${env.id}/default-preset/edit\\?.*promote=job.*id=${job.id}`),
  );
  await expect(page.getByRole('complementary', { name: 'Review and publish' })).toBeVisible();
});
