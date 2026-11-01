/**
 * Restore feedback (cutover of test_archived_project_browser.py::test_trash_restore_reports_success_and_failure):
 * the success toast is covered by trash.spec.ts; here the server's reason is shown when the restore fails
 * and the row stays restorable.
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { openTrashRowMenu, seedTrash } from './support';

const tag = () => `trf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

test('a failed restore shows the server reason and keeps the row restorable', async ({ page, request }) => {
  const s = await seedTrash(request, tag(), 2);
  await page.route('**/api/runs/restore', (route) =>
    route.fulfill({ status: 404, json: { detail: 'Deleted run not found' } }),
  );
  await gotoApp(page, `/trash?q=${s.prefix}`);
  const runRow = page.getByRole('row').filter({ hasText: `${s.prefix}-1` });
  await (await openTrashRowMenu(page, runRow)).getByRole('menuitem', { name: 'Restore' }).click();
  await expect(page.getByText('Deleted run not found')).toBeVisible();
  // the row stays, and its menu still offers Restore
  const menu = await openTrashRowMenu(page, runRow);
  await expect(menu.getByRole('menuitem', { name: 'Restore' })).not.toHaveAttribute('aria-disabled', 'true');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
