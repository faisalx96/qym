/* eslint-disable @typescript-eslint/no-explicit-any -- API bodies are untyped JSON here */
/**
 * WP-D: the experiment page of an experiment with several dataset versions (spec-d QD-53 to QD-62): the
 * "Datasets and task" card, the matrix rows per dataset version, the job history grouped by dataset version with
 * its Task column, the retry of one fanned-out pair and the queue page. Numbers at 1440 / 1024 / 390.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  expectNoPageOverflow,
  expPath,
  FAKE_A,
  FAKE_B,
  finishJob,
  getExperiment,
  launchExperiment,
  resetFakes,
  test,
  waitForSubmitted,
} from './support';
import { seedMulti, sized, WIDTHS, type MultiFixture } from './launch/multiSupport';

test.setTimeout(180_000);
test.use({ actionTimeout: 10_000 });

const SHOTS = process.env.QYM_SHOTS_DIR;
let f: MultiFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedMulti(request);
});
function save(name: string, data: unknown): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify(data, null, 2));
}

const PAIRS = [
  { dataset: 'support-tickets', version: 'v3' },
  { dataset: 'support-tickets', version: 'v2' },
  { dataset: 'billing-faq', version: 'v2' },
  { dataset: 'billing-faq', version: 'v1' },
];
async function launchMulti(request: Parameters<typeof launchExperiment>[0], shape: 'combined' | 'one_each' = 'combined') {
  const x = await launchExperiment(request, f.project.id, {
    name: 'nightly multi-dataset',
    environment_ids: [f.production.id, f.staging.id],
    spec: {
      evaluator: { datasets: PAIRS, run_shape: shape, task: { [f.production.id]: 'answer-ticket' }, config: { samples: 1 } },
      slot_bindings: { 'endpoint:primary': { connection_id: f.connectionId } },
      env_overrides: {},
    },
  });
  await waitForSubmitted(request, f.project.id, x.id);
  return x;
}
const page0 = (slug: string, id: string) => expPath(slug, `/${id}`);
const card = (page: Page) => page.getByRole('region', { name: 'Datasets and task' });
const matrix = (page: Page) => page.locator('[data-exp-matrix]');

test.describe('experiment detail with several dataset versions', () => {
  for (const width of WIDTHS) {
    test(`card, matrix and history at ${width}px (QD-53 to QD-58, QD-62)`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 1000 });
      const x = await launchMulti(request);
      // A few finished jobs so the matrix shows metrics-less success cells too.
      const prodJob = x.jobs.find((j) => j.environment_id === f.production.id)!;
      await finishJob(request, f.project.id, x.id, prodJob.id, 'SUCCEEDED', null, FAKE_A);
      await gotoApp(page, page0(f.project.slug, x.id));
      const m: Record<string, unknown> = { width };
      // QD-53/QD-54: the card.
      await expect(card(page)).toBeVisible();
      await expect(page.getByTestId('detail-datasets').locator('span')).toHaveText([
        'support-tickets · v3',
        'support-tickets · v2',
        'billing-faq · v2',
        'billing-faq · v1',
      ]);
      await expect(card(page)).toContainText('Combine into one run');
      const lines = page.getByTestId('detail-env-lines').getByRole('listitem');
      await expect(lines).toHaveText([
        /^production\s*1 combined run · task Answer a ticket$/,
        /^staging\s*4 jobs, one per dataset version \(older Evaluation Service\) · Worker default task$/,
      ]);
      m['card'] = await sized(card(page));
      // QD-55: the stat strip counts the current jobs (1 combined + 4 pairs).
      await expect(page.getByRole('group', { name: 'Job totals' }).or(page.getByLabel('Job totals'))).toContainText('5');
      m['strip'] = await sized(page.getByLabel('Job totals'));
      // QD-56: one row per (combination, dataset): the combined row first, then four pairs.
      const rows = matrix(page).locator('tbody tr');
      await expect(rows).toHaveCount(5);
      await expect(rows.nth(0).locator('th')).toContainText('All 4 dataset versions');
      await expect(rows.nth(0).locator('th')).toContainText('combined');
      await expect(rows.nth(1).locator('th')).toContainText('support-tickets · v3');
      await expect(rows.nth(1).locator('th')).toContainText('#0 · pair 1');
      await expect(rows.nth(4).locator('th')).toContainText('billing-faq · v1');
      // "—" where an environment has no job for that row.
      await expect(rows.nth(0).locator('td').nth(1)).toHaveText('—');
      await expect(rows.nth(1).locator('td').nth(0)).toHaveText('—');
      m['matrix'] = await sized(matrix(page));
      // QD-57/QD-58: grouped history, the combined job first; a Task column.
      const history = page.locator('[data-exp-jobs]');
      const groups = history.locator('[data-job-group]');
      await expect(groups).toHaveText([
        'All 4 dataset versions · one combined run',
        'support-tickets · v3',
        'support-tickets · v2',
        'billing-faq · v2',
        'billing-faq · v1',
      ]);
      // Priority-3 columns give way to the card layout on a phone: the Task column header exists above it.
      if (width > 480) await expect(history.getByRole('columnheader', { name: 'Task' })).toBeVisible();
      if (width > 480) {
        await expect(history).toContainText('Answer a ticket');
        await expect(history).toContainText('Worker default');
      }
      m['history'] = await sized(history);
      await expectNoPageOverflow(page);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `after-d-detail-${width}.png`), fullPage: true });
      save(`measure-d-detail-${width}`, m);
    });
  }

  test('a plain experiment has no card and keeps its matrix (QD-53, QD-56)', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const x = await launchExperiment(request, f.project.id, {
      name: 'plain',
      environment_ids: [f.staging.id],
      spec: {
        evaluator: { dataset: 'support-tickets', config: { samples: 1 } },
        slot_bindings: { 'endpoint:primary': { connection_id: f.connectionId } },
        env_overrides: {},
      },
    });
    await gotoApp(page, page0(f.project.slug, x.id));
    await expect(page.getByRole('heading', { name: 'Matrix' })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expect(matrix(page).locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('[data-job-group]')).toHaveCount(0);
    save('measure-d-detail-plain-1440', { header: await sized(page.getByRole('heading', { level: 1 }).first()) });
  });

  test('QD-59: retrying one fanned-out pair makes attempt 2 of the same pair and supersedes only it', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const x = await launchMulti(request, 'one_each');
    const detail: any = await getExperiment(request, f.project.id, x.id);
    expect(detail.jobs).toHaveLength(8);
    const target = detail.jobs.find((j: any) => j.environment_id === f.staging.id && j.dataset_index === 1);
    await finishJob(request, f.project.id, x.id, target.id, 'FAILED', 'boom', FAKE_B);
    await gotoApp(page, page0(f.project.slug, x.id));
    const row = matrix(page).locator('tbody tr').filter({ hasText: 'support-tickets · v2' });
    await row.getByRole('button', { name: /^Retry/ }).click();
    await expect(row).toContainText('↻ 1 earlier', { timeout: 15_000 });
    const after: any = await getExperiment(request, f.project.id, x.id);
    const retry = after.jobs.find((j: any) => j.retry_of_job_id === target.id);
    expect(retry).toMatchObject({ combo_index: 0, dataset_index: 1, attempt: 1 });
    expect(retry.dataset).toEqual({ dataset: 'support-tickets', version: 'v2', alias: null });
    expect(after.jobs.filter((j: any) => j.superseded).map((j: any) => j.id)).toEqual([target.id]);
    // The other pairs are untouched and the strip counts current jobs only.
    await expect(page.getByLabel('Job totals')).toContainText('8');
  });

  test('QD-60: the queue page names a fanned-out job by its pair', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const x = await launchMulti(request, 'one_each');
    await gotoApp(page, expPath(f.project.slug, '/queue'));
    await expect(page.getByRole('link', { name: /nightly multi-dataset #0 · 2/ }).first()).toBeVisible();
    void x;
  });

  test('QD-61: the grouping does not move between polls', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const x = await launchMulti(request);
    await gotoApp(page, page0(f.project.slug, x.id));
    const history = page.locator('[data-exp-jobs]');
    await expect(history.locator('[data-job-group]')).toHaveCount(5);
    const snapshot = () => history.locator('tr').evaluateAll((rows) => rows.map((r) => `${r.className.length}:${Math.round(r.getBoundingClientRect().height)}:${r.textContent?.slice(0, 20)}`));
    const first = await snapshot();
    await page.waitForTimeout(5500); // at least one detail poll
    expect(await snapshot()).toEqual(first);
  });
});
