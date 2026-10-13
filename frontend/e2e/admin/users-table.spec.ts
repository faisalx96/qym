/** Admin users table on DataTable v2: density menu, persisted per table. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';

test('density menu changes the row height and the choice survives a reload', async ({ page }) => {
  await gotoApp(page, '/admin/users');
  const grid = page.getByRole('grid', { name: 'Users' });
  const row = grid.getByRole('row').nth(1);
  await expect(row).toBeVisible();
  const regular = (await row.boundingBox())!.height;
  await page.getByRole('button', { name: 'Row density' }).click();
  await page.getByRole('menuitem', { name: 'Compact' }).click();
  await expect.poll(async () => (await row.boundingBox())!.height).toBeLessThan(regular);
  await page.reload();
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeLessThan(regular);
  // reset for the other specs sharing this browser profile
  await page.getByRole('button', { name: 'Row density' }).click();
  await page.getByRole('menuitem', { name: 'Regular' }).click();
});
