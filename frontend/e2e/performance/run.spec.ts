import { test, expect, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import {
  ageRunner,
  breakpointSummary,
  pageApi,
  progressAt,
  QUESTIONS,
  readRun,
  seedPerformance,
  startRun,
  type PerformanceSeed,
} from './support';

async function startedRun(request: Parameters<typeof seedPerformance>[0], prefix: string) {
  const seed = await seedPerformance(request, uniqueSlug(prefix));
  const run = await startRun(request, seed.projectSlug, {
    target_id: seed.preprod.id,
    dataset_version_id: seed.dataset.versionId,
  });
  return { seed, run };
}

function openRun(page: Page, seed: PerformanceSeed, runId: string) {
  return gotoApp(page, `/projects/${seed.projectSlug}/performance/runs/${runId}`);
}

async function openFilter(page: Page, name: string) {
  await page.getByRole('button', { name: `${name} filter` }).click();
  const options = page.getByRole('dialog', { name: `${name} options` });
  await expect(options).toBeVisible();
  return options;
}

const notice = (page: Page) => page.getByTestId('performance-run-notice');
const state = (page: Page) => page.locator('[data-performance-block="content"]');

test('the run page follows the fake runner live, and Stop reaches the runner', async ({ page, request }) => {
  const { seed, run } = await startedRun(request, 'perf-run-live');
  await openRun(page, seed, run.id);
  await expect(page.getByRole('heading', { name: `Run ${run.number}`, exact: true })).toBeVisible();
  await expect(state(page)).toHaveAttribute('data-performance-state', 'queued');
  await expect(notice(page)).toContainText('Queued.');

  const control = await seed.runner.runToLevel20(run.id);
  expect(control.config.test_type).toBe('breakpoint');
  expect(control.config.target.name).toBe('QA - Preprod');
  expect(control.tokens?.map((token) => token.name).sort()).toEqual(['access_token', 'refresh_token']);

  // Numbers, as the runner reported them (the page reads every 5 s while a run is active).
  await expect(state(page)).toHaveAttribute('data-performance-state', 'running', { timeout: 15_000 });
  const numbers = page.getByRole('group', { name: 'The run in numbers' });
  await expect(numbers).toContainText('Users now');
  await expect(numbers).toContainText('20');
  await expect(numbers).toContainText('37');

  // Levels: 10 done, 20 holding.
  const levels = page.getByRole('table', { name: 'Levels' }).or(page.getByRole('grid', { name: 'Levels' }));
  await expect(levels.first()).toContainText('10');
  await expect(levels.first()).toContainText('20');

  // Questions: every record the runner sent, the failed one with its result.
  await page.getByRole('tab', { name: /^Questions/ }).click();
  const questions = page.getByRole('treegrid', { name: 'Questions asked' });
  for (const item of QUESTIONS) await expect(questions).toContainText(item.input);
  const csvHref = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
  const csv = await request.get(csvHref!);
  expect(csv.status()).toBe(200);
  for (const item of QUESTIONS) expect(await csv.text()).toContain(item.item_id);

  // Setup: what was frozen at start.
  await page.getByRole('tab', { name: /^Setup/ }).click();
  await expect(page.getByRole('tabpanel', { name: /^Setup/ })).toContainText('QA - Preprod');
  await expect(page.getByRole('tabpanel', { name: /^Setup/ })).toContainText('QA - Load questions');

  // Log: the lines the runner sent.
  await page.getByRole('tab', { name: /^Log/ }).click();
  const log = page.locator('[data-performance-block="log"]');
  await expect(log).toContainText('runner: QA run started');
  await expect(log).toContainText('status=502');
  // Events: the runner's own and qym's, on the run's timeline.
  await page.getByLabel('Lines to show').getByText('Events', { exact: true }).click();
  const timeline = page.getByLabel('Events of this run');
  await expect(timeline).toContainText('Level 10 passed');

  // A person presses Stop with a reason.
  await page.getByRole('button', { name: 'Stop run', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Stop this run?' });
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('QA - preprod is needed');
  await dialog.getByRole('button', { name: 'Stop run', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(notice(page)).toContainText('Stopping.');

  // The runner sees the stop in its control answer and in its next progress answer.
  const document = await seed.runner.control();
  expect(document.state).toBe('stopping');
  expect(document.run).toMatchObject({
    id: run.id,
    stop_requested: true,
    stop_reason: 'QA - preprod is needed',
  });
  const answer = await seed.runner.progress(run.id, 'stopping', progressAt(control, 'stopping'));
  expect(answer).toMatchObject({ stop_requested: true, stop_reason: 'QA - preprod is needed' });
  await seed.runner.summary(
    run.id,
    breakpointSummary(control, { verdict: 'not_reached', ended_by: 'stop', exit_code: 105 }),
  );
  await seed.runner.report(run.id, '<!doctype html><title>QA report</title><p>Stopped.</p>');
  const final = await seed.runner.progress(run.id, 'stopped', progressAt(control, 'stopping'), {
    exit_code: 105,
  });
  expect(final.status).toBe('stopped');

  await expect(state(page)).toHaveAttribute('data-performance-state', 'stopped', { timeout: 15_000 });
  await expect(notice(page)).toContainText('Stopped.');
  await expect(notice(page)).toContainText('QA - preprod is needed');
  const download = page.getByRole('link', { name: 'Download report' });
  await expect(download).toHaveAttribute('href', new RegExp(`/performance/runs/${run.id}/report$`));
  const report = await request.get(pageApi(seed.projectSlug, `/runs/${run.id}/report`));
  expect(report.status()).toBe(200);
  expect(await report.text()).toContain('<p>Stopped.</p>');

  const document2 = await seed.runner.control();
  expect(document2.state).toBe('idle');
  expect(document2.last_run).toMatchObject({ id: run.id, status: 'stopped' });
});

test('a run whose runner goes silent ends as interrupted and refuses the late runner', async ({
  page,
  request,
}) => {
  const { seed, run } = await startedRun(request, 'perf-run-silent');
  const control = await seed.runner.runToLevel20(run.id);
  await openRun(page, seed, run.id);
  await expect(state(page)).toHaveAttribute('data-performance-state', 'running');

  // 150 s pass without a heartbeat or a report: past the 120 s after which qym ends the run.
  ageRunner(seed.projectId, 150);
  await expect(state(page)).toHaveAttribute('data-performance-state', 'interrupted', { timeout: 15_000 });
  await expect(notice(page)).toContainText('Interrupted.');
  // What the runner reported until then stays on the page.
  await expect(page.getByRole('group', { name: 'The run in numbers' })).toContainText('37');
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toHaveCount(0);

  const read = await readRun(request, seed.projectSlug, run.id);
  expect(read.effective_status).toBe('interrupted');

  // The runner comes back: its run is over, never resumed.
  const refused = await seed.runner.progress(run.id, 'running', progressAt(control), { expected: 409 });
  expect(JSON.stringify(refused)).toContain('run_finished');
  const document = await seed.runner.control();
  expect(document.state).toBe('idle');
  expect(document.last_run).toMatchObject({ id: run.id, status: 'interrupted' });
});

test('the token request appears, a person hands over a token and the runner receives it', async ({
  page,
  request,
}) => {
  const { seed, run } = await startedRun(request, 'perf-run-token');
  const control = await seed.runner.runToLevel20(run.id);
  await openRun(page, seed, run.id);
  await expect(state(page)).toHaveAttribute('data-performance-state', 'running');
  await expect(page.getByRole('button', { name: 'Send a new token' })).toHaveCount(0);

  // The target refused the refresh token: the runner waits for a new one, holding version 1.
  const waiting = await seed.runner.progress(
    run.id,
    'running',
    progressAt(control, 'hold', {
      waiting_for_token: 'refresh_token',
      auth: {
        state: 'rejected',
        token_versions: { refresh_token: 1, access_token: 1 },
        refresh_ok: 4,
        refresh_failed: 1,
        users_rejected: 3,
        users_recovered: 0,
        rejected_at: new Date().toISOString(),
        recovered_at: null,
      },
    }),
  );
  expect(waiting.token_needed).toBe('refresh_token');
  expect((await seed.runner.control()).run?.token_needed).toBe('refresh_token');

  await expect(notice(page)).toContainText('Needs a new token.', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Send a new token' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send a new refresh token' });
  const field = dialog.getByLabel('New refresh token');
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill('qa-new-refresh-token-9z8y');
  await dialog.getByRole('button', { name: 'Send token' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Needs a new token.')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('qa-new-refresh-token-9z8y')).toHaveCount(0);

  // The control answer for the chosen key carries the new value; nobody is asked any more.
  const document = await seed.runner.control();
  expect(document.run?.token_needed).toBeNull();
  const refresh = document.run?.tokens?.find((token) => token.name === 'refresh_token');
  expect(refresh).toMatchObject({ value: 'qa-new-refresh-token-9z8y', hint: '9z8y', version: 2 });
  const recovered = await seed.runner.progress(
    run.id,
    'running',
    progressAt(control, 'hold', {
      auth: { state: 'recovered', token_versions: { refresh_token: 2, access_token: 1 } },
    }),
  );
  expect(recovered).toMatchObject({ token_needed: null, token_versions: { refresh_token: 2 } });

  // The target then answers with a rotated refresh token, which the runner reports back.
  const rotated = await seed.runner.rotateToken(run.id, 'qa-rotated-refresh-7x6w', 2);
  expect(rotated).toEqual({ name: 'refresh_token', version: 3, hint: '7x6w' });
  const targets = (await (await request.get(pageApi(seed.projectSlug, '/targets'))).json()) as {
    targets: { id: string; tokens: { name: string; hint: string; version: number }[] }[];
  };
  const target = targets.targets.find((item) => item.id === seed.preprod.id)!;
  expect(target.tokens.find((token) => token.name === 'refresh_token')).toMatchObject({
    hint: '7x6w',
    version: 3,
  });
  expect(JSON.stringify(targets)).not.toContain('qa-rotated-refresh-7x6w');
});

test('the Questions and Log filters ask the API for what the page shows', async ({ page, request }) => {
  const { seed, run } = await startedRun(request, 'perf-run-filters');
  await seed.runner.runToLevel20(run.id);
  await openRun(page, seed, run.id);
  await expect(state(page)).toHaveAttribute('data-performance-state', 'running');

  await page.getByRole('tab', { name: /^Questions/ }).click();
  const table = page.getByRole('treegrid', { name: 'Questions asked' });
  await expect(table).toContainText(QUESTIONS[5]!.input);

  // The counts in each filter come from the API's facets; "Only" narrows the request.
  const options = await openFilter(page, 'Result');
  await expect(options.getByRole('checkbox', { name: 'OK 5' })).toBeVisible();
  await expect(options.getByRole('checkbox', { name: 'Failed 1' })).toBeVisible();
  await options.getByRole('button', { name: 'Only Failed' }).click();
  await page.keyboard.press('Escape');
  await expect(table).toContainText(QUESTIONS[3]!.input);
  await expect(table).not.toContainText(QUESTIONS[0]!.input);
  await (await openFilter(page, 'Result')).getByRole('button', { name: 'Select all' }).click();
  await page.keyboard.press('Escape');

  const kinds = await openFilter(page, 'Kind');
  await expect(kinds.getByRole('checkbox', { name: 'Complex 2' })).toBeVisible();
  await kinds.getByRole('button', { name: 'Only Complex' }).click();
  await page.keyboard.press('Escape');
  await expect(table).toContainText(QUESTIONS[4]!.input);
  await expect(table).toContainText(QUESTIONS[5]!.input);
  await expect(table).not.toContainText(QUESTIONS[2]!.input);
  await (await openFilter(page, 'Kind')).getByRole('button', { name: 'Select all' }).click();
  await page.keyboard.press('Escape');

  const levels = await openFilter(page, 'Level');
  await expect(levels.getByRole('checkbox', { name: '10 users 3' })).toBeVisible();
  await levels.getByRole('button', { name: 'Only 20 users' }).click();
  await page.keyboard.press('Escape');
  await expect(table).toContainText(QUESTIONS[5]!.input);
  await expect(table).not.toContainText(QUESTIONS[0]!.input);

  const search = page.getByRole('searchbox', { name: 'Search questions and answers' });
  await search.fill('Rank the groups');
  await expect(table).toContainText(QUESTIONS[5]!.input);
  await expect(table).not.toContainText(QUESTIONS[4]!.input);

  // Log: the level filter and the search.
  await page.getByRole('tab', { name: /^Log/ }).click();
  const log = page.locator('[data-performance-block="log"]');
  await expect(log).toContainText('runner: QA run started');
  await (await openFilter(page, 'Level')).getByRole('button', { name: 'Only Warning' }).click();
  await page.keyboard.press('Escape');
  await expect(log).toContainText('status=502');
  await expect(log).not.toContainText('runner: QA run started');
  const text = await request.get(pageApi(seed.projectSlug, `/runs/${run.id}/log.txt`));
  expect(text.status()).toBe(200);
  expect(await text.text()).toContain('runner: QA run started');
});

test('a result the runner sends after the run was interrupted is still stored and shown', async ({
  page,
  request,
}) => {
  const { seed, run } = await startedRun(request, 'perf-run-late');
  const control = await seed.runner.runToLevel20(run.id);
  ageRunner(seed.projectId, 150);
  await openRun(page, seed, run.id);
  await expect(state(page)).toHaveAttribute('data-performance-state', 'interrupted');
  await expect(page.getByRole('link', { name: 'Download report' })).not.toHaveAttribute('href', /report/);

  // Inside the late window: the summary and the report are taken, the status stays.
  const late = await seed.runner.summary(run.id, breakpointSummary(control, { ended_by: 'runner' }));
  expect(late.verdict).toBe('breakpoint_found');
  await seed.runner.report(run.id, '<!doctype html><title>QA report</title><p>Late.</p>');
  await expect(page.getByRole('link', { name: 'Download report' })).toHaveAttribute('href', /report$/, {
    timeout: 25_000,
  });
  await expect(state(page)).toHaveAttribute('data-performance-state', 'interrupted');
  await expect(page.getByRole('group', { name: 'The run in numbers' })).toContainText('Safe load');
  const read = await readRun(request, seed.projectSlug, run.id);
  expect(read).toMatchObject({ effective_status: 'interrupted', summary: { verdict: 'breakpoint_found' } });
});

test('a queued run that no runner claims ends as expired', async ({ page, request }) => {
  const { seed, run } = await startedRun(request, 'perf-run-expired');
  await openRun(page, seed, run.id);
  await expect(state(page)).toHaveAttribute('data-performance-state', 'queued');
  // Eleven minutes pass without a claim: past the ten a queued run waits.
  ageRunner(seed.projectId, 660);
  await expect(state(page)).toHaveAttribute('data-performance-state', 'expired', { timeout: 15_000 });
  await expect(notice(page)).toContainText('Expired.');
  const claim = await request.post(`${seed.runner.base}/runs/${run.id}/claim`, {
    headers: { Authorization: `Bearer ${seed.apiKey}`, 'X-Qym-Runner-Instance': seed.runner.instance },
    data: {},
  });
  expect(claim.status()).toBe(409);
  expect(await claim.text()).toContain('run_not_queued');
});
