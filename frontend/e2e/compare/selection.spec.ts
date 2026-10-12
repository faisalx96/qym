/** J1: choosing runs, baseline, removal, pass refs, session handoff, empty / error states. */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl, seedScenario, urlParams, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-sel');
});

const chips = (page: Page) => page.getByRole('group', { name: 'Runs in this comparison' });
const deltaLine = (page: Page) => page.locator('[aria-label="Change against the baseline"]');

test('four runs: summary, delta line against the baseline and the Metrics table', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
  await expect(page.getByRole('heading', { name: 'Compare runs', level: 1 })).toBeVisible();
  await expect(page.getByText('4 columns')).toBeVisible();
  await expect(page.getByText('cmp-qa-v1')).toBeVisible();
  await expect(page.getByText('40 aligned items')).toBeVisible();
  await expect(chips(page).getByRole('button', { name: /^[A-D] .*(baseline|set as baseline)$/ })).toHaveCount(4);
  await expect(chips(page).getByRole('button', { name: /^A .*, baseline$/ })).toHaveAttribute('aria-pressed', 'true');
  // one delta entry per candidate (not the baseline), with sign, verdict word and noise band
  await expect(deltaLine(page).locator('li[data-column]')).toHaveCount(3);
  await expect(deltaLine(page)).toContainText('+15.3 pts');
  await expect(deltaLine(page)).toContainText('(improved)');
  await expect(deltaLine(page)).toContainText('−10.8 pts');
  await expect(deltaLine(page)).toContainText('(regressed)');
  await expect(deltaLine(page)).toContainText('±8.8');
  // analytics Metrics table
  const table = page.getByRole('table', { name: /Average per run over 40 filtered items/ });
  for (const h of ['Run', 'correct', 'quality', 'Latency', 'Errors']) await expect(table.getByRole('columnheader', { name: h })).toBeVisible();
  await expect(table.getByRole('rowheader')).toHaveCount(4);
  await expect(table.getByRole('row', { name: /^A .*Base/ })).toContainText('baseline');
  await expect(table.getByRole('row', { name: /^A / })).toContainText('2 task · 1 scorer');
});

test('changing the baseline updates ?baseline= and re-signs the deltas', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
  await expect(deltaLine(page)).toContainText('+15.3 pts');
  await chips(page).getByRole('button', { name: /^B .*set as baseline$/ }).click();
  await expect.poll(() => urlParams(page).get('baseline')).toBe(a);
  await expect(chips(page).getByRole('button', { name: /^B .*, baseline$/ })).toHaveAttribute('aria-pressed', 'true');
  // A is now a candidate and is 15.3 pts worse than B
  await expect(deltaLine(page)).toContainText('−15.3 pts');
  await expect(deltaLine(page)).not.toContainText('+15.3 pts');
  await expect(page.getByRole('button', { name: 'Reset baseline' })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset baseline' }).click();
  await expect.poll(() => urlParams(page).get('baseline')).toBeNull();
  await expect(deltaLine(page)).toContainText('+15.3 pts');
});

test('removing a run updates the URL; the remove control disappears at two runs', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
  const remove = chips(page).getByRole('button', { name: /^Remove .* from the comparison$/ });
  await expect(remove).toHaveCount(4);
  await remove.nth(2).click(); // C (cand-b)
  await expect.poll(() => urlParams(page).getAll('runs')).toEqual([base, a, c]);
  await expect(page.getByText('3 columns')).toBeVisible();
  // base + cand-c share a model, so the page stays in plain Compare mode at two runs
  await remove.nth(1).click(); // B (cand-a)
  await expect.poll(() => urlParams(page).getAll('runs')).toEqual([base, c]);
  await expect(chips(page).getByRole('button', { name: /^[A-D] / })).toHaveCount(2);
  await expect(remove).toHaveCount(0);
  await expect(deltaLine(page).locator('li[data-column]')).toHaveCount(1);
});

test('two runs of two different models open as a cohort comparison (legacy auto-cohort)', async ({ page }) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  await expect(page.getByRole('group', { name: 'Compare sides' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'View' })).toBeVisible();
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
  const table = page.getByRole('table', { name: /Average per run/ });
  await expect(table.getByRole('rowheader')).toHaveCount(4);
  await expect(table.getByRole('rowheader').nth(0)).toContainText('pass 1');
  await page.getByTestId('item-row').first().click();
  for (const p of [1, 2, 3]) await expect(page.locator(`[data-testid="output-card"][data-run="${repeat3}::pass${p}"]`)).toBeVisible();
  await toggle.getByText('Run average').click();
  await expect.poll(() => urlParams(page).get('columns')).toBeNull();
  await expect(page.getByText('2 columns')).toBeVisible();
});

test('sessionStorage.compareRuns hand-off loads and moves into the URL', async ({ page }) => {
  const { base, a, b } = seed.runs;
  await page.addInitScript((ids) => {
    window.sessionStorage.setItem('compareRuns', JSON.stringify(ids));
  }, [base, a, b]);
  await page.goto('/app/compare');
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
  await page.goto('/app/compare');
  await waitLoaded(page);
  await expect.poll(() => urlParams(page).getAll('cohortA')).toEqual([base, a]);
  expect(urlParams(page).getAll('cohortB')).toEqual([b, c]);
  expect(urlParams(page).get('cohortALabel')).toBe('Left side');
  await expect(page.getByRole('group', { name: 'Compare sides' })).toContainText('Left side');
  await expect(page.getByRole('group', { name: 'Compare sides' })).toContainText('Right side');
});

test('empty and too-few states', async ({ page }) => {
  await page.goto('/app/compare');
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
  await page.goto(compareUrl(['00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000bb']));
  await expect(page.getByText(/Runs in this comparison were not found|A run in this comparison was not found/)).toBeVisible();
  await expect(page.getByTestId('item-list')).toHaveCount(0);
});

for (const status of [422, 500]) {
  test(`a ${status} from /api/compare shows an error state whose Retry works`, async ({ page }) => {
    const { base, a } = seed.runs;
    let failed = false;
    await page.route('**/api/compare?*', (route) => {
      if (!failed) {
        failed = true;
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: `forced ${status}` }) });
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
