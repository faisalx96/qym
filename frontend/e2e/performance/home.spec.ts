import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoApp, uniqueSlug } from '../helpers';
import { breakpointSummary, progressAt, seedPerformance, startRun } from './support';

test('Home shows the runner, the run in progress and, once it ends, the result and the history', async ({
  page,
  request,
}) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-home'));
  const slug = seed.projectSlug;
  await gotoApp(page, `/projects/${slug}/performance`);
  const runnerLine = page.locator('[data-performance-block="runner-line"]');
  await expect(runnerLine).toContainText('Connected');
  await expect(page.locator('[data-performance-block="first-run"]')).toContainText('No runs yet');

  const run = await startRun(request, slug, {
    target_id: seed.preprod.id,
    dataset_version_id: seed.dataset.versionId,
  });
  const control = await seed.runner.runToLevel20(run.id);
  await page.reload();
  const active = page.getByRole('region', { name: 'Run in progress' });
  await expect(active).toContainText(`Run ${run.number}`);
  // The run's name opens it; no "Open run" beside a name that opens the same page (B17).
  await expect(active.getByRole('link', { name: `Run ${run.number}`, exact: true })).toBeVisible();
  await expect(active.getByRole('link', { name: 'Open run' })).toHaveCount(0);
  await expect(active).toContainText('QA - Preprod');

  // The runner ends the run with its result: breaks at 20 users, safe load 10.
  await seed.runner.summary(run.id, breakpointSummary(control));
  await seed.runner.report(run.id, '<!doctype html><title>QA report</title><p>Breaks at 20.</p>');
  const finished = await seed.runner.progress(run.id, 'finished', progressAt(control), { exit_code: 99 });
  expect(finished.status).toBe('finished');

  // The page reads every 5 s while a run is active and once more when it ends.
  await expect(active).toHaveCount(0, { timeout: 15_000 });
  const capacity = page.locator('[data-performance-block="capacity"]');
  await expect(capacity).toContainText('Safe load');
  await expect(capacity).toContainText('10');
  await expect(capacity).toContainText('20');
  const runs = page.getByRole('region', { name: 'Runs' });
  const row = runs.locator(`[data-performance-run="${run.number}"]`);
  await expect(row).toContainText('Breakpoint');
  await expect(row).toContainText('QA - Preprod');

  await row.getByRole('gridcell', { name: 'QA - Preprod' }).click();
  await expect(page.getByRole('heading', { name: `Run ${run.number}`, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download report' })).toBeVisible();
});

test('the seed script fills a project the Home page reads', async ({ page }) => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(here, '..', '..', '..');
  const venv = path.join(repo, '.venv', 'bin', 'python');
  const python = process.env.QYM_PYTHON ?? (fs.existsSync(venv) ? venv : 'python');
  const slug = uniqueSlug('perf-seeded');
  const out = execFileSync(
    python,
    [
      path.join(repo, 'frontend', 'scripts', 'seed_performance.py'),
      '--base',
      `http://127.0.0.1:${process.env.QYM_PLATFORM_PORT ?? '8800'}`,
      '--slug',
      slug,
      '--running',
    ],
    { cwd: repo, encoding: 'utf-8' },
  );
  expect(out).toContain('breakpoint, running at 20 users');

  await gotoApp(page, `/projects/${slug}/performance`);
  await expect(page.getByRole('region', { name: 'Run in progress' })).toContainText('Run 3');
  const runs = page.getByRole('region', { name: 'Runs' });
  await expect(runs.locator('[data-performance-run="1"]')).toContainText('Breakpoint');
  await expect(runs.locator('[data-performance-run="2"]')).toContainText('Smoke');
});

test('Stop on the Home page reaches the runner, and the runs filters narrow the history', async ({
  page,
  request,
}) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-home-stop'));
  const slug = seed.projectSlug;
  const first = await startRun(request, slug, {
    target_id: seed.preprod.id,
    dataset_version_id: seed.dataset.versionId,
  });
  const control = await seed.runner.runToLevel20(first.id);
  await gotoApp(page, `/projects/${slug}/performance`);
  const active = page.getByRole('region', { name: 'Run in progress' });
  await active.getByRole('button', { name: 'Stop run' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stop this run?' });
  await dialog.getByRole('button', { name: 'Stop run', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const document = await seed.runner.control();
  expect(document).toMatchObject({ state: 'stopping', run: { id: first.id, stop_requested: true } });
  await seed.runner.progress(first.id, 'stopped', progressAt(control, 'stopping'), { exit_code: 105 });
  await expect(active).toHaveCount(0, { timeout: 15_000 });

  // A Smoke run on the same target, then the Test filter.
  const smoke = await startRun(request, slug, {
    target_id: seed.preprod.id,
    dataset_version_id: seed.dataset.versionId,
    test_type: 'smoke',
  });
  const smokeRun = await seed.runner.waitForQueued(smoke.id);
  await seed.runner.claim(smoke.id);
  await seed.runner.progress(smoke.id, 'running', {
    ...progressAt(control),
    levels: [],
    phase: 'steady',
    level: null,
  });
  await seed.runner.progress(
    smoke.id,
    'finished',
    { ...progressAt(control), levels: [], phase: 'steady', level: null },
    { exit_code: 0 },
  );
  expect(smokeRun.config.test_type).toBe('smoke');
  await page.reload();
  const runs = page.getByRole('region', { name: 'Runs' });
  await expect(runs.locator(`[data-performance-run="${smoke.number}"]`)).toContainText('Smoke');
  await expect(runs.locator(`[data-performance-run="${first.number}"]`)).toContainText('Breakpoint');
  const narrowed = page.waitForRequest(
    (r) => r.url().includes('/performance/runs?') && r.url().includes('test_type=smoke'),
  );
  await runs.getByRole('button', { name: 'Test filter' }).click();
  await page
    .getByRole('dialog', { name: 'Test options' })
    .getByRole('button', { name: 'Only Smoke' })
    .click();
  await page.keyboard.press('Escape');
  await narrowed;
  await expect(runs.locator(`[data-performance-run="${first.number}"]`)).toHaveCount(0);
  await expect(runs.locator(`[data-performance-run="${smoke.number}"]`)).toContainText('Smoke');
});
