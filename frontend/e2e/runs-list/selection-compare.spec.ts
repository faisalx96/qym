/** J4 / §8.5: select mode, compare, cohorts, persistence, bulk submit and delete. */
import { test, expect, type Page } from '@playwright/test';
import {
  clickBox,
  dataRows,
  failOnNativeDialogs,
  freshProject,
  openRuns,
  rowOf,
  sharedProject,
  statusText,
} from './support';

const REPEAT = 'rag-qa-gpt-4o-005'; // samples = 3

const selected = (page: Page) => page.getByTestId('selection-bar').getByText(/executions? selected/);
const tick = (page: Page, name: string) =>
  clickBox(page.getByRole('checkbox', { name: `Select ${name}`, exact: true }));
const storedSelection = (page: Page, slug: string) =>
  page.evaluate((s) => JSON.parse(sessionStorage.getItem(`qym:runs-selection:${s}`) ?? 'null'), slug);

test.describe('runs list: selection and compare (J4)', () => {
  test('x toggles the focused row and enters select mode; the Select button toggles too', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await expect(page.getByRole('checkbox', { name: /^Select / })).toHaveCount(0);
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await expect(dataRows(page).first()).toHaveAttribute('data-selected', '');
    await expect(selected(page)).toHaveText('1 execution selected');
    await expect(page.getByRole('button', { name: 'Done selecting' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('x');
    await expect(dataRows(page).first()).not.toHaveAttribute('data-selected', '');
    await expect(selected(page)).toHaveText('0 executions selected');
    // Select button: leave select mode; checkboxes go away
    await page.getByRole('button', { name: 'Done selecting' }).click();
    await expect(page.getByRole('checkbox', { name: /^Select / })).toHaveCount(0);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^Select / }).first()).toBeAttached();
  });

  test('the selection bar is one line and says "N executions selected" once', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    const first = dataRows(page).nth(0).locator('td[data-col="run"] a');
    const second = dataRows(page).nth(1).locator('td[data-col="run"] a');
    await tick(page, (await first.innerText()).trim());
    await tick(page, (await second.innerText()).trim());
    const bar = page.getByTestId('selection-bar');
    await expect(bar).toContainText('2 executions selected');
    expect((await bar.innerText()).match(/executions? selected/g)?.length).toBe(1);
    await expect(page.getByText(/executions? selected/)).toHaveCount(1);
    const boxes = await bar.locator('button, span').evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLElement).offsetParent !== null && !(e as HTMLElement).closest('button span'))
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { top: r.top, h: r.height };
        }),
    );
    const bb = (await bar.boundingBox())!;
    expect(bb.height, 'selection bar height').toBeLessThan(48);
    const tops = boxes.filter((b) => b.h > 0).map((b) => Math.round(b.top + b.h / 2));
    expect(Math.max(...tops) - Math.min(...tops), 'all controls share one line').toBeLessThanOrEqual(6);
    for (const label of ['Compare', 'Cohort', 'Submit', 'Delete', 'Clear'])
      await expect(bar.getByRole('button', { name: label, exact: true })).toBeVisible();
  });

  test('header checkbox selects the page; a repeat run counts as 3 executions', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await clickBox(page.getByRole('checkbox', { name: 'Select all runs on this page' }));
    await expect(
      dataRows(page).evaluateAll((rows) => rows.filter((r) => r.hasAttribute('data-selected')).length),
    ).resolves.toBe(13);
    await expect(selected(page)).toHaveText('15 executions selected'); // 13 rows, one of them x3
    await clickBox(page.getByRole('checkbox', { name: 'Select all runs on this page' }));
    await expect(selected(page)).toHaveText('0 executions selected');
    await tick(page, REPEAT);
    await expect(selected(page)).toHaveText('3 executions selected');
    await tick(page, 'text2sql-gpt-4o-000');
    await expect(selected(page)).toHaveText('4 executions selected');
  });

  test('c compares: /compare?runs=... and sessionStorage.compareRuns; repeat runs expand to pass refs', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    // c with fewer than two units: the button is disabled, key does nothing
    await tick(page, 'text2sql-gpt-4o-000');
    await expect(page.getByTestId('selection-bar').getByRole('button', { name: 'Compare' })).toBeDisabled();
    await tick(page, 'summarize-gpt-4o-001');
    await page.locator('body').click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/\/compare\?runs=/);
    const params = new URL(page.url()).searchParams.getAll('runs');
    expect(params).toHaveLength(2);
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('compareRuns') ?? 'null'));
    expect(stored).toEqual(params);
    // now with the repeat run: expands to three pass refs
    await page.goBack();
    await expect(page.getByTestId('selection-bar')).toBeVisible(); // select mode comes back with the stored selection
    await page.getByTestId('selection-bar').getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await tick(page, REPEAT);
    await page.getByTestId('selection-bar').getByRole('button', { name: 'Compare' }).click();
    await expect(page).toHaveURL(/\/compare\?runs=/);
    const refs = new URL(page.url()).searchParams.getAll('runs');
    expect(refs.filter((r) => r.includes('::pass')).sort()).toHaveLength(3);
    expect(refs).toHaveLength(3);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('compareRuns') ?? '[]'))).toEqual(
      refs,
    );
  });

  test('selection persists across navigation (sessionStorage) and Back restores the ticks', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await tick(page, 'text2sql-gpt-4o-000');
    await tick(page, 'summarize-gpt-4o-001');
    const stored = await storedSelection(page, s.project.slug);
    expect(stored.selected).toHaveLength(2);
    // open a run, come back
    await rowOf(page, 'text2sql-gpt-4o-000').locator('td[data-col="run"] a').click();
    await expect(page).toHaveURL(/\/runs\//);
    await page.goBack();
    await expect(dataRows(page).first()).toBeVisible();
    await expect(selected(page)).toHaveText('2 executions selected');
    await expect(rowOf(page, 'text2sql-gpt-4o-000')).toHaveAttribute('data-selected', '');
    await expect(rowOf(page, 'summarize-gpt-4o-001')).toHaveAttribute('data-selected', '');
    // another page and back (in-app link) keeps it as well
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(page).toHaveURL(/\/overview/);
    expect((await storedSelection(page, s.project.slug)).selected).toHaveLength(2);
    await page.getByRole('link', { name: 'Runs', exact: true }).first().click();
    await expect(selected(page)).toHaveText('2 executions selected');
    // Escape clears the selection (and the stored copy) then leaves select mode
    await page.locator('body').click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('Escape');
    await expect(selected(page)).toHaveText('0 executions selected');
    expect(await storedSelection(page, s.project.slug)).toBeNull();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test('Cohort A lock, then B: balanced and disjoint errors, then the compare handoff', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    const bar = page.getByTestId('selection-bar');
    await tick(page, 'text2sql-gpt-4o-000');
    await tick(page, 'summarize-gpt-4o-001');
    await bar.getByRole('button', { name: 'Cohort', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Cohort A locked. Pick 2 executions for cohort B.' }),
    ).toBeVisible();
    await expect(selected(page)).toHaveText('0 executions selected');
    await expect(bar).toContainText('Cohort A locked (2)');
    const cohortBtn = bar.getByRole('button', { name: /Cohort B/ });
    // unbalanced: one run on side B
    await tick(page, 'rag-qa-claude-sonnet-4-002');
    await cohortBtn.click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Cohort A holds 2 executions; B holds 1. Balance the two sides first.' }),
    ).toBeVisible();
    // balanced but overlapping: add a run that is already in A
    await tick(page, 'text2sql-gpt-4o-000');
    await cohortBtn.click();
    await expect(page.getByRole('alert').filter({ hasText: 'already in Cohort A' })).toBeVisible();
    // fix B: drop the overlap, add a disjoint run
    await tick(page, 'text2sql-gpt-4o-000');
    await tick(page, 'summarize-gpt-4o-004');
    await cohortBtn.click();
    await expect(page).toHaveURL(/\/compare\?cohortA=/);
    const sp = new URL(page.url()).searchParams;
    expect(sp.getAll('cohortA')).toHaveLength(2);
    expect(sp.getAll('cohortB')).toHaveLength(2);
    const cohorts = await page.evaluate(() => JSON.parse(sessionStorage.getItem('compareCohorts') ?? 'null'));
    expect(cohorts.left).toEqual(sp.getAll('cohortA'));
    expect(cohorts.right).toEqual(sp.getAll('cohortB'));
  });

  test('bulk Submit asks for confirmation then POSTs /v1/runs/submit', async ({ page, request }) => {
    const s = await freshProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await tick(page, 'text2sql-gpt-4o-000');
    await tick(page, 'summarize-gpt-4o-001');
    await page.getByTestId('selection-bar').getByRole('button', { name: 'Submit', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Submit 2 runs for review' });
    await expect(dlg).toBeVisible();
    const post = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/v1/runs/submit',
    );
    await dlg.getByLabel('Comment').fill('please review');
    await dlg.getByRole('button', { name: 'Submit', exact: true }).click();
    const req = await post;
    expect(req.postDataJSON()).toMatchObject({ comment: 'please review' });
    expect(req.postDataJSON().run_ids).toHaveLength(2);
    await expect(page.getByRole('status').filter({ hasText: '2 runs submitted for review' })).toBeVisible();
    await expect(selected(page)).toHaveText('0 executions selected');
    await expect
      .poll(async () => statusText(rowOf(page, 'text2sql-gpt-4o-000')), { timeout: 15_000 })
      .toMatch(/submitted/i);
  });

  test('bulk Delete: confirm dialog starts on Cancel, Cancel keeps rows, Delete removes them', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12);
    const dialogs = failOnNativeDialogs(page);
    await openRuns(page, s.project.slug, 'status=COMPLETED');
    const before = await dataRows(page).count();
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await tick(page, 'text2sql-gpt-4o-000');
    await tick(page, 'summarize-gpt-4o-001');
    const bar = page.getByTestId('selection-bar');
    await bar.getByRole('button', { name: 'Delete', exact: true }).click();
    const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Delete 2 selections\?/ }));
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(dataRows(page)).toHaveCount(before);
    await bar.getByRole('button', { name: 'Delete', exact: true }).click();
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toBeVisible();
    await expect(dataRows(page)).toHaveCount(before - 2);
    await expect(rowOf(page, 'text2sql-gpt-4o-000')).toHaveCount(0);
    expect(dialogs.seen()).toEqual([]);
  });

  test('a failed delete shows an error in the UI and never calls window.alert', async ({ page, request }) => {
    const s = await freshProject(request, 4);
    const dialogs = failOnNativeDialogs(page);
    await openRuns(page, s.project.slug);
    await page.route('**/api/runs/delete', (route) =>
      route.fulfill({ status: 500, json: { detail: 'cannot delete' } }),
    );
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await tick(page, 'text2sql-gpt-4o-000');
    await page.getByTestId('selection-bar').getByRole('button', { name: 'Delete', exact: true }).click();
    const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Delete/ }));
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /could not be deleted|cannot delete|Delete failed|failed/i })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(rowOf(page, 'text2sql-gpt-4o-000')).toBeVisible();
    expect(dialogs.seen()).toEqual([]);
  });
});
