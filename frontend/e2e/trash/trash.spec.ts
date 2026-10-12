/**
 * Brief 07 §2.18 (trash): search, project facet, URL state, selection + restore, archived
 * projects, single restore, non-admin state.
 */
import { test, expect, type Page } from '@playwright/test';
import { archiveProject, createProject, gotoApp, uniqueSlug } from '../helpers';
import { pickSelect, query } from '../datasets/ui';
import { seedTrash } from './support';

const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });
const dataRows = (page: Page) =>
  page.getByRole('grid', { name: 'Deleted runs' }).locator('[role=row]:has([role=gridcell])');
const tag = () => `tr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

test.describe('trash', () => {
  test('lists deleted runs with retention info; search by run id and name is mirrored to ?q=', async ({
    page,
    request,
  }) => {
    const prefix = tag();
    const s = await seedTrash(request, prefix, 3);
    await gotoApp(page, '/trash');
    await expect(page.locator('[data-trash-page]')).toBeVisible();
    await expect(page).toHaveTitle(/Deleted runs/);
    await expect(page.getByText(/Retention/)).toBeVisible();
    await expect(page.getByText('Only admins can restore runs')).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Search run name or ID' });
    await search.fill(prefix);
    await expect.poll(() => query(page).get('q')).toBe(prefix);
    await expect(dataRows(page)).toHaveCount(3);
    await expect(page.getByText('3 matching')).toBeVisible();

    await search.fill(s.runs[1]!.id);
    await expect.poll(() => query(page).get('q')).toBe(s.runs[1]!.id);
    await expect(dataRows(page)).toHaveCount(1);
    await expect(row(page, `${prefix}-1`)).toContainText(s.runs[1]!.id);
    await expect(row(page, `${prefix}-1`)).toContainText(s.project.name);
    await expect(row(page, `${prefix}-1`)).toContainText(/in \d+ days?|Not scheduled|Due now/);
    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search run name or ID' })).toHaveValue(s.runs[1]!.id);
    await expect(dataRows(page)).toHaveCount(1);

    await page.getByRole('searchbox', { name: 'Search run name or ID' }).fill('zzzz-nothing-matches');
    await expect(page.getByText('No deleted runs match')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search run name or ID' }).fill('');
    await expect.poll(() => query(page).get('q')).toBeNull();
  });

  test('project facet narrows the list and lives in ?project=', async ({ page, request }) => {
    const a = await seedTrash(request, tag(), 3);
    const b = await seedTrash(request, tag(), 2);
    await gotoApp(page, '/trash');
    await pickSelect(page, /Project/, new RegExp(`${a.project.name} · 3`));
    await expect.poll(() => query(page).get('project')).toBe(a.project.id);
    await expect(dataRows(page)).toHaveCount(3);
    await expect(page.getByText('3 matching')).toBeVisible();
    await page.reload();
    await expect(dataRows(page)).toHaveCount(3);
    await expect(row(page, a.prefix)).toHaveCount(3);
    await expect(row(page, b.prefix)).toHaveCount(0);

    await pickSelect(page, /Project/, new RegExp(`${b.project.name} · 2`));
    await expect(dataRows(page)).toHaveCount(2);
    await pickSelect(page, /Project/, 'All projects');
    await expect.poll(() => query(page).get('project')).toBeNull();
  });

  test('?page= paging over 50 rows: page 2 in the URL, reload-safe, and [BUG minor] an out-of-range page steps back to the last page with rows', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const s = await seedTrash(request, tag(), 52);
    await gotoApp(page, `/trash?project=${s.project.id}`);
    await expect(dataRows(page)).toHaveCount(50);
    await expect(page.getByText('52 matching')).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(() => query(page).get('page')).toBe('2');
    await expect(dataRows(page)).toHaveCount(2);
    await page.reload();
    await expect(dataRows(page)).toHaveCount(2);
    expect(query(page).get('page')).toBe('2');
    await page.getByRole('button', { name: 'First page' }).click();
    await expect.poll(() => query(page).get('page')).toBeNull();
    await expect(dataRows(page)).toHaveCount(50);

    // out of range -> steps back to the last page that has rows
    await gotoApp(page, `/trash?project=${s.project.id}&page=5`);
    await expect(dataRows(page)).not.toHaveCount(0);
    await expect.poll(() => query(page).get('page')).toBe('2');
  });

  test('Restore selected: rows go away, a toast reports it, the trash no longer lists them', async ({
    page,
    request,
  }) => {
    const s = await seedTrash(request, tag(), 3);
    await gotoApp(page, `/trash?q=${s.prefix}`);
    await expect(dataRows(page)).toHaveCount(3);
    await expect(page.getByTestId('restore-selected')).toBeDisabled();
    // rows toggle on click (no row action)
    await row(page, `${s.prefix}-0`).click();
    await row(page, `${s.prefix}-1`).click();
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await expect(page.getByTestId('restore-selected')).toHaveText(/Restore 2 selected/);
    await page.getByTestId('restore-selected').click();
    await expect(page.getByText('2 runs restored')).toBeVisible();
    await expect(dataRows(page)).toHaveCount(1);
    await expect(row(page, `${s.prefix}-2`)).toHaveCount(1);
    const res = await request.get(`/api/runs/trash?q=${s.prefix}&limit=50`);
    expect(((await res.json()) as unknown[]).length).toBe(1);
  });

  test('select all (Ctrl+A) skips runs of archived projects, which stay unrestorable', async ({
    page,
    request,
  }) => {
    const prefix = tag();
    const live = await seedTrash(request, `${prefix}a`, 3);
    const archivedProject = await createProject(request, `Trash Arch ${prefix}`, uniqueSlug('trasharch'));
    const arch = await seedTrash(request, `${prefix}b`, 2, archivedProject);
    await archiveProject(request, archivedProject.id);
    await gotoApp(page, `/trash?q=${prefix}`);
    await expect(dataRows(page)).toHaveCount(5);
    const archivedRow = row(page, `${arch.prefix}-0`);
    await expect(archivedRow).toContainText('Project archived');
    await expect(archivedRow).toContainText('Paused');
    await expect(archivedRow.getByRole('button', { name: 'Restore' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await row(page, `${live.prefix}-0`).focus();
    await page.keyboard.press('Control+a');
    await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
    await expect(page.getByTestId('restore-selected')).toHaveText(/Restore 3 selected/);
    // clicking a disabled row action only explains, it restores nothing
    await archivedRow.getByRole('button', { name: 'Restore' }).click({ force: true });
    await expect(page.getByText('Unarchive the project to restore this run.').first()).toBeVisible();
    await page.getByTestId('restore-selected').click();
    await expect(page.getByText('3 runs restored')).toBeVisible();
    await expect(dataRows(page)).toHaveCount(2);
    await expect(row(page, `${arch.prefix}-1`)).toHaveCount(1);

    // archived-only view: nothing can be selected
    await row(page, `${arch.prefix}-0`).focus();
    await page.keyboard.press('Control+a');
    await expect(page.getByTestId('restore-selected')).toBeDisabled();
  });

  test('[BUG] the table has a select-all header checkbox and per-row checkboxes', async ({
    page,
    request,
  }) => {
    const s = await seedTrash(request, tag(), 2);
    await gotoApp(page, `/trash?q=${s.prefix}`);
    await expect(dataRows(page)).toHaveCount(2);
    await expect(page.getByRole('grid', { name: 'Deleted runs' }).getByRole('checkbox')).not.toHaveCount(0);
  });

  test('single Restore button restores one run', async ({ page, request }) => {
    const s = await seedTrash(request, tag(), 2);
    await gotoApp(page, `/trash?q=${s.prefix}`);
    await page.getByTestId(`restore-${s.runs[0]!.id}`).click();
    await expect(page.getByText('1 run restored')).toBeVisible();
    await expect(dataRows(page)).toHaveCount(1);
    await expect(row(page, `${s.prefix}-0`)).toHaveCount(0);
  });

  test('empty trash for a project shows the empty state', async ({ page, request }) => {
    const p = await createProject(request, 'Trash Empty', uniqueSlug('trashempty'));
    await gotoApp(page, `/trash?q=${tag()}`);
    await expect(page.getByText('No deleted runs match')).toBeVisible();
    void p;
  });

  test('non-admin (403 from the API) sees "Admin access required"', async ({ page }) => {
    await page.route(/\/api\/runs\/trash/, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Admin access required' }),
      }),
    );
    await gotoApp(page, '/trash');
    await expect(page.getByText('Admin access required').first()).toBeVisible();
    await expect(page.getByText('Only platform admins can view and restore deleted runs.')).toBeVisible();
    await expect(page.getByTestId('restore-selected')).toHaveCount(0);
  });
});
