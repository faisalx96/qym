/** J1: choosing runs, baseline, removal, pass refs, session handoff, empty / error states. */
import { expect, test, type Page } from '@playwright/test';
import {
  averageCell,
  averagesGrid,
  baselineSelect,
  compareUrl,
  pickBaseline,
  seedScenario,
  urlParams,
  waitLoaded,
} from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-sel');
});

const cards = (page: Page) => page.getByTestId('run-card');

test('four runs: summary, the change against the baseline in the averages and the Metrics table', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
  await expect(page.getByRole('heading', { name: 'Compare runs', level: 1 })).toBeVisible();
  await expect(page.getByText('4 columns')).toBeVisible();
  await expect(page.getByText('cmp-qa-v1').first()).toBeVisible();
  await expect(page.getByText('40 aligned items')).toBeVisible();
  await expect(cards(page)).toHaveCount(4);
  await expect(page.locator('[data-testid="run-card"][data-baseline]')).toHaveAttribute('data-run', base);
  await expect(baselineSelect(page)).toContainText('A');
  // one change line per candidate cell (not the baseline), with sign, verdict word and noise band
  const { a: runA, b: runB } = seed.runs;
  await expect(averageCell(page, 'm:quality', runA)).toContainText('+15.3 pts');
  await expect(averageCell(page, 'm:quality', runA)).toContainText('(improved)');
  await expect(averageCell(page, 'm:quality', runB)).toContainText('−10.8 pts');
  await expect(averageCell(page, 'm:quality', runB)).toContainText('(regressed)');
  await expect(averageCell(page, 'm:quality', runA)).toContainText('±8.8');
  // per-run averages matrix: a row per metric, a column per run
  const grid = averagesGrid(page);
  const heads = page.locator('[data-part="averages-colhead"]');
  await expect(heads).toHaveCount(4);
  await expect(heads.first().locator('[data-part="baseline-tag"]')).toHaveText('Baseline');
  await expect(heads.locator('[data-part="run-letter"]')).toHaveText(['A', 'B', 'C', 'D']);
  await expect(grid.getByRole('columnheader', { name: 'Metric' })).toBeVisible();
  for (const row of ['m:correct', 'm:quality', 'latency', 'errors'])
    await expect(page.locator(`[data-testid="average-row"][data-row="${row}"]`)).toBeVisible();
  await expect(averageCell(page, 'm:quality', base)).not.toContainText('pts');
  await expect(averageCell(page, 'errors', base)).toContainText('2 task · 1 scorer');
});

test('changing the baseline updates ?baseline= and re-signs the deltas', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
  await expect(averageCell(page, 'm:quality', seed.runs.a)).toContainText('+15.3 pts');
  await pickBaseline(page, /^B /);
  await expect.poll(() => urlParams(page).get('baseline')).toBe(a);
  await expect(baselineSelect(page)).toContainText('B');
  await expect(page.locator('[data-testid="run-card"][data-baseline]')).toHaveAttribute('data-run', a);
  // A is now a candidate and is 15.3 pts worse than B
  await expect(averageCell(page, 'm:quality', base)).toContainText('−15.3 pts');
  await expect(averageCell(page, 'm:quality', base)).not.toContainText('+15.3 pts');
  await pickBaseline(page, /Reset baseline/);
  await expect.poll(() => urlParams(page).get('baseline')).toBeNull();
  await expect(averageCell(page, 'm:quality', a)).toContainText('+15.3 pts');
});

test('removing a run updates the URL; the remove control disappears at two runs', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
  const remove = cards(page).getByRole('button', { name: /^Remove .* from the comparison$/ });
  await expect(remove).toHaveCount(4);
  await remove.nth(2).click(); // C (cand-b)
  await expect.poll(() => urlParams(page).getAll('runs')).toEqual([base, a, c]);
  await expect(page.getByText('3 columns')).toBeVisible();
  // base + cand-c share a model, so the page stays in plain Compare mode at two runs
  await remove.nth(1).click(); // B (cand-a)
  await expect.poll(() => urlParams(page).getAll('runs')).toEqual([base, c]);
  await expect(cards(page)).toHaveCount(2);
  await expect(remove).toHaveCount(0);
  await expect(page.locator('[data-part="averages-colhead"]')).toHaveCount(2);
});

test('two runs of two different models open as a cohort comparison (legacy auto-cohort)', async ({
  page,
}) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  await expect(page.getByRole('group', { name: 'Compare sides' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'View', exact: true })).toBeVisible();
});

test('pass refs and a whole repeat run expand into pass columns (columns=passes)', async ({ page }) => {
  const { base, repeat3 } = seed.runs;
  // explicit single pass of a repeat run
  await page.goto(compareUrl([`${repeat3}::pass2`, base]));
  await waitLoaded(page);
  await expect(page.getByText('2 columns')).toBeVisible();
  await page.getByTestId('item-row').first().click();
  await expect(page.locator(`[data-testid="output-card"][data-run="${repeat3}::pass2"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="output-card"][data-run="${repeat3}::pass1"]`)).toHaveCount(0);

  // the whole repeat run: Run average (1 column) <-> Each pass (3 columns)
  await page.goto(compareUrl([repeat3, base]));
  await waitLoaded(page);
  await expect(page.getByText('2 columns')).toBeVisible();
  const toggle = page.getByRole('radiogroup', { name: 'Repeat run columns' });
  await expect(toggle).toBeVisible();
  await toggle.getByText('Each pass').click();
  await expect.poll(() => urlParams(page).get('columns')).toBe('passes');
  await expect(page.getByText('4 columns')).toBeVisible();
  const grid = averagesGrid(page);
  await expect(grid.getByRole('columnheader')).toHaveCount(5);
  await expect(grid.getByRole('columnheader').nth(1)).toContainText('pass 1');
  await page.getByTestId('item-row').first().click();
  for (const p of [1, 2, 3])
    await expect(page.locator(`[data-testid="output-card"][data-run="${repeat3}::pass${p}"]`)).toBeVisible();
  await toggle.getByText('Run average').click();
  await expect.poll(() => urlParams(page).get('columns')).toBeNull();
  await expect(page.getByText('2 columns')).toBeVisible();
});

test('sessionStorage.compareRuns hand-off loads and moves into the URL', async ({ page }) => {
  const { base, a, b } = seed.runs;
  await page.addInitScript(
    (ids) => {
      window.sessionStorage.setItem('compareRuns', JSON.stringify(ids));
    },
    [base, a, b],
  );
  await page.goto('/compare');
  await waitLoaded(page);
  await expect.poll(() => urlParams(page).getAll('runs')).toEqual([base, a, b]);
  await expect(page.getByText('3 columns')).toBeVisible();
});

test('sessionStorage.compareCohorts hand-off loads and gains cohortA / cohortB', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.addInitScript(
    (p) => {
      window.sessionStorage.setItem('compareCohorts', JSON.stringify(p));
    },
    { left: [base, a], right: [b, c], leftLabel: 'Left side', rightLabel: 'Right side' },
  );
  await page.goto('/compare');
  await waitLoaded(page);
  await expect.poll(() => urlParams(page).getAll('cohortA')).toEqual([base, a]);
  expect(urlParams(page).getAll('cohortB')).toEqual([b, c]);
  expect(urlParams(page).get('cohortALabel')).toBe('Left side');
  await expect(page.getByRole('group', { name: 'Compare sides' })).toContainText('Left side');
  await expect(page.getByRole('group', { name: 'Compare sides' })).toContainText('Right side');
});

test('empty and too-few states', async ({ page }) => {
  await page.goto('/compare');
  await expect(page.getByText('No runs to compare')).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to runs/ })).toBeVisible();
  // a single ?runs= ref is below the minimum, so it is treated as no selection
  await page.goto(compareUrl([seed.runs.base]));
  await expect(page.getByText('No runs to compare')).toBeVisible();
});

test('more than 20 runs shows the too-many error without calling the API', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/compare?*', (r) => {
    calls++;
    return r.continue();
  });
  const ids = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  await page.goto(compareUrl(ids));
  await expect(page.getByText('Too many runs')).toBeVisible();
  await expect(page.getByText(/at most 20 runs/).first()).toBeVisible();
  expect(calls).toBe(0);
});

test('unknown run ids show the not-found state', async ({ page }) => {
  await page.goto(
    compareUrl(['00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000bb']),
  );
  await expect(
    page.getByText(/Runs in this comparison were not found|A run in this comparison was not found/),
  ).toBeVisible();
  await expect(page.getByTestId('item-list')).toHaveCount(0);
});

for (const status of [422, 500]) {
  test(`a ${status} from /api/compare shows an error state whose Retry works`, async ({ page }) => {
    const { base, a } = seed.runs;
    let failed = false;
    await page.route('**/api/compare?*', (route) => {
      if (!failed) {
        failed = true;
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ detail: `forced ${status}` }),
        });
      }
      return route.continue();
    });
    await page.goto(compareUrl([base, a]));
    await expect(page.getByText('Couldn’t load this comparison')).toBeVisible();
    await expect(page.getByTestId('item-list')).toHaveCount(0);
    await page.getByRole('button', { name: /Retry/ }).click();
    await waitLoaded(page);
    await expect(page.getByText('Couldn’t load this comparison')).toHaveCount(0);
  });
}
