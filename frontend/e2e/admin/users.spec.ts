/// <reference lib="dom" />
/** Admin Users tab (brief 09 §2, §8.3-4). */
import { test, expect, type Page } from '@playwright/test';
import { createUser, gotoApp, uniqueSlug } from '../helpers';

const uniq = (p: string) => `${uniqueSlug(p)}@e2e.test`;

async function openUsers(page: Page) {
  await gotoApp(page, '/admin/users');
  await expect(page.locator('[data-create-user]')).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Users' })).toBeVisible();
}

test.describe('create user', () => {
  test('validation, success toast, duplicate shows "already exists"', async ({ page }) => {
    await openUsers(page);
    const form = page.locator('[data-create-user]');
    const email = form.getByLabel('Email');
    const submit = form.getByRole('button', { name: 'Create user' });
    await expect(submit).toBeDisabled();
    await email.fill('a@b');
    await submit.click();
    await expect(form.getByText('Enter a valid email address.')).toBeVisible();

    const addr = uniq('new');
    await email.fill(addr);
    await form.getByLabel('Display name').fill('New Person');
    await submit.click();
    await expect(page.getByText(`User ${addr} created`)).toBeVisible();
    const table = page.getByRole('grid', { name: 'Users' });
    await expect(table.getByRole('row').filter({ hasText: addr })).toContainText('member');
    await expect(email).toHaveValue('');

    await email.fill(addr);
    await submit.click();
    await expect(page.getByText(`${addr} already exists`)).toBeVisible();
  });
});

test.describe('disable / enable', () => {
  test('disable asks for confirmation, then an Undo toast re-enables', async ({ page, request }) => {
    const u = await createUser(request, uniq('dis'), 'Disable Me');
    await openUsers(page);
    const row = page.getByRole('grid', { name: 'Users' }).getByRole('row').filter({ hasText: u.email });
    await row.getByRole('button', { name: /^Disable / }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Disable user' });
    await expect(dialog).toContainText(u.email);
    await dialog.getByRole('button', { name: 'Disable user' }).click();
    await expect(row).toContainText('Disabled');
    const toast = page.getByText('Disabled Disable Me');
    await expect(toast).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toContainText('Active');
    await expect(page.getByText(/Enabled Disable Me again/)).toBeVisible();
    // server agrees
    const list = await (await request.get('/v1/admin/users')).json();
    const users = (list.users ?? list) as { id: string; is_active: boolean }[];
    expect(users.find((x) => x.id === u.id)?.is_active).toBe(true);
  });

  test('a disabled user can be enabled with the Enable button (no confirm)', async ({ page, request }) => {
    const u = await createUser(request, uniq('en'), 'Enable Me');
    expect((await request.put(`/v1/admin/users/${u.id}`, { data: { is_active: false } })).ok()).toBeTruthy();
    await openUsers(page);
    const row = page.getByRole('grid', { name: 'Users' }).getByRole('row').filter({ hasText: u.email });
    await expect(row).toContainText('Disabled');
    await row.getByRole('button', { name: /^Enable / }).click();
    await expect(row).toContainText('Active');
  });

  test('own row: Disable is disabled and tagged "you"', async ({ page }) => {
    await openUsers(page);
    const row = page.getByRole('grid', { name: 'Users' }).getByRole('row').filter({ hasText: 'dev@local' });
    await expect(row).toContainText('you');
    await expect(row.locator('[data-user-self-disable]')).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('edit user', () => {
  test('self edit locks role + active and the PUT omits them', async ({ page }) => {
    await openUsers(page);
    const row = page.getByRole('grid', { name: 'Users' }).getByRole('row').filter({ hasText: 'dev@local' });
    await row.getByRole('button', { name: /^Edit / }).click();
    const dialog = page.getByRole('dialog', { name: /^Edit / });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-self-note]')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Active' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: /Role/ })).toBeDisabled();
    await expect(dialog.locator('[data-password-section]')).toHaveCount(0);

    const reqPromise = page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes('/v1/admin/users/'));
    await dialog.locator('[data-edit-user-save]').click();
    const body = (await reqPromise).postDataJSON() as Record<string, unknown>;
    expect(body).toHaveProperty('email', 'dev@local');
    expect(body).not.toHaveProperty('role');
    expect(body).not.toHaveProperty('is_active');
    await expect(page.getByText('User updated')).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test('editing another user changes their role', async ({ page, request }) => {
    const u = await createUser(request, uniq('role'), 'Role Change');
    await openUsers(page);
    const row = page.getByRole('grid', { name: 'Users' }).getByRole('row').filter({ hasText: u.email });
    await row.getByRole('button', { name: /^Edit / }).click();
    const dialog = page.getByRole('dialog', { name: /^Edit / });
    await dialog.getByRole('button', { name: /Role/ }).click();
    await page.getByRole('option', { name: 'Admin' }).click();
    const reqPromise = page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes(`/v1/admin/users/${u.id}`));
    await dialog.locator('[data-edit-user-save]').click();
    const body = (await reqPromise).postDataJSON() as Record<string, unknown>;
    expect(body.role).toBe('ADMIN');
    await expect(row).toContainText('admin');
    // dev@local is also admin so demoting again is allowed: restore
    expect((await request.put(`/v1/admin/users/${u.id}`, { data: { role: 'MEMBER' } })).ok()).toBeTruthy();
  });

  test('a server 409/400 from the PUT is shown inline in the dialog', async ({ page, request }) => {
    const u = await createUser(request, uniq('err'), 'Err User');
    await openUsers(page);
    await page.route(`**/v1/admin/users/${u.id}`, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'Cannot remove the last admin' }) })
        : route.continue(),
    );
    const row = page.getByRole('grid', { name: 'Users' }).getByRole('row').filter({ hasText: u.email });
    await row.getByRole('button', { name: /^Edit / }).click();
    const dialog = page.getByRole('dialog', { name: /^Edit / });
    await dialog.locator('[data-edit-user-save]').click();
    await expect(dialog.locator('[data-edit-user-error]')).toHaveText('Cannot remove the last admin');
    await expect(dialog).toBeVisible();
  });
});

test('own-row Disable tooltip shows on its focusable trigger', async ({ page }) => {
  await gotoApp(page, '/admin/users');
  const wrap = page.locator('[data-user-self-disable-wrap]');
  await expect(wrap).toHaveAttribute('tabindex', '0');
  await wrap.hover();
  await page.mouse.move(5, 5);
  await wrap.hover();
  await expect(page.getByRole('tooltip')).toContainText('cannot disable your own account');
});
