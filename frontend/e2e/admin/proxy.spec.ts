/// <reference lib="dom" />
/**
 * Session-auth admin journeys (brief 09 §8.1 member forbidden, §8.5 reset password).
 * Need the platform started with local password auth:
 *
 *   QYM_E2E_AUTH_MODE=proxy_headers QYM_PLATFORM_PORT=8807 QYM_VITE_PORT=5807 \
 *     npx playwright test e2e/admin/proxy.spec.ts
 *
 * Run it on its own (a fresh DB): it claims the first admin through sign-up +
 * bootstrap-admin, which e2e/shell/auth.spec.ts also does.
 * Skipped under QYM_AUTH_MODE=none: every caller is ADMIN and local auth is off.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';

const PROXY_MODE = process.env.QYM_E2E_AUTH_MODE === 'proxy_headers';
const BOOTSTRAP_TOKEN = process.env.QYM_ADMIN_BOOTSTRAP_TOKEN ?? '';
const PASSWORD = 'E2e-Strong-Passw0rd!';

async function withSessionBootstrap(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    (window as unknown as { __QYM_APP__: unknown }).__QYM_APP__ = {
      rootPath: '',
      authMode: 'proxy_headers',
      sessionAuth: true,
      environment: 'test',
    };
  });
}

test.describe('session auth admin', () => {
  test.skip(!PROXY_MODE, 'needs QYM_E2E_AUTH_MODE=proxy_headers (local password auth)');
  test.skip(PROXY_MODE && !BOOTSTRAP_TOKEN, 'needs QYM_ADMIN_BOOTSTRAP_TOKEN');
  test.describe.configure({ mode: 'serial' });

  const adminEmail = `${uniqueSlug('padmin')}@e2e.local`;
  let admin: APIRequestContext;

  test.beforeAll(async ({ playwright, baseURL }) => {
    admin = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-User-Email': adminEmail, Origin: baseURL ?? '' },
    });
  });
  test.afterAll(async () => {
    await admin?.dispose();
  });

  async function signUpAdmin(page: Page, baseURL: string | undefined) {
    await withSessionBootstrap(page);
    await gotoApp(page, '/login');
    await page.locator('[data-signup-toggle]').click();
    const signup = page.locator('[data-signup-form]');
    await signup.getByRole('textbox', { name: /^Display name/ }).fill('Proxy Admin');
    await signup.getByRole('textbox', { name: /^Email/ }).fill(adminEmail);
    await signup.getByLabel(/^Password/).fill(PASSWORD);
    await signup.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    const res = await page.request.post('/v1/auth/bootstrap-admin', {
      data: { bootstrap_token: BOOTSTRAP_TOKEN },
      headers: { Origin: baseURL ?? '' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  test('reset password: locks while pending, shows the one-time password, clears on close', async ({ page, baseURL }) => {
    await signUpAdmin(page, baseURL);
    const email = `${uniqueSlug('victim')}@e2e.local`;
    const created = await admin.post('/v1/admin/users', { data: { email, display_name: 'Reset Victim' } });
    expect(created.ok(), await created.text()).toBeTruthy();

    // Slow the reset so the pending lock is observable.
    await page.route('**/reset-password', async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await gotoApp(page, '/admin/users');
    const row = page.getByRole('grid', { name: 'Users' }).getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: /^Edit / }).click();
    const dialog = page.getByRole('dialog', { name: /^Edit / });
    await expect(dialog.locator('[data-password-section]')).toBeVisible();
    await dialog.locator('[data-reset-password]').click();
    const confirm = page.getByRole('alertdialog', { name: 'Reset password' });
    await confirm.getByRole('button', { name: 'Reset password' }).click();
    // pending: save/cancel are locked
    await expect(dialog.locator('[data-edit-user-save]')).toBeDisabled();
    await expect(dialog.locator('[data-edit-user-cancel]')).toBeDisabled();
    const temp = dialog.locator('[data-secret]');
    await expect(temp).toBeVisible();
    const value = await temp.inputValue();
    expect(value.length).toBeGreaterThanOrEqual(8);
    await dialog.locator('[data-edit-user-cancel]').click();
    await expect(dialog).toHaveCount(0);
    // reopening shows no secret
    await row.getByRole('button', { name: /^Edit / }).click();
    await expect(page.getByRole('dialog', { name: /^Edit / }).locator('[data-secret]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(value);
  });

  test('a member sees the forbidden state at /admin and no Admin link', async ({ browser, playwright, baseURL }) => {
    const email = `${uniqueSlug('plain')}@e2e.local`;
    const created = await admin.post('/v1/admin/users', { data: { email, display_name: 'Plain Member' } });
    const { id } = (await created.json()) as { id: string };
    const { temporary_password: temp } = (await (await admin.post(`/v1/admin/users/${id}/reset-password`)).json()) as {
      temporary_password: string;
    };
    const anon = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL ?? '' } });
    const changed = await anon.post('/v1/auth/password/change', {
      data: { email, current_password: temp, new_password: PASSWORD },
    });
    expect(changed.ok(), await changed.text()).toBeTruthy();
    await anon.dispose();

    const context = await browser.newContext();
    const page = await context.newPage();
    await withSessionBootstrap(page);
    await gotoApp(page, '/login?next=%2Fapp%2Fadmin');
    const form = page.locator('[data-password-form]');
    await form.getByRole('textbox', { name: /^Email/ }).fill(email);
    await form.getByLabel(/^Password/).fill(PASSWORD);
    await form.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('[data-admin-forbidden]')).toBeVisible();
    await expect(page.getByText('Admin access required')).toBeVisible();
    await expect(page.locator('[data-app-shell]').getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
    await context.close();
  });
});
