/**
 * WP-B: the experiment detail's Credentials row and notices (spec-b B4-28 to B4-38), the
 * Latency-sensitive tag and the admission text of the jobs table (B5-49 to B5-58), and the token
 * reaching only the services that declare it (B4-6). Uses the fake services' /__control/flags.
 */
import { expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_A,
  FAKE_B,
  createEnvironment,
  expPath,
  experimentSpec,
  fakeJobs,
  launchExperiment,
  resetFakes,
  seedProject,
  setFakeFlags,
  setFakeJob,
  test,
  waitForExperiment,
  waitForSubmitted,
  pageOverflow,
} from './support';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

async function seed(request: Parameters<typeof seedProject>[0], latency = true) {
  const { project, connectionId } = await seedProject(request, 'creds');
  await setFakeFlags(request, FAKE_A, true); // declares the token key
  const declaring = await createEnvironment(request, project.id, 'declaring', { port: FAKE_A });
  const plain = await createEnvironment(request, project.id, 'plain', { port: FAKE_B });
  const exp = await launchExperiment(request, project.id, {
    name: 'timeout sweep',
    environment_ids: [declaring.id, plain.id],
    spec: experimentSpec(connectionId, { sweep: [10, 30] }),
    latency_sensitive: latency,
  });
  await waitForSubmitted(request, project.id, exp.id);
  return { project, declaring, plain, exp };
}

const credentials = (page: Page) => page.getByRole('region', { name: 'Credentials' });

test.describe('credentials', () => {
  test('the token reaches only the service that declares it and never the page', async ({ page, request }) => {
    const { project, exp } = await seed(request);
    const sent = (await fakeJobs(request, FAKE_A)).map((j) => j.env_overrides?.QYM_DATASET_READ_TOKEN);
    const unsent = (await fakeJobs(request, FAKE_B)).map((j) => j.env_overrides?.QYM_DATASET_READ_TOKEN);
    expect(sent).toHaveLength(2);
    for (const t of sent) expect(String(t)).toMatch(/^qym_dr_/);
    expect(unsent.every((t) => t === undefined)).toBe(true);
    const fakes = [...(await fakeJobs(request, FAKE_A)), ...(await fakeJobs(request, FAKE_B))];
    expect(fakes.every((j) => j.latency_sensitive === true)).toBe(true);

    await gotoApp(page, expPath(project.slug, `/${exp.id}`));
    const section = credentials(page);
    await expect(section).toBeVisible();
    await expect(section.getByText('API key')).toBeVisible();
    await expect(section.getByText('Dataset read token')).toBeVisible();
    await expect(page.getByTestId('cred-api-key')).toHaveText('active');
    await expect(page.getByTestId('cred-dataset-token')).toHaveText('active');
    // One environment does not declare the key: one notice, naming it.
    await expect(page.getByTestId('token-notice')).toHaveCount(1);
    await expect(page.getByTestId('token-notice')).toContainText('Dataset read token not sent to plain:');
    const html = await page.content();
    for (const t of sent) expect(html).not.toContain(String(t));
    expect(await pageOverflow(page)).toBe('');
  });

  test('the section shows revoked once an admin revokes the token, and the tag marks the experiment', async ({
    page,
    request,
  }) => {
    const { project, exp } = await seed(request);
    const list = await request.get(`/v1/projects/${project.id}/dataset-read-tokens`);
    const tokens = (await list.json()).tokens as { id: string; kind: string }[];
    const mine = tokens.find((t) => t.kind === 'experiment')!;
    expect((await request.delete(`/v1/projects/${project.id}/dataset-read-tokens/${mine.id}`)).ok()).toBeTruthy();
    await gotoApp(page, expPath(project.slug, `/${exp.id}`));
    await expect(page.getByTestId('cred-dataset-token')).toContainText(/^revoked /);
    await expect(page.getByTestId('cred-api-key')).toHaveText('active');
    await expect(page.getByTestId('latency-tag').first()).toHaveText('Latency-sensitive');
  });

  test('an ordinary experiment has no tag, no ↻ tag and no admission text', async ({ page, request }) => {
    const { project, exp } = await seed(request, false);
    await gotoApp(page, expPath(project.slug, `/${exp.id}`));
    await expect(page.getByTestId('latency-tag')).toHaveCount(0);
    await expect(page.getByTestId('requeue-tag')).toHaveCount(0);
    const status = page.getByRole('columnheader', { name: 'Status' }).first();
    await expect(status).toBeVisible();
  });
});

test.describe('jobs table admission state', () => {
  test('deferral, admission and re-queue texts follow the service', async ({ page, request }) => {
    const { project, exp } = await seed(request);
    const jobs = await fakeJobs(request, FAKE_A);
    const [first, second] = jobs;
    await setFakeJob(request, first!.id, {
      deferrals: 3,
      deferral_reason: 'vllm quiet window',
      admitted_at: null,
    });
    await setFakeJob(request, second!.id, {
      status: 'RUNNING',
      admitted_at: new Date().toISOString(),
      contaminated_attempts: 1,
    });
    await waitForExperiment(
      request,
      project.id,
      exp.id,
      (x) =>
        (x as unknown as { jobs: { deferrals: number; contaminated_attempts: number }[] }).jobs.some(
          (j) => j.deferrals === 3,
        ) &&
        (x as unknown as { jobs: { contaminated_attempts: number }[] }).jobs.some(
          (j) => j.contaminated_attempts === 1,
        ),
      'admission state stored',
    );
    await gotoApp(page, expPath(project.slug, `/${exp.id}`));
    const lines = page.getByTestId('admission-line');
    await expect(lines.filter({ hasText: 'deferred ×3 · vllm quiet window' })).toHaveCount(1);
    await expect(lines.filter({ hasText: /^admitted \d\d:\d\d$/ })).toHaveCount(1);
    await expect(page.getByTestId('requeue-tag')).toHaveText('↻ 1');
    await expect(page.getByTestId('requeue-tag')).toHaveAttribute('aria-label', 're-queued 1 time');
    // The status column is 240 px for a latency-sensitive experiment (B5-50).
    const header = page.getByRole('columnheader', { name: 'Status' }).first();
    expect(Math.round((await header.boundingBox())!.width)).toBe(240);
  });
});
