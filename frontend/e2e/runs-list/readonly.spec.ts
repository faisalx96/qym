/** Archived (read-only) project: no write actions in rows or in the selection bar. */
import { test, expect } from '@playwright/test';
import { archiveProject } from '../helpers';
import { clickBox, dataRows, freshProject, openPassMenu, openRowMenu, openRuns, rowOf } from './support';

test.describe('archived project (read-only)', () => {
  test('rows hide submit / delete / review actions; the selection bar hides Submit and Delete', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12);
    // control: the live project shows the actions
    await openRuns(page, s.project.slug);
    const live = await openRowMenu(page, rowOf(page, 'text2sql-gpt-4o-000'));
    await expect(live.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await page.keyboard.press('Escape');
    await archiveProject(request, s.project.id);
    await page.reload();
    await expect(dataRows(page).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Delete|Submit|More actions for) / })).toHaveCount(0);
    // a viewer's row menu holds only auto-analysis; a live run has nothing in it, so no handle
    const menu = await openRowMenu(page, rowOf(page, 'text2sql-gpt-4o-000'));
    await expect(menu.getByRole('menuitem')).toHaveText(['Open auto-analysis']);
    await page.keyboard.press('Escape');
    await expect(rowOf(page, '-007').locator('td[data-col="actions"]').getByRole('button')).toHaveCount(0);
    // select mode: compare and cohort stay, write actions go
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await clickBox(page.getByRole('checkbox', { name: 'Select text2sql-gpt-4o-000', exact: true }));
    const bar = page.getByTestId('selection-bar');
    await expect(bar.getByRole('button', { name: 'Compare' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Cohort', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Submit' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });

  test('passes panel of an archived project has no delete-pass action', async ({ page, request }) => {
    const s = await freshProject(request, 6, { running: false });
    await archiveProject(request, s.project.id);
    await openRuns(page, s.project.slug);
    await rowOf(page, 'rag-qa-gpt-4o-005')
      .getByRole('button', { name: /Expand 3 passes/ })
      .click();
    const panel = page.getByTestId('runs-table');
    await expect(panel.locator('tbody tr[data-pass-row]')).toHaveCount(3);
    await openPassMenu(panel, page, 1);
    await expect(page.getByRole('menuitem', { name: /Open pass 1/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Delete pass/ })).toHaveCount(0);
  });
});
