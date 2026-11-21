/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import {
  postHeartbeatControl,
  postJobProgress,
  postWorkerEvents,
  seedLive,
  seedWorkerControl,
} from './support';

interface WorkerState {
  desired: 'running' | 'paused';
  changed_by: string | null;
}
interface WorkerSettings {
  values: Record<string, unknown> & { evaluation: Record<string, unknown> };
}
interface WorkerJob {
  id: string;
  kind: 'backfill_preview' | 'backfill';
}

let seed: Awaited<ReturnType<typeof seedLive>>;
const workerPath = () =>
  `/projects/${seed.projectSlug}/live/worker?${new URLSearchParams({ source: seed.sourceKey })}`;
const apiPath = (suffix = '') =>
  `/api/projects/${seed.projectSlug}/live/worker${suffix}?${new URLSearchParams({ source: seed.sourceKey })}`;

test.beforeEach(async ({ request }) => {
  seed = await seedLive(request, uniqueSlug('live-worker'), { days: 1 });
});

test('waiting for the first version becomes Running v1 with one settings status', async ({
  page,
  request,
}) => {
  await postHeartbeatControl(request, seed.projectId, seed.apiKey, seed.sourceKey, {
    state: 'waiting',
    reason: 'Waiting for settings version 1',
    settings_version_applied: null,
  });
  await gotoApp(page, workerPath());
  const state = page.locator('[data-live-block="worker-status"]');
  await expect(state).toContainText('Waiting for settings version 1');
  const settings = page.locator('[data-live-block="worker-settings"]');
  await expect(settings.getByText('Waiting for version 1', { exact: true })).toHaveCount(1);

  const configured = await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  expect(configured.version).toBe(1);
  await postHeartbeatControl(request, seed.projectId, seed.apiKey, seed.sourceKey, {
    state: 'running',
    reason: null,
    settings_version_applied: configured.version,
    applied_at: new Date().toISOString(),
  });
  await page.reload();
  await expect(state.getByText('v1', { exact: true })).toBeVisible();
  await expect(state.locator('[data-shape="orbit"][data-tone="info"]')).toHaveText('Running');
  await expect(settings.getByText('The worker is running these settings (v1)', { exact: true })).toHaveCount(
    1,
  );
  await expect(settings.locator('[data-kind="state"]')).toHaveCount(0);
  const response = await request.get(apiPath());
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(await response.json()).toMatchObject({
    worker_key: { id: configured.keyId },
    settings: { version: 1 },
  });
});

test('a failed database verification shows the failed chip and worker error', async ({ page, request }) => {
  await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  await postHeartbeatControl(request, seed.projectId, seed.apiKey, seed.sourceKey, {
    state: 'waiting',
    settings_version_applied: null,
    verification: {
      version: 1,
      ok: false,
      checked_at: new Date().toISOString(),
      checks: { 'database.dns': { ok: false, latency_ms: null, error: 'could not translate host name' } },
    },
  });
  await gotoApp(page, workerPath());
  const database = page
    .locator('[data-live-block="worker-settings"]')
    .getByRole('region', { name: 'Database', exact: true });
  await expect(database.locator('[data-kind="state"][data-tone="danger"]')).toHaveText('Failed');
  await expect(database.getByText('could not translate host name', { exact: true })).toBeVisible();
});

test('pausing requires confirmation and records who paused the worker', async ({ page, request }) => {
  await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  await gotoApp(page, workerPath());
  const state = page.locator('[data-live-block="worker-status"]');
  await page.getByRole('button', { name: 'Pause evaluation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Pause evaluation?' });
  await expect(dialog).toBeVisible();
  const before = await request.get(apiPath());
  expect(before.ok(), await before.text()).toBeTruthy();
  expect(await before.json()).toMatchObject({ state: { desired: 'running' } });
  const changed = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith(apiPath('/state')),
  );
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  const response = await changed;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.request().postDataJSON()).toEqual({ state: 'paused' });
  const { state: body } = (await response.json()) as { state: WorkerState };
  expect(body.desired).toBe('paused');
  expect(body.changed_by).toBeTruthy();
  await expect(state).toContainText(`by ${body.changed_by}`);
  await expect(page.getByRole('button', { name: 'Resume evaluation', exact: true })).toBeVisible();
});

test('restoring v1 after saving v2 creates v3 with the restore note and original values', async ({
  page,
  request,
}) => {
  await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  const original = await request.get(apiPath());
  expect(original.ok(), await original.text()).toBeTruthy();
  const v1 = ((await original.json()) as { settings: WorkerSettings }).settings!;
  const saved = await request.post(apiPath('/settings'), {
    data: {
      values: { ...v1.values, evaluation: { ...v1.values.evaluation, parallel_turns: 4 } },
      note: 'Increase parallel turns',
    },
  });
  expect(saved.status(), await saved.text()).toBe(201);
  expect(await saved.json()).toMatchObject({ version: 2 });
  await gotoApp(page, workerPath());
  const history = page.locator('[data-live-block="worker-history"]');
  await history
    .locator('[data-worker-version="1"]')
    .getByRole('button', { name: 'Restore', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Restore version 1?' });
  const restored = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith(apiPath('/settings/1/restore')),
  );
  await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
  const response = await restored;
  expect(response.status(), await response.text()).toBe(201);
  expect(await response.json()).toMatchObject({ version: 3 });
  const row = history.locator('[data-worker-version="3"]');
  await expect(row).toContainText('restored from v1');
  const current = await request.get(apiPath());
  expect(current.ok(), await current.text()).toBeTruthy();
  expect(await current.json()).toMatchObject({
    settings: { version: 3, note: 'restored from v1', values: v1.values },
  });
});

test('date range preview, run, progress and cancellation use the worker jobs API', async ({
  page,
  request,
}) => {
  await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  await gotoApp(page, workerPath());
  await page.getByRole('button', { name: 'Backfill a day range', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Backfill these days?', exact: true });
  const day = seed.days[0]!.day;
  await dialog.getByLabel('From', { exact: true }).fill(day);
  await dialog.getByLabel('To', { exact: true }).fill(day);
  const previewed = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith(apiPath('/jobs')),
  );
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  const previewResponse = await previewed;
  expect(previewResponse.status(), await previewResponse.text()).toBe(201);
  expect(previewResponse.request().postDataJSON()).toEqual({
    kind: 'backfill_preview',
    since_day: day,
    until_day: day,
    limit: 200,
    redo: ['failed'],
  });
  const preview = (await previewResponse.json()) as WorkerJob;
  expect(preview.kind).toBe('backfill_preview');
  await postJobProgress(request, seed.projectId, seed.apiKey, seed.sourceKey, preview.id, {
    status: 'done',
    progress: { found: 12, skipped_existing: 10 },
  });
  await expect(dialog.getByRole('status')).toHaveText('12 turns, 10 already evaluated, 2 to evaluate');
  const queued = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith(apiPath('/jobs')),
  );
  await dialog.getByRole('button', { name: 'Run backfill', exact: true }).click();
  const runResponse = await queued;
  expect(runResponse.status(), await runResponse.text()).toBe(201);
  expect(runResponse.request().postDataJSON()).toEqual({
    kind: 'backfill',
    since_day: day,
    until_day: day,
    limit: 200,
  });
  const job = (await runResponse.json()) as WorkerJob;
  expect(job.kind).toBe('backfill');
  await expect(dialog).not.toBeVisible();
  await postJobProgress(request, seed.projectId, seed.apiKey, seed.sourceKey, job.id, {
    status: 'running',
    progress: { evaluated: 1, found: 2 },
  });
  const row = page
    .locator('[data-live-block="worker-jobs"]')
    .getByRole('row')
    .filter({ has: page.getByText('Backfill', { exact: true }) });
  await expect(row).toContainText('1 of 2');
  await expect(row.locator('[data-col="progress"]')).toHaveText('1 of 2');
  for (const cell of await row.locator('td').all()) {
    await expect(cell).toHaveCSS('vertical-align', 'top');
    expect(await cell.evaluate((node) => parseFloat(getComputedStyle(node).paddingTop))).toBeGreaterThan(0);
  }
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel job?' });
  const cancelled = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith(apiPath(`/jobs/${job.id}/cancel`)),
  );
  await cancel.getByRole('button', { name: 'Cancel job', exact: true }).click();
  const response = await cancelled;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(await response.json()).toMatchObject({ id: job.id, cancel_requested: true });
  await expect(row.getByRole('button', { name: 'Cancel requested', exact: true })).toBeDisabled();
  const error = 'Dataiku did not answer for 10 minutes; the job stopped after 46 of 91 turns.';
  await postJobProgress(request, seed.projectId, seed.apiKey, seed.sourceKey, job.id, {
    status: 'cancelled',
    progress: { evaluated: 46, found: 91 },
    error,
  });
  await page.reload();
  const jobs = page.getByRole('treegrid', { name: 'Worker jobs' });
  await expect(row.locator('[data-col="status"]')).toHaveText('Cancelled');
  await expect(row).not.toContainText(error);
  const detail = row.locator('xpath=following-sibling::tr[1]');
  await expect(detail).toHaveAttribute('data-detail-row', '');
  await expect(detail.locator('td')).toHaveAttribute('colspan', '10');
  await expect(jobs.locator('[data-detail-row]')).toHaveCount(1);
  const message = detail.getByText(error, { exact: true });
  await expect(message).toBeVisible();
  await expect(message).toHaveAttribute('data-tone', 'danger');
  await expect(message).toHaveCSS('overflow-wrap', 'anywhere');
  await expect(message).toHaveCSS('white-space', 'normal');
  const firstCell = (await row.getByText('Backfill', { exact: true }).boundingBox())!;
  const messageBox = (await message.boundingBox())!;
  expect(Math.abs(messageBox.x - firstCell.x)).toBeLessThanOrEqual(1);
  expect(messageBox.width).toBeGreaterThan((await row.locator('[data-col="status"]').boundingBox())!.width);

  await page.setViewportSize({ width: 390, height: 844 });
  const cards = page.getByRole('list', { name: 'Worker jobs' });
  const jobCard = cards.locator(`[data-row-key="${job.id}"]`);
  const cardError = jobCard.locator('xpath=following-sibling::li[1]').getByText(error, { exact: true });
  await expect(cardError).toBeVisible();
  await expect(jobCard).not.toContainText(error);
  await expect(cards.getByRole('button', { name: /Expand row|Collapse row/ })).toHaveCount(0);
  const cardLabelBox = (await jobCard.getByText('Backfill', { exact: true }).boundingBox())!;
  const cardErrorBox = (await cardError.boundingBox())!;
  expect(Math.abs(cardErrorBox.x - cardLabelBox.x)).toBeLessThanOrEqual(1);
  expect(await cardError.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('a 32-day range is refused before submitting either job kind', async ({ page, request }) => {
  await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  await gotoApp(page, workerPath());
  await page.getByRole('button', { name: 'Backfill a day range', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Backfill these days?', exact: true });
  await dialog.getByLabel('From', { exact: true }).fill('2025-01-01');
  await dialog.getByLabel('To', { exact: true }).fill('2025-02-01');
  const submissions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(apiPath('/jobs')))
      submissions.push(request.url());
  });
  for (const name of ['Preview', 'Run backfill']) {
    await dialog.getByRole('button', { name, exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('At most 31 days per job');
  }
  const response = await request.get(apiPath());
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(await response.json()).toMatchObject({ jobs: [] });
  expect(submissions).toEqual([]);
});

test('Problems groups repeated errors, copies a source report and links from the overview badge', async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  const at = new Date().toISOString();
  const langfuse = {
    at,
    level: 'error' as const,
    component: 'langfuse',
    code: 'langfuse_timeout',
    message: 'Langfuse request timed out',
    details: { attempt: 1 },
  };
  await postWorkerEvents(request, seed.projectId, seed.apiKey, seed.sourceKey, [
    langfuse,
    langfuse,
    langfuse,
    {
      at,
      level: 'error',
      component: 'gateway',
      code: 'gateway_unavailable',
      message: 'Gateway unavailable',
      details: {},
    },
  ]);
  await postHeartbeatControl(request, seed.projectId, seed.apiKey, seed.sourceKey, {
    state: 'running',
    settings_version_applied: 1,
    errors_last_hour: 4,
  });
  await gotoApp(page, workerPath());
  const problems = page.locator('[data-live-block="worker-problems"]');
  await expect(problems.locator('[data-worker-event]')).toHaveCount(2);
  const row = problems.locator('[data-worker-event]').filter({ hasText: langfuse.code });
  await expect(row).toContainText('3 times');
  await row.getByRole('button', { name: 'Copy report', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(langfuse.code);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(seed.sourceKey);
  await gotoApp(
    page,
    `/projects/${seed.projectSlug}/live?${new URLSearchParams({ source: seed.sourceKey })}`,
  );
  const status = page.locator('[data-live-block="status"]');
  await expect(status.getByText('Running v1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage worker', exact: true })).toHaveAttribute(
    'href',
    workerPath(),
  );
  await expect(status.getByRole('link', { name: 'Manage', exact: true })).toHaveCount(0);
  const badge = status.getByRole('link', { name: '4 problems in the last hour', exact: true });
  await expect(badge).toHaveAttribute('href', `${workerPath()}#problems`);
  await badge.click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname.endsWith('/live/worker') &&
      url.searchParams.get('source') === seed.sourceKey &&
      url.hash === '#problems',
  );
  await expect(problems).toBeInViewport();
});

test('Problems pages five rows and expands a long raw error within its column', async ({ page, request }) => {
  await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  const raw = 'warehouse-error-'.repeat(40);
  await postWorkerEvents(
    request,
    seed.projectId,
    seed.apiKey,
    seed.sourceKey,
    Array.from({ length: 7 }, (_, i) => ({
      at: new Date().toISOString(),
      level: 'error' as const,
      component: 'dataiku',
      code: `sql_error_${i}`,
      message: `Query failed ${i}`,
      details: { error: raw },
    })),
  );
  await page.setViewportSize({ width: 1366, height: 900 });
  await gotoApp(page, workerPath());
  const problems = page.locator('[data-live-block="worker-problems"]');
  await expect(problems.locator('[data-worker-event]')).toHaveCount(5);
  await expect(problems).toContainText('Showing 1 to 5 of 7 problems');
  const row = problems.locator('[data-worker-event]').first();
  const detail = row.getByText(`error: ${raw}`, { exact: true });
  const cells = row.locator('td');
  for (const cell of await cells.all()) {
    await expect(cell).toHaveCSS('vertical-align', 'top');
    expect(await cell.evaluate((node) => parseFloat(getComputedStyle(node).paddingTop))).toBeGreaterThan(0);
  }
  await expect(row.locator('td').last().getByRole('button', { name: 'Copy report' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Show full error' })).toHaveCSS('padding', '0px');
  await expect(detail).toHaveAttribute('data-collapsed', '');
  expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await row.getByRole('button', { name: 'Show full error' }).click();
  await expect(detail).not.toHaveAttribute('data-collapsed');
  expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await row.getByRole('button', { name: 'Show less' }).click();
  await problems.getByRole('button', { name: 'Next page' }).click();
  await expect(problems.locator('[data-worker-event]')).toHaveCount(2);
  await expect(problems).toContainText('Showing 6 to 7 of 7 problems');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
