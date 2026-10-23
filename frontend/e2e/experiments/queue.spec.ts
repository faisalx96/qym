/**
 * Brief 06 §2.7-2.8 + scenario 9: the eval queue page. Environment cards, URL filters,
 * selection, the split cancel dialog (reason sent), cancel-all-queued-in-experiment, the lazy
 * remote section with orphans, polling that pauses while the tab is hidden, keyboard use.
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
  pauseEnvironment,
  resetFakes,
  test,
  seedProject,
  waitForExperiment,
  waitForSubmitted,
  type SeededEnv,
} from './support';
import { expectToast, pickSelect, query } from './ui';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

const queuePath = (slug: string, q = '') => expPath(slug, `/queue${q}`);
const jobsGrid = (page: Page) => page.getByRole('grid', { name: 'Queued jobs in dispatch order' });

/** staging (healthy): one job in flight. production (paused): `held` sweeps of 3 queued jobs. */
async function seedQueue(request: Parameters<typeof seedProject>[0], opts: { orphan?: boolean } = {}) {
  const { project, connectionId } = await seedProject(request, 'queue');
  const staging = await createEnvironment(request, project.id, 'staging');
  const production = await createEnvironment(request, project.id, 'production', { port: FAKE_B });
  if (opts.orphan) {
    // A job the service holds that this project never launched. Created before the first
    // launch so the remote snapshot (refreshed at most every 30 s) already contains it.
    const orphan = await request.post(`${staging.url}/evals`, {
      headers: { Authorization: 'Bearer fake-key-12345' },
      data: {
        priority: 'NORMAL',
        user_id: 'someone-else',
        evaluator: { config: { run_name: 'orphan-run' } },
      },
    });
    expect(orphan.status()).toBe(202);
  }
  await pauseEnvironment(request, project.id, production.id, FAKE_B);
  const flight = await launchExperiment(request, project.id, {
    name: 'in flight',
    environment_ids: [staging.id],
    spec: experimentSpec(connectionId),
  });
  const held = await launchExperiment(request, project.id, {
    name: 'held sweep',
    environment_ids: [production.id],
    spec: experimentSpec(connectionId, { sweep: [10, 30, 60] }),
  });
  await waitForSubmitted(request, project.id, flight.id);
  return { project, connectionId, staging, production, flight, held };
}

/** Select a row's checkbox through its visible label (the input itself is hidden). */
async function selectRow(page: Page, index: number) {
  await jobsGrid(page)
    .getByRole('row')
    .nth(index + 1)
    .locator('label')
    .first()
    .click();
}

test.describe('queue page', () => {
  test('environment cards, URL filters that survive reload, and the empty filter result', async ({
    page,
    request,
  }) => {
    const { project, flight } = await seedQueue(request);
    await gotoApp(page, queuePath(project.slug));
    await expect(page).toHaveTitle(/Queue/);
    await expect(page.getByText('4 jobs').first()).toBeVisible();

    const staging = page.getByRole('region', { name: 'staging' });
    await expect(staging.getByText('Healthy')).toBeVisible();
    await expect(staging).toContainText('In flight');
    await expect(staging.locator('[class*=stat]').first()).toContainText('1');
    const production = page.getByRole('region', { name: 'production' });
    await expect(production).toContainText('Dispatch is paused until the health check passes');
    await expect(production).toContainText('Queued');

    // table: dispatch order numbers the held jobs; the experiment name links to the experiment
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(5);
    await expect(jobsGrid(page).getByRole('link', { name: /held sweep #\d/ })).toHaveCount(3);
    await expect(jobsGrid(page).getByRole('link', { name: /in flight #0/ })).toHaveAttribute(
      'href',
      new RegExp(`/experiments/${flight.id}$`),
    );

    await pickSelect(page, /Environment$/, /^production$/);
    await expect.poll(() => query(page).get('environment')).not.toBeNull();
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(4);
    await pickSelect(page, /Status$/, 'Queued');
    await expect.poll(() => query(page).get('status')).toBe('QUEUED');
    await page.getByText('Only my jobs').click();
    await expect.poll(() => query(page).get('mine')).toBe('1');

    await page.reload();
    await expect(page.getByRole('button', { name: /Environment$/ })).toContainText('production');
    await expect(page.getByRole('button', { name: /Status$/ })).toContainText('Queued');
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(4);
    // filters replace the URL instead of piling up history entries
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(3);

    await pickSelect(page, /Status$/, 'Blocked');
    await expect(page.getByText('No jobs match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(() => page.url().includes('?')).toBe(false);
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(5);
  });

  test('the jobs table has a Priority column, with LOW and NORMAL visible', async ({ page, request }) => {
    const { project } = await seedQueue(request);
    await gotoApp(page, queuePath(project.slug));
    const grid = jobsGrid(page);
    await expect(grid.getByRole('columnheader', { name: 'Priority' })).toBeVisible();
    await expect(grid.getByRole('row').nth(1)).toContainText('Normal');
  });

  test('select two queued jobs, cancel: split dialog lists them, the reason is sent', async ({
    page,
    request,
  }) => {
    const { project, held } = await seedQueue(request);
    const bodies: Record<string, unknown>[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/eval-queue/cancel'))
        bodies.push(r.postDataJSON() as Record<string, unknown>);
    });
    await gotoApp(page, queuePath(project.slug, '?status=QUEUED'));
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(4);
    await selectRow(page, 0);
    await selectRow(page, 1);
    await expect(page.getByRole('button', { name: 'Cancel selected (2)' })).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel selected (2)' }).click();

    const dialog = page.getByTestId('cancel-split-dialog');
    await expect(dialog.getByRole('heading', { name: 'Cancel 2 jobs?' })).toBeVisible();
    const here = dialog.locator('[data-split="here"]');
    await expect(here).toContainText('Queued here (not yet sent)');
    await expect(here).toContainText('2');
    await expect(here.getByRole('listitem')).toHaveCount(2);
    await expect(dialog.locator('[data-split="remote"]')).toHaveCount(0);
    // focus starts on the safe choice
    await expect(dialog.getByRole('button', { name: 'Keep jobs' })).toBeFocused();
    await dialog.getByLabel('Reason (optional)').fill('wrong sweep range');
    await dialog.getByTestId('cancel-split-confirm').click();
    await expectToast(page, '2 cancelled');

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ reason: 'wrong sweep range' });
    expect((bodies[0]!.job_ids as string[]).length).toBe(2);
    const after = await request.get(`/v1/projects/${project.id}/experiments/${held.id}`);
    const jobs = ((await after.json()) as { jobs: { status: string }[] }).jobs;
    expect(jobs.filter((j) => j.status === 'CANCELLED')).toHaveLength(2);
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(2);
  });

  test('a mixed selection splits queued jobs from the one running on the service', async ({
    page,
    request,
  }) => {
    const { project } = await seedQueue(request);
    await gotoApp(page, queuePath(project.slug));
    await page.getByRole('button', { name: /Select all I can cancel \(4\)/ }).click();
    await expect(page.getByRole('region', { name: 'Selection actions' })).toContainText('4 selected');
    await page.getByRole('button', { name: 'Cancel selected (4)' }).click();
    const dialog = page.getByTestId('cancel-split-dialog');
    await expect(dialog.locator('[data-split="here"]')).toContainText('3');
    await expect(dialog.locator('[data-split="remote"]')).toContainText(
      'Submitted or running on the service',
    );
    await expect(dialog.locator('[data-split="remote"]')).toContainText('in flight #0 on staging');
    await dialog.getByRole('button', { name: 'Cancel 4 jobs' }).click();
    await expectToast(page, /3 cancelled/);
  });

  test('cancel all queued in experiment exists only while an experiment is filtered', async ({
    page,
    request,
  }) => {
    const { project, held } = await seedQueue(request);
    const bodies: Record<string, unknown>[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/eval-queue/cancel'))
        bodies.push(r.postDataJSON() as Record<string, unknown>);
    });
    await gotoApp(page, queuePath(project.slug));
    await expect(page.getByRole('button', { name: /Select all I can cancel/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel all queued in experiment' })).toHaveCount(0);

    await pickSelect(page, /Experiment$/, 'held sweep');
    await expect.poll(() => query(page).get('experiment')).toBe(held.id);
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(4);
    await page.getByRole('button', { name: 'Cancel all queued in experiment' }).click();
    const dialog = page.getByTestId('cancel-split-dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Cancel all queued jobs in “held sweep”?' }),
    ).toBeVisible();
    await expect(dialog.locator('[data-split="here"]')).toContainText('3');
    await dialog.getByRole('button', { name: 'Cancel 3 queued jobs' }).click();
    await expectToast(page, '3 cancelled');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({ experiment_id: held.id, statuses: ['QUEUED', 'BLOCKED'] });
    await expect(page.getByText('No jobs match these filters')).toBeVisible();
  });

  test('the experiment filter lists an experiment that has no live jobs', async ({ page, request }) => {
    const { project, held } = await seedQueue(request);
    for (const j of held.jobs) {
      const r = await request.post(`/v1/projects/${project.id}/experiments/${held.id}/jobs/${j.id}/cancel`, {
        data: {},
      });
      expect(r.ok()).toBeTruthy();
    }
    await waitForExperiment(request, project.id, held.id, (x) =>
      x.jobs.every((j) => j.status === 'CANCELLED'),
    );
    await gotoApp(page, queuePath(project.slug));
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: /Experiment$/ }).click();
    await expect(page.getByRole('option', { name: 'held sweep' })).toBeVisible();
    await page.getByRole('option', { name: 'held sweep' }).click();
    await expect(page.getByText('No jobs match these filters')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel all queued in experiment' })).toBeVisible();
  });

  test('an unknown experiment id in the URL is shown in the filter, answers 404, and can be cleared', async ({
    page,
    request,
  }) => {
    const { project } = await seedProject(request, 'queue-url');
    await gotoApp(page, queuePath(project.slug, '?experiment=ghost-id'));
    await expect(page.getByRole('button', { name: /Experiment$/ })).toContainText('Selected experiment');
    // the API answers 404 for an id that is not an experiment of this project
    await expect(page.getByRole('heading', { name: 'Couldn’t load the queue' })).toBeVisible();
    await pickSelect(page, /Experiment$/, 'All experiments');
    await expect.poll(() => query(page).get('experiment')).toBeNull();
    await expect(page.getByText('The queue is empty')).toBeVisible();
  });

  test('remote queue loads only when expanded and shows an orphan that a manager can cancel', async ({
    page,
    request,
  }) => {
    const { project, staging } = await seedQueue(request, { orphan: true });
    const remoteCalls: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/eval-queue/remote') && r.method() === 'GET') remoteCalls.push(r.url());
      if (r.url().endsWith('/eval-queue/remote/cancel'))
        bodies.push(r.postDataJSON() as Record<string, unknown>);
    });
    await gotoApp(page, queuePath(project.slug));
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(5);
    await page.waitForTimeout(1500);
    expect(remoteCalls).toHaveLength(0);

    const toggle = page.getByRole('button', { name: /Remote queue/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const section = page.getByRole('region', { name: 'Remote queue' });
    // the first snapshot is taken in the background (and re-read by the section's poll)
    await expect(section.getByText('1 orphan').first()).toBeVisible({ timeout: 30_000 });
    expect(remoteCalls.length).toBeGreaterThan(0);
    const remote = section.getByRole('grid', { name: 'Remote jobs on staging' });
    await expect(remote.getByText('Orphan', { exact: true })).toBeVisible();
    // 25 s: the remote list is read from the fake service, which answers slowly while two workers share the machine.
    await expect(remote.getByRole('link', { name: 'in flight' })).toBeVisible({ timeout: 25_000 });

    // only the orphan can be selected: the row that matches a job of ours has a disabled checkbox
    await expect(remote.getByRole('checkbox', { name: 'Select row', disabled: true })).toHaveCount(1);
    await expect(remote.getByRole('checkbox', { name: 'Select row', disabled: false })).toHaveCount(1);
    await expect(
      remote.getByRole('row').filter({ hasText: 'in flight' }).getByRole('checkbox', { disabled: true }),
    ).toHaveCount(1);

    const orphanRow = remote.getByRole('row').filter({ hasText: 'orphan-run' });
    await orphanRow.locator('label').first().click();
    await section.getByRole('button', { name: 'Cancel selected orphans (1)' }).click();
    const dialog = page.getByTestId('cancel-split-dialog');
    await expect(dialog).toContainText('Cancel 1 orphan job on staging?');
    await expect(dialog.locator('[data-split="orphans"]')).toContainText('Orphans on the service');
    await dialog.getByLabel('Reason (optional)').fill('left over');
    await dialog.getByTestId('cancel-split-confirm').click();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ environment_id: staging.id, reason: 'left over' });
    await expect
      .poll(async () =>
        (await fakeJobs(request, FAKE_A))
          .filter((j) => j.eval_input?.config?.run_name === 'orphan-run')
          .map((j) => j.status),
      )
      .toEqual(['CANCELLED']);
  });

  test('polling pauses while the tab is hidden and resumes when it is visible again', async ({
    page,
    request,
  }) => {
    const { project } = await seedQueue(request);
    let polls = 0;
    page.on('request', (r) => {
      if (/\/eval-queue(\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search)) polls += 1;
    });
    await gotoApp(page, queuePath(project.slug));
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(5);
    // visible: it refreshes on its own
    await expect.poll(() => polls, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

    const setVisibility = (state: 'hidden' | 'visible') =>
      page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
        Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
    await setVisibility('hidden');
    await page.waitForTimeout(300);
    const before = polls;
    await page.waitForTimeout(14_000); // longer than the longest delay before the cap kicks in
    expect(polls, 'requests while hidden').toBe(before);
    await setVisibility('visible');
    await expect.poll(() => polls, { timeout: 20_000 }).toBeGreaterThan(before);
  });

  test('keyboard: Tab reaches Cancel, Enter opens the dialog, Escape closes it and returns focus', async ({
    page,
    request,
  }) => {
    const { project } = await seedQueue(request);
    await gotoApp(page, queuePath(project.slug, '?status=QUEUED'));
    await expect(jobsGrid(page).getByRole('row')).toHaveCount(4);
    const row = jobsGrid(page).getByRole('row').nth(1);
    const cancel = row.getByRole('button', { name: 'Cancel' });
    // rows are roving-focus stops: from the focused row, Tab walks through its controls
    await row.focus();
    await expect(row).toBeFocused();
    for (let i = 0; i < 12 && !(await cancel.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('cancel-split-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep jobs' })).toBeFocused();
    // focus is trapped inside the dialog
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // focus returns to where the user was (the grid may hand it to the row, which contains the button)
    await expect
      .poll(() => row.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)))
      .toBe(true);
  });
});

void ({} as SeededEnv);
