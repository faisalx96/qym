/**
 * Brief 07 §2.14-2.17 (reviews): URL-mirrored filters, keyboard triage, dialogs and focus,
 * deep link, inline edit, review_block, bulk conflict, Load more.
 */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { listCorrections, setReviewRules } from '../datasets/support';
import { query } from '../datasets/ui';
import { decideViaApi, seedReviews } from './support';

const rows = (page: Page) => page.locator('[data-correction-row]');
const row = (page: Page, id: number) => page.locator(`[data-correction-row="${id}"]`);
const tabCount = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });

test.describe('reviews: filters in the URL', () => {
  test('status tabs, search, sort and clear filters are mirrored to the URL and reload-safe', async ({ page, request }) => {
    const s = await seedReviews(request, 'revurl', 4);
    await decideViaApi(request, s.corrections[0]!.id, 'approve');
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(rows(page)).toHaveCount(3);
    await expect(tabCount(page, 'To review')).toContainText('3');
    await expect(tabCount(page, 'Approved')).toContainText('1');
    await expect(page.getByTestId('result-count')).toHaveText('3 corrections');

    await tabCount(page, 'Approved').click();
    await expect.poll(() => query(page).get('status')).toBe('approved');
    await expect(rows(page)).toHaveCount(1);
    await tabCount(page, 'All').click();
    await expect(rows(page)).toHaveCount(4);
    await page.reload();
    await expect(tabCount(page, 'All')).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page)).toHaveCount(4);

    await page.getByRole('searchbox', { name: 'Search corrections' }).fill('Cat-2');
    await expect.poll(() => query(page).get('q')).toBe('Cat-2');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId('result-count')).toHaveText('1 correction');
    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search corrections' })).toHaveValue('Cat-2');
    await expect(rows(page)).toHaveCount(1);

    await page.getByTestId('clear-filters').click();
    await expect.poll(() => query(page).get('q')).toBeNull();
    expect(query(page).get('status')).toBe('pending');
    await expect(rows(page)).toHaveCount(3);

    await page.getByRole('button', { name: /Sort/ }).click();
    await page.getByRole('option', { name: 'Most recent' }).click();
    await expect.poll(() => query(page).get('sort')).toBe('newest');
    await expect(rows(page).first()).toHaveAttribute('data-correction-row', String(s.corrections[3]!.id));
    await page.reload();
    await expect(rows(page).first()).toHaveAttribute('data-correction-row', String(s.corrections[3]!.id));
  });

  test('deep link with every filter hydrates chips, controls and the result; __none__ means none selected', async ({ page, request }) => {
    const s = await seedReviews(request, 'revchips', 3);
    const url = `/projects/${s.project.slug}/reviews?status=all&task=qa&model=${encodeURIComponent('openai/gpt-4o')}&dataset=${encodeURIComponent(s.dataset)}&run=${encodeURIComponent(s.runName)}`;
    await gotoApp(page, url);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.locator('[data-filter-chip=task]')).toContainText('Tasks: qa');
    await expect(page.locator('[data-filter-chip=model]')).toContainText('Models: openai/gpt-4o');
    await expect(page.locator('[data-filter-chip=dataset]')).toContainText(`Datasets: ${s.dataset}`);
    await expect(page.locator('[data-filter-chip=run]')).toContainText(`Runs: ${s.runName}`);
    await expect(page.getByTestId('filters-trigger')).toContainText('Filters (4)');

    // the confidence band is mirrored as conf_min / conf_max and shown as a chip
    await gotoApp(page, `/projects/${s.project.slug}/reviews?status=all&conf_min=10&conf_max=90`);
    await expect(page.locator('[data-filter-chip=conf]')).toContainText('Confidence 10–90%');
    await page.getByRole('button', { name: /Remove filter Confidence/ }).click();
    await expect.poll(() => query(page).get('conf_min')).toBeNull();
    expect(query(page).get('conf_max')).toBeNull();
    await gotoApp(page, url);
    await expect(rows(page)).toHaveCount(3);

    // removing a chip updates the URL and keeps the others
    await page.getByRole('button', { name: /Remove filter Models/ }).click();
    await expect.poll(() => query(page).get('model')).toBeNull();
    expect(query(page).get('task')).toBe('qa');
    await expect(rows(page)).toHaveCount(3);

    // the sentinel: none selected -> nothing matches, chip says none, URL keeps __none__
    await gotoApp(page, `/projects/${s.project.slug}/reviews?task=__none__`);
    await expect(page.locator('[data-filter-chip=task]')).toContainText('Tasks: none');
    // legacy parity: an empty facet sends no filter to the API (only the URL differs), so rows still list
    await expect(rows(page)).toHaveCount(3);
    expect(query(page).getAll('task')).toEqual(['__none__']);
    await page.reload();
    await expect(page.locator('[data-filter-chip=task]')).toContainText('Tasks: none');
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(rows(page)).toHaveCount(3);
    expect(query(page).get('task')).toBeNull();
  });

  test('Filters panel: the source segmented control writes to the URL', async ({ page, request }) => {
    const s = await seedReviews(request, 'revpop', 3);
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await page.getByTestId('filters-trigger').click();
    const pop = page.getByRole('group', { name: 'Filters' });
    await pop.getByText('AI only', { exact: true }).click();
    await expect.poll(() => query(page).get('source')).toBe('ai_only');
    // (the SQLite test DB cannot evaluate the AI-source filters: only the URL contract is asserted)
    await pop.getByText('Human only', { exact: true }).click();
    await expect.poll(() => query(page).get('source')).toBe('human_only');
    await expect(page.locator('[data-filter-chip=source]')).toContainText('Human only');
    await pop.getByRole('radiogroup', { name: 'Source' }).getByText('All', { exact: true }).click();
    await expect.poll(() => query(page).get('source')).toBeNull();
    await expect(rows(page)).toHaveCount(3);

  });

  test('[BUG] facet multiselect inside the Filters panel stays open and writes to the URL', async ({ page, request }) => {
    const s = await seedReviews(request, 'revfacet', 3);
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await page.getByTestId('filters-trigger').click();
    const pop = page.getByRole('group', { name: 'Filters' });
    await pop.getByRole('button', { name: /Tasks/ }).click();
    const tasks = page.getByRole('dialog', { name: 'Tasks options' });
    await tasks.getByText('qa', { exact: true }).click(); // deselect the only task -> none selected
    await expect.poll(() => query(page).getAll('task')).toEqual(['__none__']);
    await expect(page.locator('[data-filter-chip=task]')).toContainText('Tasks: none');
    await tasks.getByText('qa', { exact: true }).click(); // everything selected again -> no filter
    await expect.poll(() => query(page).getAll('task')).toEqual([]);
  });

  test('source=corrected: URL contract and chip (the SQLite backend cannot list it)', async ({ page, request }) => {
    const s = await seedReviews(request, 'revcorr', 2);
    await gotoApp(page, `/projects/${s.project.slug}/reviews?source=corrected`);
    await expect(page.locator('[data-filter-chip=source]')).toContainText('AI+Human corrected');
    expect(query(page).get('source')).toBe('corrected');
    await page.reload();
    await expect(page.locator('[data-filter-chip=source]')).toContainText('AI+Human corrected');
  });

  test('all-projects /reviews shows the project name in rows and lists corrections of every project', async ({ page, request }) => {
    const a = await seedReviews(request, 'revall', 1);
    await gotoApp(page, `/reviews?q=${encodeURIComponent('Cat-0')}`);
    await expect(row(page, a.corrections[0]!.id)).toContainText(a.project.name);
  });
});

test.describe('reviews: keyboard triage', () => {
  test('j moves the current row, a approves it: the card leaves the queue and the counts update', async ({ page, request }) => {
    const s = await seedReviews(request, 'revkeys', 4);
    const [c0, c1, c2] = s.corrections;
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(rows(page)).toHaveCount(4);
    await expect(row(page, c0!.id)).toHaveAttribute('data-current', '');
    await row(page, c0!.id).locator('[data-review-card]').focus();
    await page.keyboard.press('j');
    await expect(row(page, c1!.id)).toHaveAttribute('data-current', '');
    await expect(page.locator(`[data-detail-pane="${c1!.id}"]`)).toBeVisible();
    await page.keyboard.press('a');
    await expect(row(page, c1!.id)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(3);
    await expect(tabCount(page, 'To review')).toContainText('3');
    await expect(tabCount(page, 'Approved')).toContainText('1');
    await expect(page.getByTestId('result-count')).toHaveText('3 corrections');
    await expect(page.getByText(`Approved #${c1!.id}`)).toBeVisible();
    // the neighbour becomes current and keeps keyboard focus
    await expect(row(page, c2!.id)).toHaveAttribute('data-current', '');
    expect((await listCorrections(request, s.project.slug, 'approved')).map((c) => c.id)).toEqual([c1!.id]);
    await page.keyboard.press('k');
    await expect(row(page, c0!.id)).toHaveAttribute('data-current', '');
  });

  test('x selects two rows, Shift+A opens the comment dialog and approves both', async ({ page, request }) => {
    const s = await seedReviews(request, 'revbulkkey', 4);
    const [c0, c1] = s.corrections;
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await row(page, c0!.id).locator('[data-review-card]').focus();
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    const bulk = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulk).toContainText('2 selected');
    await page.keyboard.press('Shift+A');
    const dialog = page.getByRole('dialog', { name: 'Approve 2 corrections' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: /Comment/ }).fill('looks right');
    await dialog.getByTestId('comment-confirm').click();
    await expect(page.getByText('2 corrections approved')).toBeVisible();
    await expect(row(page, c0!.id)).toHaveCount(0);
    await expect(row(page, c1!.id)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    await expect(tabCount(page, 'Approved')).toContainText('2');
    const approved = await listCorrections(request, s.project.slug, 'approved');
    expect(approved.map((c) => c.id).sort()).toEqual([c0!.id, c1!.id]);
  });

  test('Shift+A with nothing selected hints instead of opening a dialog; ? opens shortcuts; / focuses search', async ({ page, request }) => {
    const s = await seedReviews(request, 'revhelp', 2);
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await row(page, s.corrections[0]!.id).locator('[data-review-card]').focus();
    await page.keyboard.press('Shift+A');
    await expect(page.getByText('Select corrections with x first.')).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search corrections' })).toBeFocused();
  });

  test('r opens the Reject dialog; Esc closes it and focus returns to the row; Reject with a comment decides', async ({ page, request }) => {
    const s = await seedReviews(request, 'revreject', 3);
    const c0 = s.corrections[0]!;
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await row(page, c0.id).locator('[data-review-card]').focus();
    await page.keyboard.press('r');
    const dialog = page.getByRole('dialog', { name: 'Reject correction' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /Comment/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(row(page, c0.id).locator('[data-review-card]')).toBeFocused();
    await expect(row(page, c0.id)).toHaveCount(1); // nothing was decided

    await page.keyboard.press('r');
    await dialog.getByRole('textbox', { name: /Comment/ }).fill('wrong category');
    await dialog.getByTestId('comment-confirm').click();
    await expect(page.getByText(`Rejected #${c0.id}`)).toBeVisible();
    await expect(row(page, c0.id)).toHaveCount(0);
    await expect(tabCount(page, 'Rejected')).toContainText('1');
    expect((await listCorrections(request, s.project.slug, 'rejected')).map((c) => c.id)).toEqual([c0.id]);
  });

  test('row buttons approve/reject and a decided row can be reset from the Approved tab', async ({ page, request }) => {
    const s = await seedReviews(request, 'revbtn', 2);
    const [c0, c1] = s.corrections;
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await page.getByRole('button', { name: `Approve correction ${c0!.id}` }).click();
    await expect(row(page, c0!.id)).toHaveCount(0);
    await page.getByTestId('detail-approve').click(); // current moved to c1
    await expect(row(page, c1!.id)).toHaveCount(0);
    await expect(page.getByText('Queue is empty')).toBeVisible();
    await tabCount(page, 'Approved').click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('button', { name: `Reset correction ${c0!.id}` }).click();
    await expect(row(page, c0!.id)).toHaveCount(0);
    await expect(tabCount(page, 'To review')).toContainText('1');
  });

  test('o toggles full details (snapshots, revision history)', async ({ page, request }) => {
    const s = await seedReviews(request, 'revdetails', 1);
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await row(page, s.corrections[0]!.id).locator('[data-review-card]').focus();
    await page.keyboard.press('o');
    await expect(page.getByTestId('detail-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-full-detail]')).toBeVisible();
    await page.keyboard.press('o');
    await expect(page.locator('[data-full-detail]')).toHaveCount(0);
  });
});

test.describe('reviews: deep link, edit, blocks, conflicts, paging', () => {
  test('?id= deep link switches to the right status tab and marks the row Linked', async ({ page, request }) => {
    const s = await seedReviews(request, 'revlink', 3);
    const target = s.corrections[1]!;
    await decideViaApi(request, target.id, 'approve');
    await gotoApp(page, `/projects/${s.project.slug}/reviews?id=${target.id}`);
    await expect(tabCount(page, 'Approved')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => query(page).get('status')).toBe('approved');
    await expect(row(page, target.id)).toContainText('Linked');
    await expect(row(page, target.id)).toHaveAttribute('data-current', '');
    await expect(page.locator(`[data-detail-pane="${target.id}"]`)).toBeVisible();
  });

  test('inline edit: e opens the form, Save persists the new diagnosis', async ({ page, request }) => {
    const s = await seedReviews(request, 'revedit', 2);
    const c0 = s.corrections[0]!;
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await row(page, c0.id).locator('[data-review-card]').focus();
    await page.keyboard.press('e');
    const category = page.getByRole('textbox', { name: /^Category/ });
    await expect(category).toBeFocused();
    await category.fill('Edited category');
    await page.getByTestId('edit-save').click();
    await expect(page.getByText('Diagnosis saved')).toBeVisible();
    await expect(page.locator('[data-detail-pane]')).toContainText('Edited category');
    await expect(rows(page).first()).toContainText('Edited category');
    // Esc cancels an edit without saving
    await page.getByTestId('detail-edit').click();
    await page.getByRole('textbox', { name: /^Category/ }).fill('Nope');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: /^Category/ })).toHaveCount(0);
    await expect(page.locator('[data-detail-pane]')).not.toContainText('Nope');
  });

  test('review_block: require-different-reviewer disables decisions and explains why', async ({ page, request }) => {
    const project = await createProject(request, 'Reviews Block', uniqueSlug('revblock'));
    await setReviewRules(request, project.id, { correction_require_different_reviewer: true });
    const s = await seedReviews(request, 'revblock', 2, { project });
    const c0 = s.corrections[0]!;
    // Under QYM_AUTH_MODE=none the platform never returns review_block (self_review_block skips auth none),
    // so the same-reviewer response is injected into the list payload; the rule itself is also set on the project.
    await page.route(/\/api\/corrections\?/, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { corrections: Record<string, unknown>[] };
      for (const c of body.corrections) c.review_block = 'You wrote this correction; a different reviewer must decide it.';
      await route.fulfill({ response: res, json: body });
    });
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(page.locator('[data-review-block]')).toBeVisible();
    await expect(page.getByTestId('detail-approve')).toBeDisabled();
    await expect(page.getByTestId('detail-reject')).toBeDisabled();
    await expect(page.getByRole('button', { name: `Approve correction ${c0.id}` })).toBeDisabled();
    await expect(page.getByRole('button', { name: `Reject correction ${c0.id}` })).toBeDisabled();
    // keyboard shortcuts must not act either
    await row(page, c0.id).locator('[data-review-card]').focus();
    await page.keyboard.press('a');
    await expect(row(page, c0.id)).toHaveCount(1);
    expect(await listCorrections(request, s.project.slug, 'approved')).toHaveLength(0);
  });

  test('bulk 409: "The list changed" alertdialog, Reload and select again clears the selection', async ({ page, request }) => {
    const s = await seedReviews(request, 'revconflict', 4);
    const [c0, c1, c2] = s.corrections;
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await page.getByRole('checkbox', { name: `Select correction ${c0!.id}` }).check({ force: true });
    await page.getByRole('checkbox', { name: `Select correction ${c1!.id}` }).check({ force: true });
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('2 selected');
    // another reviewer approves one of the selected rows in the meantime
    await decideViaApi(request, c0!.id, 'approve');
    await page.getByTestId('bulk-approve').click();
    await page.getByTestId('comment-confirm').click();
    const conflict = page.getByRole('alertdialog', { name: 'The list changed' });
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('Nothing was changed');
    await conflict.getByTestId('conflict-reload').click();
    await expect(conflict).toBeHidden();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).not.toContainText('selected');
    await expect(row(page, c0!.id)).toHaveCount(0);
    await expect(row(page, c1!.id)).toHaveCount(1);
    await expect(row(page, c2!.id)).toHaveCount(1);
    // c1 was untouched by the failed bulk
    expect((await listCorrections(request, s.project.slug, 'approved')).map((c) => c.id)).toEqual([c0!.id]);
  });

  test('Load more: 30 corrections page in 25 at a time', async ({ page, request }) => {
    test.setTimeout(90_000);
    const s = await seedReviews(request, 'revpage', 30);
    await page.setViewportSize({ width: 1280, height: 600 });
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(page.getByTestId('result-count')).toHaveText('30 corrections');
    await expect.poll(async () => rows(page).count()).toBeGreaterThanOrEqual(25);
    await page.getByTestId('load-more').scrollIntoViewIfNeeded();
    await expect(rows(page)).toHaveCount(30);
    await expect(page.getByTestId('load-more')).toHaveCount(0);
  });

  test('bulk Reset and Delete from the selection bar', async ({ page, request }) => {
    const s = await seedReviews(request, 'revbulk2', 3);
    const [c0, c1, c2] = s.corrections;
    await decideViaApi(request, c0!.id, 'approve');
    await decideViaApi(request, c1!.id, 'approve');
    await gotoApp(page, `/projects/${s.project.slug}/reviews?status=approved`);
    await page.getByRole('checkbox', { name: 'Select all visible corrections' }).check({ force: true }).catch(async () => {
      await page.getByRole('checkbox', { name: /Select all/ }).check({ force: true });
    });
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('2 selected');
    await page.getByTestId('bulk-reset').click();
    await expect(page.getByText('2 corrections reset')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    await tabCount(page, 'To review').click();
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole('checkbox', { name: `Select correction ${c2!.id}` }).check({ force: true });
    await page.getByTestId('bulk-delete').click();
    await page.getByRole('alertdialog', { name: 'Delete 1 correction?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(row(page, c2!.id)).toHaveCount(0);
  });
});
