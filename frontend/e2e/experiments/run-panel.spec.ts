/**
 * Brief 06 §2.11: the run page has no React route yet, so RunExperimentPanel is covered by
 * Vitest (RunExperimentPanel*.test.tsx). This spec pins the contract between the real platform
 * and that component: an official run's detail carries the panel fields the component reads,
 * a local run carries none, and no token or secret ever travels with it.
 */
import { expect } from '@playwright/test';
import {
  createApiKey,
  createEnvironment,
  experimentSpec,
  finishJob,
  getExperiment,
  ingestRun,
  launchExperiment,
  linkRunToJob,
  resetFakes,
  test,
  seedProject,
  waitForSubmitted,
} from './support';

test.setTimeout(90_000);
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

test('an official run carries the experiment panel; a local run does not', async ({ request }) => {
  const { project, connectionId } = await seedProject(request, 'runpanel');
  const env = await createEnvironment(request, project.id, 'staging');
  const key = await createApiKey(request, project.id);
  const x = await launchExperiment(request, project.id, {
    name: 'panel source',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId),
  });
  const live = await waitForSubmitted(request, project.id, x.id);
  const job = live.jobs[0]!;
  const runId = await linkRunToJob(request, key, job, x.id, 'official-run');
  await finishJob(request, project.id, x.id, job.id, 'SUCCEEDED');
  expect((await getExperiment(request, project.id, x.id)).jobs[0]!.run_id).toBe(runId);

  const res = await request.get(`/api/runs/${runId}?view=compact`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as { run: { experiment?: Record<string, unknown> } };
  const panel = body.run.experiment!;
  expect(panel).toMatchObject({
    origin: 'official',
    experiment_id: x.id,
    experiment_name: 'panel source',
    experiment_available: true,
    environment_id: env.id,
    environment_name: 'staging',
    job_id: job.id,
    job_available: true,
    combo_index: 0,
  });
  // the fields the component renders from
  for (const field of ['base_source', 'schema_hash', 'slot_bindings', 'job_status', 'remote_job_id']) {
    expect(panel, field).toHaveProperty(field);
  }
  const dumped = JSON.stringify(body);
  expect(dumped).not.toContain('launch_token_hash');
  expect(dumped).not.toContain('$secret');
  expect(dumped).not.toMatch(/qlt_[A-Za-z0-9_-]+/);

  const localId = await ingestRun(request, key, { name: 'plain-sdk-run' });
  const local = (await (await request.get(`/api/runs/${localId}?view=compact`)).json()) as {
    run: { experiment?: { origin?: string } | null };
  };
  expect(local.run.experiment?.origin ?? 'local').not.toBe('official');
});
