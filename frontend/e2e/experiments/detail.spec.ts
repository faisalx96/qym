/**
 * Brief 06 §2.2-2.3 + scenarios 2, 3: experiment detail (stat + queue strips, matrix compare
 * handoff, cancel experiment / job, retry incl. the HIGH acknowledgement and the temporary-key
 * re-entry, earlier attempts, save as preset, 403).
 */
import { expect, type Locator, type Page, type Request } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_A,
  FAKE_B,
  PRIMARY,
  createApiKey,
  createEnvironment,
  expPath,
  experimentSpec,
  finishJob,
  getExperiment,
  launchExperiment,
  linkRunToJob,
  pauseEnvironment,
  resetFakes,
  test,
  seedProject,
  stopExperiment,
  waitForExperiment,
  waitForSubmitted,
} from './support';
import { expectToast, query } from './ui';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

/** The stat-strip item (label + value) with this label. */
const stat = (strip: Locator, label: string) =>
  strip.getByText(label, { exact: true }).locator('xpath=ancestor::div[2]');
const detail = (page: Page, id: string) => page.locator(`[data-exp-detail="${id}"]`);

/** Collect the JSON bodies POSTed to a job action (`retry`, `cancel`) as they leave the browser. */
function recordPosts(page: Page, suffix: string): { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && r.url().includes(suffix))
      bodies.push((r.postDataJSON() ?? {}) as Record<string, unknown>);
  });
  return { bodies };
}

test.describe('experiment detail', () => {
  test('stat strip, queue strip and matrix: select runs, compare hands off through sessionStorage', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'expdet');
    const env = await createEnvironment(request, project.id, 'staging');
    const key = await createApiKey(request, project.id);
    const x = await launchExperiment(request, project.id, {
      name: 'timeout sweep',
      description: 'Timeout 10/30/60',
      environment_ids: [env.id],
      spec: experimentSpec(connectionId, { sweep: [10, 30, 60] }),
    });
    expect(x.jobs).toHaveLength(3);
    const live = await waitForSubmitted(request, project.id, x.id);
    const [a, b, c] = [...live.jobs].sort((p, q) => p.combo_index - q.combo_index);
    await linkRunToJob(request, key, a!, x.id, 'sweep-a');
    await linkRunToJob(request, key, b!, x.id, 'sweep-b');
    await finishJob(request, project.id, x.id, a!.id, 'SUCCEEDED');
    await finishJob(request, project.id, x.id, b!.id, 'SUCCEEDED');
    const after = await getExperiment(request, project.id, x.id);
    expect(after.jobs.filter((j) => j.run_id)).toHaveLength(2);

    await gotoApp(page, expPath(project.slug, `/${x.id}`));
    await expect(page).toHaveTitle(/timeout sweep/);
    // the trail names the experiment: project / Experiments / <name>
    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail.getByRole('link', { name: 'Experiments' })).toBeVisible();
    await expect(trail.getByText('timeout sweep')).toHaveAttribute('aria-current', 'page');
    const root = detail(page, x.id);
    await expect(root.getByRole('heading', { name: /timeout sweep/ })).toBeVisible();
    await expect(root.getByText('Timeout 10/30/60')).toBeVisible();

    const strip = page.getByLabel('Job totals');
    await expect(strip).toContainText('Jobs');
    await expect(stat(strip, 'Succeeded')).toContainText('2');
    await expect(stat(strip, 'In progress')).toContainText('1');
    await expect(stat(strip, 'Failed')).toContainText('0');

    // queue strip: one job still in flight on staging
    const queue = page.locator('[data-exp-queue-strip]');
    await expect(queue).toContainText('staging');
    await expect(queue).toContainText('1 running');
    await queue.getByRole('link', { name: /Open in queue/ }).click();
    await expect(page).toHaveURL(new RegExp(`/experiments/queue\\?experiment=${x.id}`));
    await page.goBack();

    const matrix = page.locator('[data-exp-matrix]');
    await expect(matrix.getByRole('columnheader', { name: 'staging' })).toBeVisible();
    await expect(matrix.locator('[data-exp-cell]')).toHaveCount(3);
    // only the two jobs with a run offer a checkbox; compare needs two
    const boxes = matrix.getByRole('checkbox');
    await expect(boxes).toHaveCount(2);
    const compare = matrix.getByRole('button', { name: /Compare selected/ });
    await expect(compare).toBeDisabled();
    await matrix.locator('label').first().click();
    await expect(compare).toBeDisabled();
    await matrix.getByRole('button', { name: 'Select all runs' }).click();
    await expect(compare).toHaveText('Compare selected (2)');
    await matrix.getByRole('button', { name: 'Clear' }).click();
    await expect(compare).toHaveText('Compare selected (0)');
    await matrix.getByRole('button', { name: 'Select all runs' }).click();
    await compare.click();

    await expect(page).toHaveURL(/\/compare\?runs=.+&runs=.+/);
    const urlRuns = new URL(page.url()).searchParams.getAll('runs');
    expect(urlRuns.sort()).toEqual(
      [a!.id, b!.id].map((id) => after.jobs.find((j) => j.id === id)!.run_id!).sort(),
    );
    const stored = await page.evaluate(() => sessionStorage.getItem('compareRuns'));
    expect((JSON.parse(stored ?? '[]') as string[]).sort()).toEqual(urlRuns);
    void c;
  });

  test('cancel experiment: queued jobs first, then running only; confirm text differs; toasts summarise', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'expcancel');
    const envA = await createEnvironment(request, project.id, 'staging');
    const envB = await createEnvironment(request, project.id, 'production', { port: FAKE_B });
    await pauseEnvironment(request, project.id, envB.id, FAKE_B);
    const x = await launchExperiment(request, project.id, {
      name: 'staging vs prod',
      environment_ids: [envA.id, envB.id],
      spec: experimentSpec(connectionId),
    });
    await waitForExperiment(
      request,
      project.id,
      x.id,
      (e) => e.jobs.some((j) => j.status === 'RUNNING') && e.jobs.some((j) => j.status === 'QUEUED'),
      'one job running on the service, one held',
    );

    await gotoApp(page, expPath(project.slug, `/${x.id}`));
    await page.getByRole('button', { name: 'Cancel experiment' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(
      dialog.getByRole('heading', { name: /Cancel queued jobs of “staging vs prod”\?/ }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      '1 queued job will be removed before reaching the Evaluation Service.',
    );
    await expect(dialog).toContainText('1 running job will keep running');
    // Esc keeps everything
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(
      (await getExperiment(request, project.id, x.id)).jobs.filter((j) => j.status === 'CANCELLED'),
    ).toHaveLength(0);

    await page.getByRole('button', { name: 'Cancel experiment' }).click();
    await dialog.getByRole('button', { name: 'Cancel queued jobs' }).click();
    await expectToast(page, '1 cancelled');
    const mid = await getExperiment(request, project.id, x.id);
    expect(mid.jobs.filter((j) => j.status === 'CANCELLED')).toHaveLength(1);

    // nothing pending any more: the copy switches to stopping the running job
    await page.getByRole('button', { name: 'Cancel experiment' }).click();
    await expect(
      dialog.getByRole('heading', { name: /Stop 1 running job of “staging vs prod”\?/ }),
    ).toBeVisible();
    await expect(dialog).toContainText('will be hard-stopped');
    await dialog.getByRole('button', { name: 'Stop 1 running job' }).click();
    await expectToast(page, /stopping on the service|1 cancelled/);
    await waitForExperiment(
      request,
      project.id,
      x.id,
      (e) => e.jobs.every((j) => j.status === 'CANCELLED'),
      'both cancelled',
    );
    await expect(page.getByRole('button', { name: 'Cancel experiment' })).toBeDisabled();
    await expect(stat(page.getByLabel('Job totals'), 'Cancelled')).toContainText('2');
  });

  test('cancel a single job from its matrix cell', async ({ page, request }) => {
    const { project, connectionId } = await seedProject(request, 'expcanceljob');
    const env = await createEnvironment(request, project.id, 'staging');
    await pauseEnvironment(request, project.id, env.id);
    const x = await launchExperiment(request, project.id, {
      name: 'held back',
      environment_ids: [env.id],
      spec: experimentSpec(connectionId),
    });
    await gotoApp(page, expPath(project.slug, `/${x.id}`));
    const cell = page.locator(`[data-exp-cell="${x.jobs[0]!.id}"]`);
    await expect(cell).toContainText('queued');
    await cell.getByRole('button', { name: /^Cancel/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: /Cancel job #0 on staging\?/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep running' }).click();
    await expect(dialog).toBeHidden();
    await cell.getByRole('button', { name: /^Cancel/ }).click();
    await dialog.getByRole('button', { name: 'Cancel job' }).click();
    await expectToast(page, '1 cancelled');
    await expect(cell).toContainText('cancelled');
    await expect(cell.getByRole('button', { name: /^Retry/ })).toBeVisible();
  });

  test('retry a FAILED job on a HIGH experiment: acknowledgement dialog, new attempt, earlier attempts', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'expretry');
    const env = await createEnvironment(request, project.id, 'staging');
    const x = await launchExperiment(request, project.id, {
      name: 'urgent check',
      environment_ids: [env.id],
      spec: experimentSpec(connectionId),
      priority: 'HIGH',
      acknowledge_preemption: true,
    });
    await waitForSubmitted(request, project.id, x.id);
    const failed = await finishJob(request, project.id, x.id, x.jobs[0]!.id, 'FAILED', 'worker crashed');

    const posts = recordPosts(page, '/retry');
    await gotoApp(page, expPath(project.slug, `/${x.id}`));
    const cell = page.locator(`[data-exp-cell="${failed.jobs[0]!.id}"]`);
    await expect(cell).toContainText('failed');
    await expect(cell).toContainText('worker crashed');
    await expect(page.getByRole('button', { name: 'Retry failed (1)' })).toBeEnabled();
    // job history shows no earlier-attempts toggle before a retry
    await expect(page.getByText(/Show earlier attempts/)).toHaveCount(0);

    await cell.getByRole('button', { name: /^Retry/ }).click();
    const ack = page.getByRole('alertdialog');
    await expect(ack.getByRole('heading', { name: 'Retry job #0 at HIGH priority?' })).toBeVisible();
    await ack.getByRole('button', { name: 'Retry at HIGH' }).click();
    await expectToast(page, 'Queued a new attempt of job #0');

    expect(posts.bodies).toHaveLength(2);
    expect(posts.bodies[0]).not.toHaveProperty('acknowledge_preemption');
    expect(posts.bodies[1]).toMatchObject({ acknowledge_preemption: true });

    const after = await getExperiment(request, project.id, x.id);
    expect(after.jobs).toHaveLength(2);
    expect(after.jobs.filter((j) => j.superseded)).toHaveLength(1);
    // the matrix cell now shows the new attempt and a link to the earlier one
    await expect(page.getByRole('button', { name: '↻ 1 earlier' })).toBeVisible();
    await expect(stat(page.getByLabel('Job totals'), 'Failed')).toContainText('0');

    const history = page.locator('[data-exp-jobs]');
    await expect(history.getByRole('row')).toHaveCount(2); // header + current attempt
    await history.getByText('Show earlier attempts (1)').click();
    await expect(history.getByRole('row')).toHaveCount(3);
    await expect(history.getByText('retried')).toBeVisible();
    await expect(history.getByText('worker crashed')).toBeVisible();
    // the matrix shortcut opens the history and scrolls to the superseded row
    await history.getByText('Show earlier attempts (1)').click();
    await expect(history.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: '↻ 1 earlier' }).click();
    await expect(history.getByRole('row')).toHaveCount(3);
    // the new HIGH attempt would block every other priority on the shared fake service
    await stopExperiment(request, project.id, x.id);
  });

  test('retry whose temporary model key was discarded asks for the key again and never keeps it', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'expkeys');
    const env = await createEnvironment(request, project.id, 'staging');
    const secretKey = 'sk-temp-REENTERED-9f8e7d6c';
    const original = 'sk-temp-ORIGINAL-1a2b3c4d';
    const spec = {
      ...experimentSpec(connectionId),
      slot_bindings: {
        [PRIMARY]: {
          temporary: {
            label: 'Scratch model',
            model: 'gpt-4o-mini',
            base_url: 'https://api.example.com/v1',
            api_key: { $secret: 'tmp1' },
          },
        },
      },
    };
    const x = await launchExperiment(request, project.id, {
      name: 'temporary model run',
      environment_ids: [env.id],
      spec,
      secrets: { tmp1: original },
    });
    await waitForSubmitted(request, project.id, x.id);
    await finishJob(request, project.id, x.id, x.jobs[0]!.id, 'FAILED', 'upstream 500');
    // keys are dropped once every current job settles
    await expect
      .poll(
        async () => {
          const r = await request.get(`/v1/projects/${project.id}/experiments/${x.id}`);
          return ((await r.json()) as { temporary_keys_stored?: boolean }).temporary_keys_stored;
        },
        { timeout: 30_000, intervals: [1000] },
      )
      .toBe(false);

    const posts = recordPosts(page, '/retry');
    await gotoApp(page, expPath(project.slug, `/${x.id}`));
    await page
      .locator('[data-exp-cell]')
      .getByRole('button', { name: /^Retry/ })
      .click();
    const dialog = page.getByTestId('temporary-keys-dialog');
    await expect(dialog.getByRole('heading', { name: 'Enter API keys to retry' })).toBeVisible();
    const field = dialog.getByLabel('Scratch model');
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toBeFocused();
    const submit = dialog.getByRole('button', { name: 'Retry with keys' });
    await expect(submit).toBeDisabled();
    await field.fill(secretKey);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expectToast(page, 'Queued a new attempt of job #0');

    expect(posts.bodies).toHaveLength(2);
    expect(posts.bodies[0]).not.toHaveProperty('temporary_keys');
    expect(posts.bodies[1]).toMatchObject({ temporary_keys: { [PRIMARY]: secretKey } });

    // the key is gone from the DOM, URL and storage
    await expect(dialog).toHaveCount(0);
    expect(await page.content()).not.toContain(secretKey);
    expect(page.url()).not.toContain(secretKey);
    const stores = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(stores).not.toContain(secretKey);
    expect((await getExperiment(request, project.id, x.id)).jobs).toHaveLength(2);
  });

  test('temporary key dialog: Cancel and Escape send nothing and leave no key behind', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'expkeys2');
    const env = await createEnvironment(request, project.id, 'staging');
    const spec = {
      ...experimentSpec(connectionId),
      slot_bindings: {
        [PRIMARY]: {
          temporary: {
            label: 'Scratch',
            model: 'm',
            base_url: 'https://api.example.com/v1',
            api_key: { $secret: 'k' },
          },
        },
      },
    };
    const x = await launchExperiment(request, project.id, {
      name: 'temp cancel',
      environment_ids: [env.id],
      spec,
      secrets: { k: 'sk-original-key-123456' },
    });
    await waitForSubmitted(request, project.id, x.id);
    await finishJob(request, project.id, x.id, x.jobs[0]!.id, 'FAILED', 'nope');
    await expect
      .poll(
        async () =>
          (
            (await (await request.get(`/v1/projects/${project.id}/experiments/${x.id}`)).json()) as {
              temporary_keys_stored?: boolean;
            }
          ).temporary_keys_stored,
        { timeout: 30_000, intervals: [1000] },
      )
      .toBe(false);
    await gotoApp(page, expPath(project.slug, `/${x.id}`));
    const retry = page.locator('[data-exp-cell]').getByRole('button', { name: /^Retry/ });
    await retry.click();
    const dialog = page.getByTestId('temporary-keys-dialog');
    await dialog.getByLabel('Scratch').fill('sk-typed-then-abandoned');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await page.content()).not.toContain('sk-typed-then-abandoned');
    // reopening starts empty
    await retry.click();
    await expect(dialog.getByLabel('Scratch')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await getExperiment(request, project.id, x.id)).jobs).toHaveLength(1);
    // "Clone instead" leaves for the launch form with the experiment and job as the clone source
    await retry.click();
    await dialog.getByRole('button', { name: 'Clone instead' }).click();
    await expect(page).toHaveURL(new RegExp(`/experiments/new\\?clone=${x.id}&job=${x.jobs[0]!.id}`));
  });

  test('save a combination as a preset', async ({ page, request }) => {
    const { project, connectionId } = await seedProject(request, 'expsave');
    const env = await createEnvironment(request, project.id, 'staging');
    const x = await launchExperiment(request, project.id, {
      name: 'preset source',
      environment_ids: [env.id],
      spec: experimentSpec(connectionId, 45),
    });
    await gotoApp(page, expPath(project.slug, `/${x.id}`));
    await page.locator(`[data-exp-save-preset="${x.jobs[0]!.id}"]`).click();
    const dialog = page.getByRole('dialog', { name: 'Save as preset' });
    const name = dialog.getByRole('textbox', { name: /Preset name/ });
    await expect(name).toBeFocused();
    await expect(name).not.toHaveValue('');
    await name.fill('Forty five seconds');
    await dialog.getByRole('textbox', { name: 'Notes' }).fill('from e2e');
    await dialog.getByRole('button', { name: 'Save preset' }).click();
    await expectToast(page, 'Saved preset “Forty five seconds”');
    const presets = await (
      await request.get(`/v1/projects/${project.id}/eval-environments/${env.id}/presets`)
    ).json();
    expect(JSON.stringify(presets)).toContain('Forty five seconds');
  });

  test('a 403 from the service disables the controls and says why', async ({ page, request }) => {
    const { project, connectionId } = await seedProject(request, 'exp403');
    const env = await createEnvironment(request, project.id, 'staging');
    await pauseEnvironment(request, project.id, env.id);
    const x = await launchExperiment(request, project.id, {
      name: 'not yours',
      environment_ids: [env.id],
      spec: experimentSpec(connectionId),
    });
    await page.route('**/experiments/*/cancel', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Only the creator or a manager can cancel' }),
      }),
    );
    await gotoApp(page, expPath(project.slug, `/${x.id}`));
    await page.getByRole('button', { name: 'Cancel experiment' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel queued jobs' }).click();
    await expectToast(page, /Only the creator or a manager can cancel/);
    await expect(page.getByText('You are not allowed to change this experiment.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel experiment' })).toBeDisabled();
    await expect(page.locator('[data-exp-cell]').getByRole('button', { name: /^Cancel/ })).toBeDisabled();
  });

  test('unknown experiment id shows a not-found state with a way back', async ({ page, request }) => {
    const { project } = await seedProject(request, 'expmissing');
    await gotoApp(page, expPath(project.slug, '/does-not-exist'));
    await expect(
      page.getByText('This experiment doesn’t exist in this project, or it was deleted.'),
    ).toBeVisible();
    await page.getByRole('link', { name: '← All experiments' }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/experiments$`));
    void query;
    void FAKE_A;
  });
});
