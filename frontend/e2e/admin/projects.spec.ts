/// <reference lib="dom" />
/** Admin Projects tab (brief 09 §8.6-7). */
import { test, expect } from '@playwright/test';
import { createApiKey, createProject, createRun, gotoApp, uniqueSlug, unarchiveProject } from '../helpers';

test('New project creates a row', async ({ page }) => {
  await gotoApp(page, '/admin/projects');
  await page.locator('[data-new-project]').click();
  const dialog = page.getByRole('dialog').filter({ hasText: /New project|Create project/i });
  await expect(dialog).toBeVisible();
  const name = `Admin New ${uniqueSlug('n')}`;
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: /^Create/ }).click();
  // Creating navigates to the new project.
  await expect(page).toHaveURL(/\/projects\/admin-new-/);
  // Back in-app (no reload): the cached admin list must already include the new project.
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/projects$/);
  await expect(page.getByRole('grid', { name: 'Projects' }).getByRole('row').filter({ hasText: name })).toBeVisible();
});

test('archive previews in-progress runs, then the project is Archived and gone from the switcher', async ({ page, request }) => {
  const slug = uniqueSlug('arch');
  const project = await createProject(request, 'Archive Me', slug);
  const token = await createApiKey(request, project.id);
  const inflight = await createRun(request, token, { name: uniqueSlug('inflight'), finish: false });

  await gotoApp(page, '/admin/projects');
  const row = page.getByRole('grid', { name: 'Projects' }).getByRole('row').filter({ hasText: slug });
  await row.locator(`[data-project-archive="${project.id}"]`).click();
  const dialog = page.getByRole('alertdialog', { name: /Archive “Archive Me”\?/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('1 run is still running');
  await expect(dialog).toContainText(inflight.run_id);
  await dialog.getByRole('button', { name: 'Archive anyway' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/projects$/);
  await expect(row).toContainText('Archived');
  await expect(row.locator(`[data-project-unarchive="${project.id}"]`)).toBeVisible();

  // The sidebar switcher no longer lists it.
  const other = await createProject(request, 'Switcher Host', uniqueSlug('host'));
  await gotoApp(page, `/projects/${other.slug}`);
  await page.locator('[data-project-switcher]').click();
  const switcher = page.getByRole('dialog', { name: 'Switch project' });
  await expect(switcher).toBeVisible();
  await expect(switcher).not.toContainText('Archive Me');
});

test('unarchive previews active keys; "Revoke keys first" opens settings?tab=apikeys', async ({ page, request }) => {
  const slug = uniqueSlug('unarch');
  const project = await createProject(request, 'Unarchive Me', slug);
  await createApiKey(request, project.id);
  // archive through the API (keys stay active in the preview)
  const res = await request.post(`/v1/admin/projects/${project.id}/archive`);
  expect(res.ok(), await res.text()).toBeTruthy();

  await gotoApp(page, '/admin/projects');
  const row = page.getByRole('grid', { name: 'Projects' }).getByRole('row').filter({ hasText: slug });
  await row.locator(`[data-project-unarchive="${project.id}"]`).click();
  const dialog = page.getByRole('alertdialog', { name: /Unarchive “Unarchive Me”\?/ });
  await expect(dialog).toBeVisible();
  const alt = dialog.getByRole('button', { name: 'Revoke keys first' });
  await expect(alt).toBeVisible();
  await alt.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${slug}/settings\\?tab=apikeys$`));
  await expect(page.getByRole('tab', { name: 'API keys' })).toHaveAttribute('aria-selected', 'true');
  await unarchiveProject(request, project.id);
});

test('unarchive confirm makes the project Active again', async ({ page, request }) => {
  const slug = uniqueSlug('unarch2');
  const project = await createProject(request, 'Unarchive Two', slug);
  expect((await request.post(`/v1/admin/projects/${project.id}/archive`)).ok()).toBeTruthy();
  await gotoApp(page, '/admin/projects');
  const row = page.getByRole('grid', { name: 'Projects' }).getByRole('row').filter({ hasText: slug });
  await row.locator(`[data-project-unarchive="${project.id}"]`).click();
  const dialog = page.getByRole('dialog', { name: /Unarchive/ });
  await expect(dialog.getByRole('button', { name: 'Revoke keys first' })).toHaveCount(0);
  await dialog.getByRole('button', { name: /^Unarchive( anyway)?$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('Active');
});
