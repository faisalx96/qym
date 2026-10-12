/// <reference lib="dom" />
/** Analyzer scenarios 6-9: Test Selected, Analyze job lifecycle, cancel / resume / sample guard, human-label overwrite. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { analysisUrl, seedAnalyzer, step, toggleBox, trackErrors, waitWorkspace } from './helpers';

const jobRegion = (page: Page) => page.getByRole('region', { name: 'Analysis job' });

async function openRun(page: Page, slug: string, runId: string, query = ''): Promise<void> {
  await gotoApp(page, analysisUrl(slug, runId, query));
  await waitWorkspace(page);
  await step(page, 'Run').click();
  await expect(page.getByRole('button', { name: /^Analyze \d+ items?$/ })).toBeVisible();
}

test.describe('Test Selected (6)', () => {
  test('stub result card shows issues, confidence and Fields sent; nothing is saved', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    const t = trackErrors(page);
    await openRun(page, seed.slug, seed.runId);
    await page.getByRole('button', { name: 'Test Selected (1)' }).click();
    const card = page.getByRole('article', { name: 'Test result for item item-1' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('82% confidence');
    await expect(card).toContainText('Retrieval');
    await expect(card).toContainText('The answer does not use the supplied context.');
    await expect(card).toContainText('Fields sent:');
    for (const f of ['Input', 'Expected', 'Output']) await expect(card.getByText(f, { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Test results' }).or(page.getByLabel('Test results')).first()).toBeFocused();
    // a test saves nothing: the Configure step still shows all 4 targets and no "analyzed" tag
    await step(page, 'Configure').click();
    await expect(step(page, 'Configure')).toContainText('4 targets');
    await expect(page.getByText('analyzed', { exact: true })).toHaveCount(0);
    expect(t.errors, t.errors.join('\n')).toEqual([]);
  });

  test('checking up to 3 targets tests them together', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    for (const n of [1, 2, 3, 4]) {
      const box = page.getByRole('checkbox', { name: `Include exact_match of item-${n} in Test Selected` });
      if (n < 4) await toggleBox(box);
      else await expect(box).toBeDisabled(); // the fourth is refused
    }
    await step(page, 'Run').click();
    const body = page.waitForRequest((r) => r.url().includes('/analyze-test'));
    await page.getByRole('button', { name: 'Test Selected (3)' }).click();
    expect(((await body).postDataJSON() as { item_ids: string[] }).item_ids).toEqual(['item-1', 'item-2', 'item-3']);
    await expect(page.getByRole('article', { name: /Test result for item/ })).toHaveCount(3);
  });

  test('Cancel test aborts a slow connection', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { model: 'slow-model' });
    await openRun(page, seed.slug, seed.runId);
    await page.getByRole('button', { name: 'Test Selected (1)' }).click();
    await expect(page.getByText('Testing against the connection')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel test' }).click();
    await expect(page.getByText('Test cancelled.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Test Selected (1)' })).toBeEnabled();
  });
});

test.describe('Analyze job (7)', () => {
  test('stub job: 202 -> progress -> completed, summary on the bar and Review card, then Skip analyzed hides the targets', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    const t = trackErrors(page);
    await openRun(page, seed.slug, seed.runId);
    const created = page.waitForResponse((r) => r.url().endsWith('/analysis-jobs') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Analyze 4 items' }).click();
    expect((await created).status()).toBe(202);
    await expect(jobRegion(page)).toBeVisible();
    await expect(jobRegion(page)).toContainText('6 of 6 metric analyses succeeded', { timeout: 30_000 });
    await expect(jobRegion(page).getByText('Completed')).toBeVisible();
    await expect(jobRegion(page).getByRole('link', { name: 'View run' })).toHaveAttribute('href', new RegExp(`/projects/${seed.slug}/runs/${seed.runId}$`));
    await expect(page.getByText('Analysis finished: 6 of 6 metric analyses succeeded').first()).toBeVisible();
    // Review step: the bar gives way to the card
    await jobRegion(page).getByRole('button', { name: 'Review results' }).click();
    await expect(page).toHaveURL(/step=review/);
    const card = jobRegion(page);
    await expect(card).toContainText('6 of 6 metric analyses succeeded.');
    await expect(card.getByText('Analysis complete')).toBeVisible();
    await expect(card.getByRole('link', { name: 'View run' })).toBeVisible();
    await expect(step(page, 'Review')).toContainText('Complete');

    // Skip analyzed now drops the analysed targets
    await step(page, 'Configure').click();
    await expect(page.getByText('All matching targets already have analysis')).toBeVisible();
    await page.getByRole('button', { name: 'Include analyzed targets' }).click();
    await expect(page.getByText('4 items with failed metric targets')).toBeVisible();
    await expect(page.getByText('analyzed', { exact: true }).first()).toBeVisible();
    expect(t.errors, t.errors.join('\n')).toEqual([]);
  });

  test('mocked job: retrying phase note, completed with one error, error-code group', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    let polls = 0;
    const now = new Date().toISOString();
    const base = {
      job_id: 'analysis_mock1',
      run_id: seed.runId,
      pass_number: null,
      cancel_requested: false,
      created_at: now,
      updated_at: now,
      completed_at: null,
      error: null,
    };
    await page.route(/\/api\/runs\/[^/]+\/analysis-jobs$/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 202,
        json: { ...base, status: 'queued', progress: { phase: 'queued', completed: 0, total: 3, errors: 0, retries: 0 }, result: null },
      });
    });
    await page.route(/\/api\/runs\/[^/]+\/analysis-jobs\/analysis_mock1$/, async (route) => {
      polls += 1;
      if (polls < 3)
        return route.fulfill({
          json: {
            ...base,
            status: 'running',
            progress: {
              phase: 'retrying',
              completed: 1,
              total: 3,
              errors: 0,
              retries: 1,
              item_id: 'item-2',
              metric_name: 'exact_match',
              retry_attempt: 2,
              retry_max_attempts: 3,
              retry_reason: 'rate limited',
            },
            result: null,
          },
        });
      await route.fulfill({
        json: {
          ...base,
          status: 'completed',
          completed_at: now,
          progress: { phase: 'completed', completed: 3, total: 3, errors: 1, retries: 1 },
          result: {
            total_attempted: 3,
            total_analyzed: 2,
            total_analysis_failed: 1,
            results: [
              { item_id: 'item-1', metric_name: 'exact_match' },
              { item_id: 'item-2', metric_name: 'exact_match' },
              { item_id: 'item-3', metric_name: 'exact_match', error: 'The provider timed out', error_code: 'llm_timeout' },
            ],
          },
        },
      });
    });
    await openRun(page, seed.slug, seed.runId);
    await page.getByRole('button', { name: 'Analyze 4 items' }).click();
    await expect(jobRegion(page)).toContainText('Retrying exact_match on item-2 (attempt 2 of 3): rate limited');
    await expect(jobRegion(page).getByText('Retrying', { exact: true })).toBeVisible();
    await expect(jobRegion(page)).toContainText('2 of 3 metric analyses succeeded, 1 failed');
    await jobRegion(page).getByRole('button', { name: 'Review results' }).click();
    await expect(page.getByText('Completed with errors')).toBeVisible();
    const groups = page.getByRole('list', { name: 'Errors by code' });
    await expect(groups).toContainText('llm_timeout');
    await expect(groups).toContainText('1 target');
  });

  test('mocked job: a dropped status poll shows Reconnecting, then the failure text from the backend', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    let polls = 0;
    const now = new Date().toISOString();
    const base = { job_id: 'analysis_mock2', run_id: seed.runId, pass_number: null, cancel_requested: false, created_at: now, updated_at: now, completed_at: null };
    await page.route(/\/api\/runs\/[^/]+\/analysis-jobs$/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 202,
        json: { ...base, error: null, status: 'queued', progress: { phase: 'queued', completed: 0, total: 3, errors: 0, retries: 0 }, result: null },
      });
    });
    await page.route(/\/api\/runs\/[^/]+\/analysis-jobs\/analysis_mock2$/, async (route) => {
      polls += 1;
      if (polls === 1)
        return route.fulfill({ json: { ...base, error: null, status: 'running', progress: { phase: 'analyzing', completed: 1, total: 3, errors: 0, retries: 0 }, result: null } });
      if (polls < 6) return route.fulfill({ status: 503, json: { detail: 'unavailable' } });
      await route.fulfill({
        json: { ...base, status: 'failed', error: 'LLM provider rejected the API key', completed_at: now, progress: { phase: 'failed', completed: 1, total: 3, errors: 1, retries: 0 }, result: null },
      });
    });
    await openRun(page, seed.slug, seed.runId);
    await page.getByRole('button', { name: 'Analyze 4 items' }).click();
    await expect(jobRegion(page)).toContainText('Reconnecting to the background analysis');
    await expect(jobRegion(page)).toContainText('LLM provider rejected the API key');
  });
});

test.describe('cancel, resume and the sample guard (8)', () => {
  test('cancel mid-job: Cancelling then cancelled; the toast keeps analysed items', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { model: 'slow-model' });
    await openRun(page, seed.slug, seed.runId);
    await page.getByRole('button', { name: 'Analyze 4 items' }).click();
    await expect(jobRegion(page).getByRole('button', { name: 'Cancel analysis' })).toBeVisible();
    // hold the cancel response briefly so the transient state is observable
    await page.route(/analysis-jobs\/[^/]+\/cancel$/, async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    await jobRegion(page).getByRole('button', { name: 'Cancel analysis' }).click();
    await expect(jobRegion(page).getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
    await expect(jobRegion(page).getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText('Analysis cancelled. Items already analyzed were kept.').first()).toBeVisible();
    await expect(jobRegion(page)).toContainText('Stopped at');
    await expect(page.getByRole('button', { name: /^Analyze \d+ items?$/ })).toBeEnabled();
  });

  test('switching sample while a job runs is blocked; reload resumes via analysis-jobs/active', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { model: 'slow-model', withRepeat: true });
    await gotoApp(page, analysisUrl(seed.slug, seed.repeatId!, '&pass=1'));
    await waitWorkspace(page);
    await step(page, 'Run').click();
    await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
    await expect(jobRegion(page).getByRole('button', { name: 'Cancel analysis' })).toBeVisible();
    // Configure shows the Sample select disabled with the reason
    await step(page, 'Configure').click();
    const sample = page.getByRole('button', { name: /Sample 1 \(4\/4\)/ });
    await expect(sample).toBeDisabled();
    await expect(page.getByText('Wait for the running job, or cancel it, to switch samples.')).toBeVisible();

    // reload: the job is still running on the server and the bar resumes
    const active = page.waitForResponse((r) => /analysis-jobs\/active/.test(r.url()));
    await page.reload();
    await waitWorkspace(page);
    expect((await active).ok()).toBeTruthy();
    await expect(jobRegion(page)).toBeVisible();
    await expect(jobRegion(page).getByRole('button', { name: 'Cancel analysis' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sample 1 \(4\/4\)/ })).toBeDisabled();
    // tidy up: cancel and wait for the server to finish the job
    await jobRegion(page).getByRole('button', { name: 'Cancel analysis' }).click();
    await expect(jobRegion(page).getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 40_000 });
  });
});

test.describe('re-analyze human labels (9)', () => {
  test('confirm lists the metrics; Keep human labels does not POST; confirming does with allow_human_overwrite', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    // a real human diagnosis on item-1 / exact_match
    const human = await request.post('/api/runs/update_root_cause', {
      data: {
        run_id: seed.runId,
        item_id: 'item-1',
        metric_name: 'exact_match',
        root_cause_issues: [{ category: 'Wrong Format', subcategory: 'Extra column', finding: 'Selected id only.' }],
      },
    });
    expect(human.ok(), await human.text()).toBeTruthy();
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    // human labels are protected by default: item-1 only keeps execution_accuracy
    await expect(page.getByRole('button', { name: /exact_match 0.00, preview target of item-1/ })).toHaveCount(0);
    await toggleBox(page.getByRole('switch', { name: 'Re-analyze human labels' }));
    await expect(page.getByRole('button', { name: /exact_match 0.00, preview target of item-1/ })).toBeVisible();
    await expect(page.getByText('human', { exact: true }).first()).toBeVisible();

    await step(page, 'Run').click();
    let posted = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/analysis-jobs')) posted += 1;
    });
    await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog.getByText('Overwrite human diagnoses?')).toBeVisible();
    await expect(dialog).toContainText('Metrics affected: exact_match.');
    await expect(dialog).toContainText('This will replace 1 human metric diagnosis');
    await dialog.getByRole('button', { name: 'Keep human labels' }).click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(400);
    expect(posted).toBe(0);

    await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
    const req = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/analysis-jobs'));
    await page.getByRole('button', { name: 'Re-analyze human labels' }).click();
    expect(((await req).postDataJSON() as { allow_human_overwrite: boolean }).allow_human_overwrite).toBe(true);
    await expect(jobRegion(page)).toContainText('metric analyses succeeded', { timeout: 30_000 });
  });
});
