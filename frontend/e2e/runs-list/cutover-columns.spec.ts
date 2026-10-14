/**
 * Columns menu of the Runs table (cutover of test_runs_column_visibility_browser.py).
 * Redesign 2: the menu lists every column in display order (Run is listed but cannot be hidden), with a
 * freeze toggle and a drag handle per row; see columns-layout.spec.ts for order and freezing.
 */
import { test, expect, type Page } from '@playwright/test';
import { clickBox, openRuns, sharedProject, table } from './support';

const RUN_COLUMNS = [
  'Status',
  'Task',
  'Model',
  'Dataset',
  'Owner',
  'Date',
  'Analysis',
  'Experiment',
  'Version',
  'Duration',
];

const headers = (page: Page) =>
  table(page)
    .locator('thead tr:last-child th')
    .evaluateAll((ths) => ths.map((th) => (th.textContent ?? '').trim()));
const header = (page: Page, name: string) => table(page).getByRole('columnheader', { name, exact: true });
const menu = (page: Page) => page.getByRole('dialog', { name: 'Columns' });

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Columns' }).click();
  await expect(menu(page)).toBeVisible();
}
const box = (page: Page, name: string) => menu(page).getByRole('checkbox', { name, exact: true });

test.describe('runs list: Display > Columns', () => {
  test('every run column is offered and checked by default; Run cannot be hidden', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await openMenu(page);
    for (const label of RUN_COLUMNS) {
      await expect(box(page, label), label).toBeChecked();
      await expect(box(page, label)).toBeEnabled();
    }
    await expect(box(page, 'Run')).toBeChecked();
    await expect(box(page, 'Run')).toBeDisabled();
    await expect(header(page, 'Run')).toBeVisible();
  });

  test('hiding columns removes headers and cells; showing restores them in place', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    await openMenu(page);
    await clickBox(box(page, 'Status'));
    await clickBox(box(page, 'Model'));
    const hidden = await headers(page);
    expect(hidden.some((h) => h.startsWith('Status'))).toBe(false);
    expect(hidden.some((h) => h.startsWith('Model'))).toBe(false);
    expect(hidden.length).toBe(before.length - 2);
    // Cells follow the headers: every body row has as many cells as there are headers.
    const cellCounts = await table(page)
      .locator('tbody tr[data-run-id]')
      .evaluateAll((rows) => rows.map((r) => r.querySelectorAll('td').length));
    expect(new Set(cellCounts)).toEqual(new Set([hidden.length]));
    await clickBox(box(page, 'Status'));
    const again = await headers(page);
    expect(again.length).toBe(before.length - 1);
    expect(again.findIndex((h) => h.startsWith('Status'))).toBe(
      before.findIndex((h) => h.startsWith('Status')),
    );
    // The Run column cannot be hidden: it is the table's anchor.
    expect(again[0]).toContain('Run');
  });

  test('the menu searches columns and All / None act on what is listed', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await openMenu(page);
    await menu(page).getByRole('searchbox', { name: 'Search columns' }).fill('mod');
    await expect(box(page, 'Model')).toBeVisible();
    await expect(box(page, 'Task')).toHaveCount(0);
    await menu(page).getByRole('button', { name: 'None', exact: true }).click();
    await expect(box(page, 'Model')).not.toBeChecked();
    expect((await headers(page)).some((h) => h.startsWith('Model'))).toBe(false);
    expect((await headers(page)).some((h) => h.startsWith('Task'))).toBe(true);
    await menu(page).getByRole('button', { name: 'All', exact: true }).click();
    await expect(box(page, 'Model')).toBeChecked();
  });

  test('a saved choice survives a reload; Reset layout restores every column', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await openMenu(page);
    await clickBox(box(page, 'Task'));
    await clickBox(box(page, 'Version'));
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(table(page)).toBeVisible();
    const reloaded = await headers(page);
    expect(reloaded.some((h) => h.startsWith('Task'))).toBe(false);
    expect(reloaded.some((h) => h.startsWith('Version'))).toBe(false);
    expect(reloaded.some((h) => h.startsWith('Model'))).toBe(true);
    await openMenu(page);
    await expect(box(page, 'Task')).not.toBeChecked();
    await expect(box(page, 'Model')).toBeChecked();
    await menu(page).getByRole('button', { name: 'Reset layout' }).click();
    await expect(box(page, 'Task')).toBeChecked();
    expect((await headers(page)).some((h) => h.startsWith('Task'))).toBe(true);
  });

  test('a choice that lists only metrics keeps its choice and the Actions column', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await page.addInitScript(() => {
      sessionStorage.setItem('qym_visible_metrics', JSON.stringify({ version: 2, visible: ['accuracy'] }));
    });
    await openRuns(page, s.project.slug);
    const list = await headers(page);
    expect(list.some((h) => h.startsWith('Status'))).toBe(false);
    expect(list.some((h) => h.startsWith('Model'))).toBe(false);
    expect(list.some((h) => h.toLowerCase().startsWith('accuracy'))).toBe(true);
    expect(list[list.length - 1]).toContain('Actions');
  });

  test('a choice saved by an older version (a bare list) is ignored and every column shows', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await page.addInitScript(() => {
      sessionStorage.setItem('qym_visible_metrics', JSON.stringify(['accuracy', 'latency']));
    });
    await openRuns(page, s.project.slug);
    const list = await headers(page);
    for (const label of ['Status', 'Task', 'Model', 'Dataset', 'Owner', 'Date', 'Version']) {
      expect(
        list.some((h) => h.startsWith(label)),
        label,
      ).toBe(true);
    }
  });
});
