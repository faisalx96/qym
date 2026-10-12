/// <reference lib="dom" />
/** Admin Maintenance tab (brief 09 §8.8). SQLite: db_stats errors. The e2e platform
 * runs its background loops (QYM_ROLE=all, needed by the experiments and analyzer areas), so a queued job is
 * picked up within seconds: the polling test pins the job's status to `running` in the list response. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';

async function pickJob(page: Page, kind: string) {
  const form = page.locator('[data-enqueue-form]');
  await form.getByRole('button', { name: /Job/ }).click();
  const search = page.getByRole('searchbox').first();
  if (await search.isVisible().catch(() => false)) await search.fill(kind);
  await page
    .getByRole('option', { name: new RegExp(kind) })
    .first()
    .click();
  await expect(form.getByRole('button', { name: /Job/ })).toContainText(kind);
}

test('tab loads with summary and the db_stats error state on SQLite', async ({ page }) => {
  await gotoApp(page, '/admin/maintenance');
  await expect(page.locator('[data-maintenance-summary]')).toBeVisible();
  await expect(page.locator('[data-stats-error]')).toContainText('need PostgreSQL');
  await expect(page.locator('[data-enqueue-form]')).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Maintenance jobs' })).toBeVisible();
});

test('server rejects an irreversible job without confirm (direct API 400)', async ({ request }) => {
  const bad = await request.post('/api/admin/maintenance/jobs', {
    data: { kind: 'drop_legacy_spans', params: {} },
  });
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain('confirm');
});

test('queue a reversible job, open its log, and polling runs every ~3 s while it is active', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await gotoApp(page, '/admin/maintenance');
  await expect(page.locator('[data-enqueue-form]')).toBeVisible();
  await pickJob(page, 'vacuum_analyze');
  const form = page.locator('[data-enqueue-form]');
  await expect(form.getByLabel(/^Type .*to confirm/)).toHaveCount(0);
  await page.route(/\/api\/admin\/maintenance(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { jobs: { kind: string; status: string }[] };
    body.jobs = body.jobs.map((j) => (j.kind === 'vacuum_analyze' ? { ...j, status: 'running' } : j));
    return route.fulfill({ response: res, json: body });
  });
  await form.getByRole('button', { name: 'Queue job' }).click();
  await expect(page.getByText('Queued vacuum_analyze')).toBeVisible();
  const table = page.getByRole('grid', { name: 'Maintenance jobs' });
  const row = table.getByRole('row').filter({ hasText: 'vacuum_analyze' }).first();
  await expect(row).toBeVisible();
  // A job is queued/running => "active" => 3 s polling.
  await expect(page.getByText('Refreshing every 3 s while jobs are active')).toBeVisible();

  let gets = 0;
  page.on('request', (r) => {
    if (r.method() === 'GET' && /\/api\/admin\/maintenance(\?|$)/.test(r.url())) gets++;
  });
  await page.waitForTimeout(7200);
  expect(gets, `maintenance GETs over 7.2 s: ${gets}`).toBeGreaterThanOrEqual(2);
  expect(gets).toBeLessThanOrEqual(4);

  await row.getByRole('button', { name: /^Log for/ }).click();
  const drawer = page.locator('[data-job-log-drawer]');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Job id');
  await expect(page.getByRole('dialog').filter({ hasText: 'vacuum_analyze log' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // Cancel it so later runs of the suite start from fewer active jobs.
  await row.getByRole('button', { name: 'Cancel' }).click();
});

test('irreversible job needs the typed name; the button stays disabled until it matches', async ({
  page,
}) => {
  await gotoApp(page, '/admin/maintenance');
  await expect(page.locator('[data-enqueue-form]')).toBeVisible();
  await pickJob(page, 'drop_legacy_spans');
  const form = page.locator('[data-enqueue-form]');
  const submit = form.getByRole('button', { name: 'Queue irreversible job' });
  const field = form.getByLabel(/^Type .*to confirm/);
  await expect(field).toBeVisible();
  await expect(form.locator('[data-kind-help]')).toContainText('irreversible');
  await expect(submit).toBeDisabled();
  await field.fill('drop_legacy');
  await expect(submit).toBeDisabled();
  await field.fill('drop_legacy_spans');
  await expect(submit).toBeEnabled();

  const reqP = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes('/api/admin/maintenance/jobs'),
  );
  await submit.click();
  const body = (await reqP).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ kind: 'drop_legacy_spans', confirm: 'drop_legacy_spans' });
  await expect(page.getByText('Queued drop_legacy_spans')).toBeVisible();
  const row = page
    .getByRole('grid', { name: 'Maintenance jobs' })
    .getByRole('row')
    .filter({ hasText: 'drop_legacy_spans' })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Cancel' }).click();
});

test('invalid params JSON blocks submit', async ({ page }) => {
  await gotoApp(page, '/admin/maintenance');
  const form = page.locator('[data-enqueue-form]');
  await expect(form).toBeVisible();
  await form.getByLabel('Params (JSON)').fill('{oops');
  await expect(form.getByRole('button', { name: /^Queue/ })).toBeDisabled();
  await form.getByLabel('Params (JSON)').fill('[1]');
  await expect(form.getByRole('button', { name: /^Queue/ })).toBeDisabled();
  await form.getByLabel('Params (JSON)').fill('{"tables": []}');
  await expect(form.getByRole('button', { name: /^Queue/ })).toBeEnabled();
});

test('invalid params JSON shows its inline error message', async ({ page }) => {
  await gotoApp(page, '/admin/maintenance');
  const form = page.locator('[data-enqueue-form]');
  await form.getByLabel('Params (JSON)').fill('{oops');
  await expect(form.getByText('Params must be valid JSON.')).toBeVisible();
});

test('workers service liveness shows in the header (mocked separate workers)', async ({ page }) => {
  await page.route(/\/api\/admin\/maintenance(\?|$)/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.workers = {
      ...body.workers,
      loops: 'separate',
      workers_service: { alive: false, processes: [{ alive: false }, { alive: false }] },
    };
    await route.fulfill({ response: res, json: body });
  });
  await gotoApp(page, '/admin/maintenance');
  await expect(page.locator('[data-workers-service]')).toContainText('NOT RESPONDING (0/2 processes)');
});
