/**
 * Brief 06 §2.10: the Models page. Task + dataset are required, model cards with stat tiles,
 * K, the run-selection dialog and the compare handoff. Runs are created through the SDK ingest.
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { createApiKey, ingestRun, resetFakes, seedProject, waitForDashboardRuns } from './support';
import { pickSelect, query } from './ui';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

const modelsPath = (slug: string, q = '') => `/projects/${slug}/models${q}`;

async function seedRuns(
  request: Parameters<typeof seedProject>[0],
  project: { id: string; slug: string },

  specs: {
    model: string;
    task?: string;
    dataset?: string;
    scores: number[];
    n: number;
    nameless?: boolean;
  }[],
) {
  const key = await createApiKey(request, project.id);
  const ids: Record<string, string[]> = {};
  let i = 0;
  for (const spec of specs) {
    for (let r = 0; r < spec.n; r++) {
      const id = await ingestRun(request, key, {
        name: `${spec.model}-${spec.task ?? 'qa'}-${r}-${i++}`,
        model: spec.model,
        task: spec.task,
        dataset: spec.dataset,
        items: spec.scores.length,
        scores: spec.scores,
        nameless: spec.nameless,
      });
      (ids[spec.model] ??= []).push(id);
    }
  }
  for (const [task, count] of countByTask(specs))
    await waitForDashboardRuns(request, project.slug, count, task);
  return ids;
}

function countByTask(specs: { task?: string; n: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of specs) out.set(s.task ?? 'qa', (out.get(s.task ?? 'qa') ?? 0) + s.n);
  return out;
}

test.describe('models page', () => {
  test('a project without runs shows the empty state', async ({ page, request }) => {
    const { project } = await seedProject(request, 'models-empty');
    await gotoApp(page, modelsPath(project.slug));
    await expect(page).toHaveTitle(/Models/);
    await expect(page.getByText('No runs in this period')).toBeVisible();
  });

  test('two tasks: pick a task and a dataset before anything is compared', async ({ page, request }) => {
    const { project } = await seedProject(request, 'models-pick');
    await seedRuns(request, project, [
      { model: 'model-a', task: 'qa', scores: [1, 1, 1, 1], n: 1 },
      { model: 'model-b', task: 'summarize', scores: [0, 0, 0, 0], n: 1 },
    ]);
    await gotoApp(page, modelsPath(project.slug));
    await expect(page.getByText('Select a task and dataset')).toBeVisible();
    await expect(page.getByRole('button', { name: /Dataset/ })).toBeDisabled();

    await pickSelect(page, /Task$/, 'qa');
    await expect.poll(() => query(page).get('task')).toBe('qa');
    // golden is the only dataset of that task, so it is chosen for the user
    await expect(page.locator('[data-model^="model-a|"]')).toBeVisible();
    await expect(page.locator('[data-model^="model-b|"]')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('button', { name: /Task$/ })).toContainText('qa');
    await expect(page.locator('[data-model^="model-a|"]')).toBeVisible();
  });

  test('cards rank models, K and the run selection change what counts, compare hands the runs off', async ({
    page,
    request,
  }) => {
    const { project } = await seedProject(request, 'models-cards');
    const ids = await seedRuns(request, project, [
      { model: 'model-a', scores: [1, 1, 1, 1], n: 3 },
      { model: 'model-b', scores: [0, 0, 0, 0], n: 3 },
    ]);
    await gotoApp(page, modelsPath(project.slug));
    const a = page.locator('[data-model^="model-a|"]');
    const b = page.locator('[data-model^="model-b|"]');
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    // fewer runs than K=5: the count is flagged
    await expect(a).toContainText('3/5 runs');
    await expect(a.getByRole('img', { name: /Only 3 runs available \(requested 5\)/ })).toBeVisible();
    await expect(a).toContainText('Avg');
    await expect(a).toContainText('Correct distribution');
    await expect(a).toContainText('4 items');

    // ranking list: the model with the higher average first
    const ranking = page
      .getByRole('region', { name: /Ranking by average score/ })
      .or(page.locator('#models-ranking').locator('..'));
    const items = ranking.getByRole('listitem');
    await expect(items.first()).toContainText('model-a');
    await expect(items.first()).toContainText('100.0%');
    await expect(items.nth(1)).toContainText('model-b');
    await expect(items.nth(1)).toContainText('0.0%');

    // K: 2 runs per model; the URL carries it and the cards follow
    const k = page.getByRole('textbox', { name: 'Runs per model' });
    await k.fill('2');
    await k.press('Enter');
    await expect.poll(() => query(page).get('k')).toBe('2');
    await expect(a).toContainText('2/2 runs');
    await expect(a.getByRole('img', { name: /runs available/ })).toHaveCount(0);

    // hide a stat through "Shown metrics"
    await page.getByRole('button', { name: /Shown metrics/ }).click();
    await page
      .getByRole('dialog', { name: 'Shown metrics options' })
      .locator('label')
      .filter({ hasText: 'Correct distribution' })
      .click();
    await page.keyboard.press('Escape');
    await expect(a).not.toContainText('Correct distribution');

    // run selection: swap the newest run of model-a for the oldest
    await a.getByRole('button', { name: /Edit run selection of model-a/ }).click();
    const dialog = page.getByRole('dialog', { name: /Select runs · model-a/ });
    await expect(dialog.getByText('2 / 2 selected')).toBeVisible();
    // at the cap the unchecked runs are disabled
    await expect(dialog.getByRole('checkbox', { disabled: true })).toHaveCount(1);
    await dialog
      .locator('label')
      .filter({ hasText: /model-a-qa-2-/ })
      .click(); // drop the newest
    await expect(dialog.getByText('1 / 2 selected')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { disabled: true })).toHaveCount(0);
    await dialog
      .locator('label')
      .filter({ hasText: /model-a-qa-0-/ })
      .click(); // take the oldest
    await expect(dialog.getByText('2 / 2 selected')).toBeVisible();
    await dialog.getByRole('button', { name: 'Apply selection' }).click();
    await expect(dialog).toBeHidden();
    await expect(a).toContainText('2/2 runs');

    // compare handoff
    const compare = a.getByRole('button', { name: /See item-by-item comparison of model-a/ });
    await expect(compare).toBeEnabled();
    await compare.click();
    await expect(page).toHaveURL(/\/compare\?runs=.+&runs=.+/);
    const urlRuns = new URL(page.url()).searchParams.getAll('runs');
    expect([...urlRuns].sort()).toEqual([ids['model-a']![0]!, ids['model-a']![1]!].sort());
    const stored = await page.evaluate(() => sessionStorage.getItem('compareRuns'));
    expect(JSON.parse(stored ?? '[]') as string[]).toEqual(urlRuns);
  });

  test('a model with a single run cannot be compared with itself', async ({ page, request }) => {
    const { project } = await seedProject(request, 'models-single');
    await seedRuns(request, project, [
      { model: 'solo', scores: [0, 0], n: 1 },
      { model: 'pair', scores: [1, 1], n: 2 },
    ]);
    await gotoApp(page, modelsPath(project.slug));
    const solo = page.locator('[data-model^="solo|"]');
    await expect(solo).toContainText('1/5 runs');
    await expect(solo.getByRole('button', { name: /See item-by-item comparison of solo/ })).toBeDisabled();
    await expect(
      page
        .locator('[data-model^="pair|"]')
        .getByRole('button', { name: /See item-by-item comparison of pair/ }),
    ).toBeEnabled();
  });

  test('runs without a name are listed by id and their checkbox has a label', async ({ page, request }) => {
    const { project } = await seedProject(request, 'models-nameless');
    const ids = await seedRuns(request, project, [{ model: 'anon', scores: [1, 1], n: 2, nameless: true }]);
    await gotoApp(page, modelsPath(project.slug));
    await page
      .locator('[data-model^="anon|"]')
      .getByRole('button', { name: /Edit run selection of anon/ })
      .click();
    const dialog = page.getByRole('dialog', { name: /Select runs · anon/ });
    for (const id of ids['anon']!) await expect(dialog.getByRole('checkbox', { name: id })).toBeAttached();
  });

  test('time range and origin filters live in the URL', async ({ page, request }) => {
    const { project } = await seedProject(request, 'models-filters');
    await seedRuns(request, project, [{ model: 'model-a', scores: [1, 1], n: 2 }]);
    await gotoApp(page, modelsPath(project.slug));
    await expect(page.locator('[data-model^="model-a|"]')).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Origin' }).getByText('Official', { exact: true }).click();
    await expect.poll(() => query(page).get('origin')).toBe('official');
    // runs created by the SDK are local, so nothing is official
    await expect(page.getByText('No runs in this period')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Official' })).toBeChecked();
    await page.getByRole('radiogroup', { name: 'Origin' }).getByText('All', { exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Time range' }).getByText('7d', { exact: true }).click();
    await expect.poll(() => query(page).get('range')).toBe('7d');
    await expect(page.locator('[data-model^="model-a|"]')).toBeVisible();
  });
});
