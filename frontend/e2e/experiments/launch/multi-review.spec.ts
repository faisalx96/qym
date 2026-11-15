/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies and fake jobs are untyped JSON here */
/**
 * WP-D: review pane, problems, Raw JSON and the launch of several dataset versions (spec-d QD-40 to QD-52): the
 * summary lines, the run count and its maths, the cap, Edit links, the Raw JSON round trip, the problems and the
 * `task_unverified` warning, and what the two Evaluation Services (v1.4 and v1.3) really receive.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import {
  fakeJobsOf,
  FAKE_A,
  FAKE_B,
  getExperiment,
  resetFakes,
  setFakeTasks,
  test,
  waitForSubmitted,
} from '../support';
import {
  captureExperimentPosts,
  goStep,
  launchBar,
  launchButton,
  nameBox,
  openLaunch,
  review,
  toReview,
} from './launchSupport';
import {
  addDataset,
  chooseDataset,
  chooseTask,
  composeFour,
  datasetsCard,
  round,
  seedMulti,
  sized,
  WIDTHS,
  type MultiFixture,
} from './multiSupport';

test.setTimeout(180_000);
test.use({ actionTimeout: 10_000 });

const SHOTS = process.env.QYM_SHOTS_DIR;
let f: MultiFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedMulti(request);
});

const both = () => `?env=${f.production.id},${f.staging.id}`;
function save(name: string, data: unknown): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify(data, null, 2));
}

async function setRaw(page: Page, text: string): Promise<void> {
  const content = page.getByRole('region', { name: /^Raw JSON/ }).locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}
/** The document the form currently sends (the editor shows the same text but only renders the visible lines). */
const currentSpec = async (page: Page, posts: ReturnType<typeof captureExperimentPosts>): Promise<any> => {
  const before = posts.dryRuns.length;
  await expect
    .poll(() => posts.dryRuns.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(Math.max(before, 1));
  return JSON.parse(JSON.stringify(posts.dryRuns.at(-1)!.body.spec));
};
async function showRaw(page: Page): Promise<void> {
  await goStep(page, 'review');
  const show = page.getByRole('button', { name: 'Show raw JSON' });
  if (await show.count()) await show.click();
  await expect(page.getByRole('button', { name: 'Hide raw JSON' })).toBeVisible();
}
/** Customize step 1 with the composed state: both environments, 4 dataset versions, a task on production. */
async function composed(
  page: Page,
  shape: 'combined' | 'one_each' = 'combined',
  task?: RegExp,
): Promise<void> {
  await openLaunch(page, f.project.slug, both());
  await composeFour(page);
  await page.getByTestId('env-shape-tag').first().waitFor();
  // One task per experiment (round 9): a named task would flag staging (a v1.3 service), so the default scenario runs Worker default.
  if (task) await chooseTask(page, task);
  // One run each is the default; every scenario picks its shape explicitly.
  // The option's label, not a forced click on the hidden input: at 390 the sticky launch bar can cover the control,
  // and a forced click would land on the bar.
  await page
    .getByTestId('run-shape')
    .getByText(shape === 'one_each' ? 'One run each' : 'Combine into one run', { exact: true })
    .click();
  await expect(
    page
      .getByTestId('run-shape')
      .getByRole('radio', { name: shape === 'one_each' ? 'One run each' : 'Combine into one run' }),
  ).toBeChecked();
  await nameBox(page).fill('multi dataset run');
  // The dry run of this exact state has settled (the next read of it is the form's current document).
  // With a named task staging is flagged (J2), so the bar says why instead of Ready.
  if (!task) await expect(launchBar(page).getByText('Ready to launch')).toBeVisible({ timeout: 15_000 });
  else await expect(launchBar(page)).toContainText(/Fix 1 problem first/, { timeout: 15_000 });
}

test.describe('review, Raw JSON and launch', () => {
  for (const width of WIDTHS) {
    test(`QD-40 to QD-45: the review step at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      // One task for the experiment: staging (v1.3) does not offer it, so this review uses the Worker default there.
      await composed(page);
      const m: Record<string, unknown> = { width };
      await toReview(page);
      const pane = review(page);
      await expect(launchBar(page).getByText('Ready to launch')).toBeVisible({ timeout: 15_000 });
      const summary = page.getByRole('region', { name: 'Summary' });
      await expect(summary.locator('[data-row=env] dd')).toHaveText('production, staging');
      await expect(summary.locator('[data-row=task] dd')).toHaveText('Worker default');
      await expect(summary.locator('[data-row=ds] dd')).toContainText('support-tickets');
      await expect(summary.locator('[data-row=ds] dd')).toContainText('v3, v2');
      await expect(summary.locator('[data-row=ds] dd')).toContainText('billing-faq');
      await expect(summary.locator('[data-row=shape] dd')).toHaveText('Combine into one run');
      await expect(pane).toContainText(
        '1 combination × (production: 1 combined run + staging: 4 runs) = 5 runs',
      );
      m['pane'] = await sized(pane);
      if (SHOTS)
        await page.screenshot({ path: path.join(SHOTS, `after-d-review-step-${width}.png`), fullPage: true });
      save(`measure-d-review-${width}`, m);
    });
  }

  test('QD-42, QD-43: one dataset reads as before; One run each counts 8', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLaunch(page, f.project.slug, both());
    await chooseDataset(page, 'support-tickets');
    await nameBox(page).fill('single');
    await toReview(page);
    const pane = review(page);
    await expect(pane).toContainText('production, staging');
    await expect(pane.locator('[data-row=shape]')).toHaveCount(0);
    await expect(pane).toContainText('1 combination × 2 environments = 2 runs');
    await goStep(page, 'where');
    await addDataset(page, 'billing-faq');
    await page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' }).click({ force: true });
    await toReview(page);
    await expect(pane).toContainText('1 combination × (2 environments × 2 dataset versions) = 4 runs');
    await expect(page.locator('[data-part=run-count]')).toHaveText('4');
  });

  test('QD-44: over the cap there is a callout, no create request and Launch is disabled', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts = captureExperimentPosts(page);
    await composed(page, 'one_each');
    // 4 dataset versions x 2 environments x 9 samples values = 72 jobs > 64
    await showRaw(page);
    const doc = await currentSpec(page, posts);
    doc.evaluator.config = {
      ...(doc.evaluator.config ?? {}),
      samples: { sweep: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    };
    await setRaw(page, JSON.stringify(doc));
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(review(page).getByText('Over the run limit').first()).toBeVisible({ timeout: 15_000 });
    await expect(review(page)).toContainText('choose “Combine into one run”');
    await expect(launchButton(page)).toBeDisabled();
    expect(posts.launches).toHaveLength(0);
  });

  test('QD-46: Edit on Datasets changed opens step 1 and focuses the first Versions trigger', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await composed(page);
    await goStep(page, 'review');
    await review(page).getByRole('button', { name: 'Edit: Datasets changed' }).click();
    await expect(page.getByRole('heading', { name: 'Where it runs', level: 2 })).toBeVisible();
    await expect(
      page
        .locator('li[data-dataset-box]')
        .first()
        .getByRole('button', { name: /^Versions/ }),
    ).toBeFocused();
    await expect(datasetsCard(page)).toBeVisible();
  });

  test('QD-47, QD-48: Raw JSON shows the list, the shape and the task; apply round-trips', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts = captureExperimentPosts(page);
    await composed(page, 'combined', /Answer a ticket/);
    await expect
      .poll(() => posts.dryRuns.at(-1)?.body.spec.evaluator.task, { timeout: 10_000 })
      .toBe('answer-ticket');
    const doc = await currentSpec(page, posts);
    await showRaw(page);
    const raw = page.getByRole('region', { name: /^Raw JSON/ });
    await expect(raw).toContainText('"datasets": [');
    await expect(raw).toContainText('"run_shape": "combined"');
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'after-d-raw-1440.png'), fullPage: true });
    }
    expect(doc.evaluator.datasets).toEqual([
      { dataset: 'support-tickets', version: 'v3' },
      { dataset: 'support-tickets', version: 'v2' },
      { dataset: 'billing-faq', version: 'v2' },
      { dataset: 'billing-faq', version: 'v1' },
    ]);
    expect(doc.evaluator.run_shape).toBe('combined');
    expect(doc.evaluator.task).toBe('answer-ticket');
    expect(doc.evaluator.dataset).toBe('support-tickets');
    expect(doc.evaluator.dataset_version).toBe('v3');
    // Edit: drop the last pair, switch to One run each, clear the task; apply.
    const edited = {
      ...doc,
      evaluator: { ...doc.evaluator, datasets: doc.evaluator.datasets.slice(0, 3), run_shape: 'one_each' },
    };
    delete edited.evaluator.task;
    await setRaw(page, JSON.stringify(edited, null, 2));
    await page.getByRole('button', { name: 'Apply' }).click();
    await goStep(page, 'where');
    await expect(page.getByTestId('pair-count')).toHaveText('3 dataset versions from 2 datasets');
    await expect(page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' })).toBeChecked();
    await expect(page.locator('[data-part=task-section]')).toContainText('Worker default');
    await expect
      .poll(() => posts.dryRuns.at(-1)?.body.spec.evaluator.datasets?.length, { timeout: 10_000 })
      .toBe(3);
    const again = await currentSpec(page, posts);
    expect(again.evaluator.datasets).toEqual(edited.evaluator.datasets);
    expect(again.evaluator.run_shape).toBe('one_each');
    expect(again.evaluator.task).toBeUndefined();
    // Invalid text is rejected and nothing changes.
    const bad = {
      ...again,
      evaluator: {
        ...again.evaluator,
        datasets: [
          { dataset: 'support-tickets', version: 'v3', alias: 'x' },
          ...again.evaluator.datasets.slice(1),
        ],
      },
    };
    await showRaw(page);
    await setRaw(page, JSON.stringify(bad));
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('region', { name: /^Raw JSON/ })).toContainText('/evaluator/datasets/0');
    await expect(page.getByRole('region', { name: /^Raw JSON/ })).toContainText(
      'Give a version or an alias, not both.',
    );
    await goStep(page, 'where');
    await expect(page.getByTestId('pair-count')).toHaveText('3 dataset versions from 2 datasets');
    if (SHOTS) {
      await page.setViewportSize({ width: 390, height: 1000 });
      await expect(page.getByRole('button', { name: /Go to step/ })).toBeVisible();
      await showRaw(page);
      await page.screenshot({ path: path.join(SHOTS, 'after-d-raw-390.png'), fullPage: true });
    }
  });

  test('QD-49, QD-50, QD-51: problems carry their pointer; a task the service cannot confirm is only a warning', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts = captureExperimentPosts(page);
    await composed(page);
    const doc = await currentSpec(page, posts);
    await showRaw(page);
    // A task for the v1.3 service and a task production does not list.
    doc.evaluator.task = { [f.production.id]: 'zzz-unknown', [f.staging.id]: 'answer-ticket' };
    await setRaw(page, JSON.stringify(doc));
    await page.getByRole('button', { name: 'Apply' }).click();
    const pane = review(page);
    await expect(pane).toContainText(
      'staging does not offer the task “Answer a ticket”: its Evaluation Service has no task selection.',
    );
    await expect(pane).toContainText('production does not offer the task “zzz-unknown”.');
    await expect(launchButton(page)).toBeDisabled();
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'after-d-problems-1440.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.screenshot({ path: path.join(SHOTS, 'after-d-problems-390.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    // The problem focuses the field (the task row of production on step 1).
    await pane.getByRole('button', { name: /production does not offer the task/ }).click();
    await expect(page.getByRole('heading', { name: 'Where it runs', level: 2 })).toBeVisible();
    // 503 on the tasks list: a chosen task is unverified, never an error (the server says so in the dry run).
    await setFakeTasks(request, FAKE_A, { status: 503 });
    await showRaw(page);
    doc.evaluator.task = { [f.production.id]: 'route-ticket' };
    await setRaw(page, JSON.stringify(doc));
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(review(page)).toContainText(
      "Couldn't confirm the tasks of production; the service checks them when the job starts.",
      { timeout: 15_000 },
    );
    await expect(launchBar(page).getByText('Ready to launch')).toBeVisible();
  });

  test('QD-52 and the dispatcher: Launch posts once; each service receives what the plan says', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts = captureExperimentPosts(page);
    await composed(page);
    await goStep(page, 'review');
    await expect(launchBar(page).getByText('Ready to launch')).toBeVisible({ timeout: 15_000 });
    await expect(launchButton(page)).toHaveText('Launch 5 runs');
    await launchButton(page).click();
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    expect(posts.launches).toHaveLength(1);
    const body = posts.launches[0]!.body;
    expect(body.spec.evaluator.run_shape).toBe('combined');
    const id = page.url().split('/').pop()!;
    const experiment = await waitForSubmitted(request, f.project.id, id);
    expect(experiment.jobs).toHaveLength(5);
    const detail: any = await getExperiment(request, f.project.id, id);
    expect(detail.job_count).toBe(5);
    // production (v1.4): one combined job with the list.
    const onProduction = (await fakeJobsOf(request, experiment, FAKE_A)) as any[];
    expect(onProduction).toHaveLength(1);
    const sent = onProduction[0].eval_input;
    expect(sent.datasets).toEqual([
      { dataset: 'support-tickets', version: 'v3' },
      { dataset: 'support-tickets', version: 'v2' },
      { dataset: 'billing-faq', version: 'v2' },
      { dataset: 'billing-faq', version: 'v1' },
    ]);
    expect(sent.task).toBeUndefined(); // Worker default: no task is sent
    expect(JSON.stringify(onProduction[0])).not.toContain('run_shape');
    // staging (v1.3): four jobs, one pair each, no list, no task.
    const onStaging = (await fakeJobsOf(request, experiment, FAKE_B)) as any[];
    expect(onStaging).toHaveLength(4);
    const pairs = onStaging.map((j) => `${j.eval_input.dataset} ${j.eval_input.dataset_version}`).sort();
    expect(pairs).toEqual(['billing-faq v1', 'billing-faq v2', 'support-tickets v2', 'support-tickets v3']);
    expect(
      onStaging.every((j) => j.eval_input.datasets === undefined && j.eval_input.task === undefined),
    ).toBe(true);
    save('measure-d-launch', {
      jobs: experiment.jobs.length,
      production: onProduction.length,
      staging: onStaging.length,
      round: round(1),
    });
  });

  test('QD-24: changing only the task or the shape issues one dry run each', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts = captureExperimentPosts(page);
    await composed(page);
    await expect(launchBar(page).getByText('Ready to launch')).toBeVisible({ timeout: 15_000 });
    const before = posts.dryRuns.length;
    await page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' }).click({ force: true });
    await expect.poll(() => posts.dryRuns.length, { timeout: 8000 }).toBe(before + 1);
    await expect(launchBar(page).getByText('Ready to launch')).toBeVisible({ timeout: 15_000 });
    expect(posts.launches).toHaveLength(0);
  });
});
