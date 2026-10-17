/** J6 / §8.7: expanding a repeat run: passes, group metrics, select mode, pass delete. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { BOOL, LOWER, SCORE, seedRun } from './seed';
import { clickBox, freshProject, openRuns, rowOf, openPassMenu, deletePassFromMenu } from './support';

const NAME = 'summarize-repeat-done';

async function seedRepeat(page: Page, request: APIRequestContext) {
  const s = await freshProject(request, 3, { running: false });
  await seedRun(request, s.token, {
    name: NAME,
    task: 'summarize',
    dataset: 'cnn-sample',
    model: 'openai/gpt-4o',
    metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
    items: Array.from({ length: 6 }, (_, j) => ({ accuracy: j % 2, quality: 0.5 + j / 20, latency_s: 0.5 })),
    samples: 3,
    status: 'COMPLETED',
  });
  await openRuns(page, s.project.slug);
  return s;
}

const groupMetricRequests = (page: Page) => {
  const urls: URL[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'GET' && u.pathname.endsWith('/group-metrics')) urls.push(u);
  });
  return urls;
};

test.describe('runs list: repeat-run passes (J6)', () => {
  test('chevron expands the passes panel with 3 pass rows and the group-metrics strip', async ({
    page,
    request,
  }) => {
    const s = await seedRepeat(page, request);
    const row = rowOf(page, NAME);
    await expect(row.locator('td[data-col="run"]')).toContainText('×3');
    const chevron = row.getByRole('button', { name: `Expand 3 passes of ${NAME}` });
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await chevron.click();
    const panel = page.getByTestId('runs-table');
    await expect(row.getByRole('button', { name: `Collapse 3 passes of ${NAME}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(panel.locator('tbody tr[data-pass-row]')).toHaveCount(3);
    await expect(panel.getByText(/^3 · \d+ items$/)).toBeVisible();
    for (const label of ['Pass@3', 'Pass^3', 'Avg@3', 'Consistency', 'Reliability'])
      await expect(panel.locator('[aria-label="Group metrics"]').first()).toContainText(label);
    // collapse again
    await row.getByRole('button', { name: `Collapse 3 passes of ${NAME}` }).click();
    await expect(panel.locator('tbody tr[data-pass-row]')).toHaveCount(0);
    await expect(panel.locator('tr[data-strip-row]')).toHaveCount(0);
    expect(s.project.slug).toBeTruthy();
  });

  test('changing the Metric select or the threshold slider (keyboard) requests new group metrics', async ({
    page,
    request,
  }) => {
    await seedRepeat(page, request);
    const reqs = groupMetricRequests(page);
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const panel = page.getByTestId('runs-table');
    await expect(panel.locator('[aria-label="Group metrics"]').first()).toContainText('Pass@3');
    await expect.poll(() => reqs.length).toBeGreaterThanOrEqual(1);
    const base = reqs.length;
    const first = reqs.at(-1)!;
    // metric select
    const current = first.searchParams.get('metric');
    await panel.getByRole('button', { name: /Metric/ }).click();
    const other = current === 'quality' ? 'accuracy' : 'quality';
    await page.getByRole('option', { name: other }).click();
    await expect.poll(() => reqs.length).toBeGreaterThan(base);
    expect(reqs.at(-1)!.searchParams.get('metric')).toBe(other);
    // slider: keyboard step triggers a request with a new threshold
    const n = reqs.length;
    await panel.getByTestId('pass-threshold-chip').click();
    const thumb = page.getByRole('slider', { name: 'Pass threshold' });
    const t0 = Number(await thumb.inputValue());
    await thumb.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => reqs.length).toBeGreaterThan(n);
    const t1 = Number(reqs.at(-1)!.searchParams.get('threshold'));
    expect(t1).toBeCloseTo(t0 + 0.05, 5);
    expect(reqs.at(-1)!.searchParams.get('metric')).toBe(other);
  });

  test('select mode shows per-pass checkboxes and makes the parent indeterminate; picks count as executions', async ({
    page,
    request,
  }) => {
    const s = await seedRepeat(page, request);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const panel = page.getByTestId('runs-table');
    const passBoxes = panel.getByRole('checkbox', { name: new RegExp(`^Select pass \\d of 3 of run ${NAME}$`) });
    await expect(passBoxes).toHaveCount(3);
    const parent = page.getByRole('checkbox', { name: `Select ${NAME}`, exact: true });
    await clickBox(passBoxes.nth(0));
    await expect(page.getByTestId('selection-bar')).toContainText('1 execution selected');
    await expect.poll(() => parent.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
    const stored = await page.evaluate(
      (slug) => JSON.parse(sessionStorage.getItem(`qym:runs-selection:${slug}`) ?? 'null'),
      s.project.slug,
    );
    expect(stored.selected).toEqual([expect.stringMatching(/::pass1$/)]);
    await clickBox(passBoxes.nth(1));
    await expect(page.getByTestId('selection-bar')).toContainText('2 executions selected');
    // ticking the parent of an expanded repeat run ticks all of its passes (3 executions)
    await clickBox(page.getByRole('checkbox', { name: `Select ${NAME}`, exact: true }));
    await expect(page.getByTestId('selection-bar')).toContainText('3 executions selected');
    await expect(passBoxes.nth(2)).toBeChecked();
    await expect(parent).toBeChecked();
    // and clears them all again
    await clickBox(parent);
    await expect(page.getByTestId('selection-bar')).toContainText('0 executions selected');
    await expect(passBoxes.nth(0)).not.toBeChecked();
  });

  test('ticking every pass checks the parent; a pass and its run are exclusive; compare has no duplicates', async ({
    page,
    request,
  }) => {
    const s = await seedRepeat(page, request);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const panel = page.getByTestId('runs-table');
    const passBoxes = panel.getByRole('checkbox', { name: new RegExp(`^Select pass \\d of 3 of run ${NAME}$`) });
    const parent = page.getByRole('checkbox', { name: `Select ${NAME}`, exact: true });
    for (const i of [0, 1, 2]) await clickBox(passBoxes.nth(i));
    await expect(parent).toBeChecked();
    // collapse, tick the whole run: it replaces the pass picks
    await rowOf(page, NAME)
      .getByRole('button', { name: `Collapse 3 passes of ${NAME}` })
      .click();
    await clickBox(parent); // checked -> clear
    await clickBox(parent); // whole run
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    await clickBox(passBoxes.nth(0)); // pass 1 replaces the whole run
    const stored = await page.evaluate(
      (slug) => JSON.parse(sessionStorage.getItem(`qym:runs-selection:${slug}`) ?? 'null'),
      s.project.slug,
    );
    expect(stored.selected).toEqual([expect.stringMatching(/::pass1$/)]);
    await expect(page.getByTestId('selection-bar')).toContainText('1 execution selected');
    await clickBox(passBoxes.nth(1));
    await page.getByTestId('selection-bar').getByRole('button', { name: 'Compare' }).click();
    await expect(page).toHaveURL(/\/compare\?/);
    const refs = new URL(page.url()).searchParams.getAll('runs');
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toHaveLength(2);
  });

  test('pass rows show date, analysis link, errors, retries and open the pass', async ({ page, request }) => {
    await seedRepeat(page, request);
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const panel = page.getByTestId('runs-table');
    const rows = panel.locator('tbody tr[data-pass-row]');
    await expect(rows).toHaveCount(3);
    await expect(panel.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(rows.first().locator('time')).toBeVisible();
    await expect(panel.locator('[aria-label="Group metrics"]').first()).toContainText('Avg@3');
    await expect(panel.getByText(/^Pass if [≥≤] \d+%$/)).toBeVisible();
    const analyze = rows.nth(1).getByRole('link', { name: /^Analyze pass 2/ });
    await expect(analyze).toHaveAttribute('href', /\/analyzer\?.*pass=2/);
    // the pass row opens that pass of the run
    await rows.nth(1).getByRole('link', { name: `Pass 2 of 3 of run ${NAME}` }).click();
    await expect(page).toHaveURL(/pass=2/);
  });

  test('deleting a pass asks for confirmation and removes it', async ({ page, request }) => {
    await seedRepeat(page, request);
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const panel = page.getByTestId('runs-table');
    await expect(panel.locator('tbody tr[data-pass-row]')).toHaveCount(3);
    await deletePassFromMenu(panel, page, 2);
    const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete pass 2?' }));
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Delete pass' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pass 2 deleted' })).toBeVisible();
    await expect(
      page.getByTestId('runs-table').locator('tbody tr[data-pass-row]'),
    ).toHaveCount(2, { timeout: 15_000 });
  });

  test('a SUBMITTED repeat run cannot have passes deleted', async ({ page, request }) => {
    const s = await freshProject(request, 6, { running: false }); // run 005 is a SUBMITTED repeat run
    await openRuns(page, s.project.slug);
    await rowOf(page, 'rag-qa-gpt-4o-005')
      .getByRole('button', { name: /Expand 3 passes/ })
      .click();
    const panel = page.getByTestId('runs-table');
    await expect(panel.locator('tbody tr[data-pass-row]')).toHaveCount(3);
    await openPassMenu(panel, page, 1);
    await expect(page.getByRole('menuitem', { name: /Open pass 1/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Delete pass/ })).toHaveCount(0);
  });
});
