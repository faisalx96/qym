/// <reference lib="dom" />
/** UX review (area A) regressions: forms are single-flight; compact user menu is axe-clean. */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { axeSeriousViolations, describeViolations } from './support';

/** Delay every non-GET so a second submit lands while the first is in flight. */
async function slowWrites(page: Page, writes: string[]) {
  await page.route('**/v1/**', async (route) => {
    const m = route.request().method();
    if (m !== 'GET') {
      writes.push(`${m} ${new URL(route.request().url()).pathname}`);
      await new Promise((r) => setTimeout(r, 600));
    }
    await route.fallback();
  });
}

test('API key form: Enter twice creates one key', async ({ page, request }) => {
  const p = await createProject(request, 'UX Submit Keys', uniqueSlug('uxkey'));
  await gotoApp(page, `/projects/${p.slug}/settings?tab=apikeys`);
  const writes: string[] = [];
  await slowWrites(page, writes);
  const name = page.getByLabel('Key name');
  await name.fill('double');
  await name.press('Enter');
  await name.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(writes.filter((w) => w.startsWith('POST') && w.includes('/api-keys'))).toHaveLength(1);
});

test('project rename: Enter twice sends one PATCH', async ({ page, request }) => {
  const p = await createProject(request, 'UX Submit Rename', uniqueSlug('uxren'));
  await gotoApp(page, `/projects/${p.slug}/settings?tab=general`);
  const writes: string[] = [];
  await slowWrites(page, writes);
  const input = page.getByRole('textbox', { name: 'Project name' });
  await input.fill('UX Submit Renamed');
  await input.press('Enter');
  await input.press('Enter');
  await expect(page.getByText('Renamed to UX Submit Renamed')).toBeVisible();
  expect(writes.filter((w) => w.startsWith('PATCH'))).toHaveLength(1);
});

test('admin create user: Enter twice sends one POST', async ({ page }) => {
  await gotoApp(page, '/admin/users');
  const form = page.locator('[data-create-user]');
  await expect(form).toBeVisible();
  const writes: string[] = [];
  await slowWrites(page, writes);
  const email = form.getByLabel('Email');
  const addr = `${uniqueSlug('dbl')}@e2e.test`;
  await email.fill(addr);
  await email.press('Enter');
  await email.press('Enter');
  await expect(page.getByText(`User ${addr} created`)).toBeVisible();
  expect(writes.filter((w) => w.startsWith('POST') && w.endsWith('/admin/users'))).toHaveLength(1);
});

test('compact (390px) user menu trigger: accessible name contains its visible text', async ({
  page,
  request,
}) => {
  const p = await createProject(request, 'UX Compact Menu', uniqueSlug('uxcm'));
  await page.setViewportSize({ width: 390, height: 800 });
  await gotoApp(page, `/projects/${p.slug}`);
  await expect(page.locator('[data-user-menu]')).toBeVisible();
  const v = await axeSeriousViolations(page);
  expect(v, describeViolations(v)).toEqual([]);
  await expect(page.locator('[data-user-menu]')).toHaveAccessibleName(/account menu/);
});
