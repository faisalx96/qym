/**
 * Brief 06 §2.10: the Models page. Task + dataset are required, model cards with stat tiles,
 * K, the run-selection dialog and the compare handoff. Runs are created through the SDK ingest.
 */
import { expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { createApiKey, ingestRun, resetFakes, test, seedProject, waitForDashboardRuns } from './support';
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
    await page.getByTestId('filters-trigger').click();
    const panel = page.getByTestId('filters-panel');
    await panel.getByRole('radiogroup', { name: 'Origin' }).getByText('Official', { exact: true }).click();
    await expect.poll(() => query(page).get('origin')).toBe('official');
    // runs created by the SDK are local, so nothing is official
    await page.keyboard.press('Escape');
    await expect(page.getByText('No runs in this period')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText('official');
    await page.getByTestId('filters-trigger').click();
    await expect(page.getByRole('radio', { name: 'Official' })).toBeChecked();
    await page.getByRole('radiogroup', { name: 'Origin' }).getByText('All', { exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Time range' }).getByText('7d', { exact: true }).click();
    await expect.poll(() => query(page).get('range')).toBe('week');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-model^="model-a|"]')).toBeVisible();
  });

  test('model and status facets, a custom range, Clear and the shared runs filter', async ({
    page,
    request,
  }) => {
    const { project } = await seedProject(request, 'models-facets');
    await seedRuns(request, project, [
      { model: 'model-a', scores: [1, 1], n: 2 },
      { model: 'model-b', scores: [0, 0], n: 2 },
    ]);
    await gotoApp(page, modelsPath(project.slug));
    await expect(page.locator('[data-model^="model-a|"]')).toBeVisible();
    await expect(page.locator('[data-model^="model-b|"]')).toBeVisible();
    await expect(page.getByTestId('models-summary')).toHaveText('4 runs');

    await page.getByTestId('filters-trigger').click();
    const panel = page.getByTestId('filters-panel');
    await panel.getByRole('button', { name: /^Models/ }).click();
    await panel.getByRole('button', { name: 'Only model-a' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-model^="model-b|"]')).toHaveCount(0);
    await expect(page.locator('[data-model^="model-a|"]')).toBeVisible();
    await expect(page.getByTestId('models-summary')).toContainText('2 of 4 runs — model: model-a');
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText('model-a');

    // a custom range that excludes today leaves nothing
    await page.getByTestId('filters-trigger').click();
    await page.getByRole('radiogroup', { name: 'Time range' }).getByText('Range…', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Custom date range' });
    await dialog.getByLabel('From').fill('2001-01-01');
    await dialog.getByLabel('To').fill('2001-01-31');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => query(page).get('range')).toBe('custom');
    await expect(page.getByText('No runs in this period')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Clear \d/ }).click();
    await expect(page.locator('[data-model^="model-b|"]')).toBeVisible();
    await expect.poll(() => query(page).get('model')).toBeNull();

    // filters set on the Runs page carry over when the Models page is opened without any
    await gotoApp(page, `/projects/${project.slug}?model=model-b`);
    await expect(page.getByRole('link', { name: 'Models', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Models', exact: true }).click();
    await expect.poll(() => query(page).get('model')).toBe('model-b');
    await expect(page.locator('[data-model^="model-a|"]')).toHaveCount(0);
    await expect(page.locator('[data-model^="model-b|"]')).toBeVisible();
  });

  test('score tiles keep one decimal, the top three are medalled and trace tiles show averages', async ({
    page,
    request,
  }) => {
    const { project } = await seedProject(request, 'models-trace');
    await seedRuns(request, project, [
      {
        model: 'model-a',
        scores: [1, 1, 1],
        n: 1,
      },
      { model: 'model-b', scores: [1, 0, 0], n: 1 },
    ]);
    // the SDK ingest cannot produce spans here: give model-a's runs trace statistics in the response
    await page.route('**/api/dashboard/models', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        models?: { model_key: string; rows: Record<string, unknown>[] }[];
      };
      for (const m of body.models ?? [])
        if (m.model_key.startsWith('model-a'))
          for (const row of m.rows)
            row.trace_stats = {
              has_spans: true,
              avg_tokens: 1500,
              avg_llm_calls: 1,
              avg_tool_calls: 4,
              tool_success_rate: 0.75,
            };
      await route.fulfill({ response, json: body });
    });
    await gotoApp(page, modelsPath(project.slug));
    const a = page.locator('[data-model^="model-a|"]');
    await expect(a).toContainText('Avg tokens');
    await expect(a).toContainText('1.5K');
    await expect(a).toContainText('Avg LLM calls');
    await expect(a).toContainText('1.0');
    await expect(a).toContainText('Tool success rate');
    await expect(a).toContainText('75.0%');
    const b = page.locator('[data-model^="model-b|"]');
    await expect(b).toContainText('33.3%');
    const ranking = page.locator('#models-ranking').locator('..');
    await expect(ranking.getByRole('img', { name: 'Rank 1' })).toHaveText('\u{1F947}');
    await expect(ranking.getByRole('img', { name: 'Rank 2' })).toHaveText('\u{1F948}');
  });
});
