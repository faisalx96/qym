/// <reference lib="dom" />
/**
 * Cutover: the sign-in and change-password forms keep what the user typed after
 * an error (was tests/platform/test_login_form_browser.py). Needs session auth:
 *
 *   QYM_ADMIN_BOOTSTRAP_TOKEN=e2e-bootstrap QYM_E2E_AUTH_MODE=proxy_headers npm run e2e -- e2e/shell/cutover-login-form.spec.ts
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';

const PROXY_MODE = process.env.QYM_E2E_AUTH_MODE === 'proxy_headers';
const BOOTSTRAP_TOKEN = process.env.QYM_ADMIN_BOOTSTRAP_TOKEN ?? '';

async function withSessionBootstrap(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    (window as unknown as { __QYM_APP__: unknown }).__QYM_APP__ = {
      rootPath: '',
      authMode: 'proxy_headers',
      sessionAuth: true,
      environment: 'test',
    };
  });
}

test.describe('login forms keep what was typed (session auth)', () => {
  test.skip(!PROXY_MODE, 'needs QYM_E2E_AUTH_MODE=proxy_headers');
  test.skip(PROXY_MODE && !BOOTSTRAP_TOKEN, 'needs QYM_ADMIN_BOOTSTRAP_TOKEN');

  let admin: APIRequestContext;
  test.beforeAll(async ({ playwright, baseURL }) => {
    const email = `${uniqueSlug('lfadmin')}@e2e.local`;
    admin = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-User-Email': email, Origin: baseURL ?? '' },
    });
    const res = await admin.post('/v1/auth/bootstrap-admin', { data: { bootstrap_token: BOOTSTRAP_TOKEN } });
    expect(res.ok(), await res.text()).toBeTruthy();
  });
  test.afterAll(async () => {
    await admin?.dispose();
  });

  async function userWithTemporaryPassword() {
    const email = `${uniqueSlug('lf')}@e2e.local`;
    const created = await admin.post('/v1/admin/users', { data: { email, display_name: 'Login Form' } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };
    const reset = await admin.post(`/v1/admin/users/${id}/reset-password`);
    const { temporary_password: temp } = (await reset.json()) as { temporary_password: string };
    return { email, temp };
  }

  test('a wrong password keeps the email, empties the password and puts focus back on it', async ({
    browser,
  }) => {
    const { email, temp } = await userWithTemporaryPassword();
    const context = await browser.newContext();
    await withSessionBootstrap(context);
    const page = await context.newPage();
    await gotoApp(page, '/login');
    const form = page.locator('[data-password-form]');
    await form.getByRole('textbox', { name: /^Email/ }).pressSequentially(email);
    await form.getByLabel(/^Password/).pressSequentially(`${temp}-wrong`);
    await form.getByRole('button', { name: 'Sign in' }).click();
    await expect(form.getByRole('alert')).toContainText('Invalid');
    await expect(form.getByRole('textbox', { name: /^Email/ })).toHaveValue(email);
    await expect(form.getByLabel(/^Password/)).toHaveValue('');
    await expect(form.getByLabel(/^Password/)).toBeFocused();
    await context.close();
  });

  test('change-password errors keep the new password and send no request for a refused one', async ({
    browser,
  }) => {
    const { email, temp } = await userWithTemporaryPassword();
    const context = await browser.newContext();
    await withSessionBootstrap(context);
    const page = await context.newPage();
    const changes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/v1/auth/password/change')) changes.push(r.url());
    });
    await gotoApp(page, '/login');
    const login = page.locator('[data-password-form]');
    await login.getByRole('textbox', { name: /^Email/ }).fill(email);
    await login.getByLabel(/^Password/).fill(temp);
    await login.getByRole('button', { name: 'Sign in' }).click();
    const change = page.locator('[data-change-password-form]');
    await expect(change.getByLabel(/^New password/)).toBeFocused();

    await change.getByLabel(/^New password/).fill('brand-new-pass-1');
    await change.getByLabel(/^Confirm new password/).fill('brand-new-pass-2');
    await change.getByRole('button', { name: 'Change password and sign in' }).click();
    await expect(change.getByRole('alert')).toHaveText('The passwords do not match.');
    await expect(change.getByLabel(/^New password/)).toHaveValue('brand-new-pass-1');

    await change.getByLabel(/^New password/).fill(temp);
    await change.getByLabel(/^Confirm new password/).fill(temp);
    await change.getByRole('button', { name: 'Change password and sign in' }).click();
    await expect(change.getByRole('alert')).toHaveText('Choose a password different from the temporary one.');
    expect(changes, 'refused before any request').toEqual([]);
    await context.close();
  });
});
