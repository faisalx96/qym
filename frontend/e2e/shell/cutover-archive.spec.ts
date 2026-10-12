/**
 * Archive flows of test_archived_project_browser.py that the other shell/admin specs do not
 * assert: the long list of in-progress runs, "Archive instead" from a blocked delete, the
 * read-only datasets of an archived project (the password-reset warning is a Vitest in
 * src/features/admin/users/__tests__). The server rules
 * (admin-only preview, purge pause, read-only enforcement) stay pinned by
 * tests/platform/test_archived_project_read_only.py and test_archived_project_purge_pause.py.
 */
import { test, expect } from '@playwright/test';
import { archiveProject, createApiKey, createProject, createRun, gotoApp, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, publishVersion, sampleItems } from '../datasets/support';

async function projectWithRunning(request: Parameters<typeof createProject>[0], count: number) {
  const project = await createProject(request, 'Support bot', uniqueSlug('arch-run'));
  const token = await createApiKey(request, project.id);
  for (let i = 1; i <= count; i++) await createRun(request, token, { name: `nightly-${i}`, finish: false });
  return project;
}

const isActive = async (request: Parameters<typeof createProject>[0], slug: string) =>
  ((await (await request.get(`/v1/projects/by-slug/${slug}`)).json()) as { is_active: boolean }).is_active;

test('the settings Archive dialog lists five in-progress runs and "2 more"; Cancel keeps the project active', async ({
  page,
  request,
}) => {
  const project = await projectWithRunning(request, 7);
  await gotoApp(page, `/projects/${project.slug}/settings?tab=danger`);
  await page.locator('[data-danger-zone]').getByRole('button', { name: 'Archive' }).click();
  const dialog = page.getByRole('alertdialog', { name: /^Archive / });
  await expect(dialog).toContainText('7 runs are still running');
  await expect(dialog.getByRole('listitem')).toHaveCount(6);
  await expect(dialog.getByRole('listitem').last()).toContainText('2 more');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await isActive(request, project.slug)).toBe(true);
  await page.locator('[data-danger-zone]').getByRole('button', { name: 'Archive' }).click();
  await page
    .getByRole('alertdialog', { name: /^Archive / })
    .getByRole('button', { name: /^Archive (project|anyway)$/ })
    .click();
  await expect.poll(() => isActive(request, project.slug)).toBe(false);
});

test('a project that cannot be deleted offers "Archive instead", which shows the same running-run warning', async ({
  page,
  request,
}) => {
  const project = await projectWithRunning(request, 1);
  await gotoApp(page, `/projects/${project.slug}/settings?tab=danger`);
  await page.locator('[data-danger-zone]').getByRole('button', { name: 'Delete' }).click();
  const blocked = page.getByRole('alertdialog', { name: /cannot be deleted yet/ });
  await expect(blocked).toBeVisible();
  await blocked.getByRole('button', { name: 'Archive instead' }).click();
  const dialog = page.getByRole('alertdialog', { name: /^Archive / });
  await expect(dialog).toContainText('1 run is still running');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await isActive(request, project.slug)).toBe(true);
  await page.locator('[data-danger-zone]').getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog', { name: /cannot be deleted yet/ })
    .getByRole('button', { name: 'Archive instead' })
    .click();
  await page
    .getByRole('alertdialog', { name: /^Archive / })
    .getByRole('button', { name: /^Archive (project|anyway)$/ })
    .click();
  await expect.poll(() => isActive(request, project.slug)).toBe(false);
});

test('the Archive dialog of a quiet project has no warning', async ({ page, request }) => {
  const project = await createProject(request, 'Quiet', uniqueSlug('arch-quiet'));
  await gotoApp(page, `/projects/${project.slug}/settings?tab=danger`);
  await page.locator('[data-danger-zone]').getByRole('button', { name: 'Archive' }).click();
  const dialog = page.getByRole('alertdialog', { name: /^Archive / });
  await expect(dialog.getByRole('button', { name: /^Archive (project|anyway)$/ })).toBeVisible();
  await expect(dialog).not.toContainText('still running');
  await expect(dialog.getByRole('listitem')).toHaveCount(0);
});

test('the datasets of an archived project are read-only: no creation, no draft, no publish, no item editing', async ({
  page,
  request,
}) => {
  const project = await createProject(request, 'Archived data', uniqueSlug('arch-ds'));
  const ds = await createDataset(request, project.slug, 'Golden');
  const v = await createVersion(request, project.slug, ds.slug);
  await bulkItems(request, project.slug, ds.slug, v.version, sampleItems(3));
  await publishVersion(request, project.slug, ds.slug, v.version, true);
  await archiveProject(request, project.id);

  await gotoApp(page, `/projects/${project.slug}/datasets`);
  await expect(page.locator('[data-archived-banner]')).toBeVisible();
  await expect(page.getByText('Golden').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /New dataset/ })).toHaveCount(0);

  await gotoApp(page, `/projects/${project.slug}/datasets/${ds.slug}`);
  await expect(page.locator('[data-archived-banner]')).toBeVisible();
  await expect(page.locator('[data-items-tab]')).toBeVisible();
  for (const label of [/Create draft/, /Set as production/, /^Publish/, /Add item/]) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
  }
});
