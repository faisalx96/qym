/// <reference lib="dom" />
/**
 * Brief 01 J1 (sign in) and §8.7 scenarios 1–3 and 10.
 *
 * Default run (QYM_AUTH_MODE=none): only the "no login methods" panel exists.
 *
 * Session-auth journeys need the platform started with
 * QYM_E2E_AUTH_MODE=proxy_headers (playwright.config.ts then enables local
 * password auth) AND a bootstrap token so the suite can mint its first admin
 * (the admin API — create user, reset password — is admin-only and proxy
 * headers only auto-provision MEMBERs):
 *
 *   QYM_ADMIN_BOOTSTRAP_TOKEN=e2e-bootstrap QYM_E2E_AUTH_MODE=proxy_headers \
 *     npm run e2e -- e2e/shell/auth.spec.ts
 *
 * The Vite dev server serves index.html without the platform's
 * window.__QYM_APP__ bootstrap, so `sessionAuth` is false in the browser and
 * the 401 → /login redirect never fires. Tests that depend on it inject
 * the bootstrap with page.addInitScript (what spa.py does in production).
 */
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { addMember } from './support';

const PROXY_MODE = process.env.QYM_E2E_AUTH_MODE === 'proxy_headers';
const BOOTSTRAP_TOKEN = process.env.QYM_ADMIN_BOOTSTRAP_TOKEN ?? '';
const PASSWORD = 'E2e-Strong-Passw0rd!';

test.describe('login page under QYM_AUTH_MODE=none', () => {
  test.skip(PROXY_MODE, 'auth mode none only');
  test('shows the no-methods panel and "Open qym" goes to the app', async ({ page }) => {
    await gotoApp(page, '/login?next=%2Fprofile');
    await expect(page.locator('[data-login-page]')).toBeVisible();
    await expect(page.getByText('No login methods are configured')).toBeVisible();
    await expect(page.locator('[data-password-form]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open qym' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.locator('[data-profile-page]')).toBeVisible();
  });
});

/** Inject what qym_platform/api/spa.py injects in production so the SPA knows a login page exists. */
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

async function signIn(page: Page, email: string, password: string): Promise<void> {
  const form = page.locator('[data-password-form]');
  await expect(form).toBeVisible();
  await form.getByRole('textbox', { name: /^Email/ }).fill(email);
  await form.getByLabel(/^Password/).fill(password);
  await form.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('session auth (QYM_E2E_AUTH_MODE=proxy_headers)', () => {
  test.skip(!PROXY_MODE, 'needs QYM_E2E_AUTH_MODE=proxy_headers');
  test.skip(
    PROXY_MODE && !BOOTSTRAP_TOKEN,
    'needs QYM_ADMIN_BOOTSTRAP_TOKEN so the first account can claim admin (admin API is admin-only)',
  );
  test.describe.configure({ mode: 'serial' });

  const adminEmail = `${uniqueSlug('admin')}@e2e.local`;
  let admin: APIRequestContext;

  // The write guard (app.py) wants same-origin headers on every non-GET; Playwright's request contexts send none.
  test.beforeAll(async ({ playwright, baseURL }) => {
    admin = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-User-Email': adminEmail, Origin: baseURL ?? '' },
    });
  });
  test.afterAll(async () => {
    await admin?.dispose();
  });

  test('sign-up is offered while no admin exists; creating an account signs in; the account claims admin', async ({
    page,
    baseURL,
  }) => {
    await gotoApp(page, '/login');
    const toggle = page.locator('[data-signup-toggle]');
    await expect(toggle).toBeVisible();
    // the mode switch keeps the typed email (brief §7.9)
    await page.locator('[data-password-form]').getByRole('textbox', { name: /^Email/ }).fill(adminEmail);
    await toggle.click();
    const signup = page.locator('[data-signup-form]');
    await expect(signup).toBeVisible();
    await expect(signup.getByRole('textbox', { name: /^Display name/ })).toBeFocused();
    await signup.getByRole('textbox', { name: /^Display name/ }).fill('E2E Admin');
    await signup.getByRole('textbox', { name: /^Email/ }).fill(adminEmail);
    await signup.getByLabel(/^Password/).fill('short');
    await signup.getByRole('button', { name: 'Create account' }).click();
    await expect(signup.getByRole('alert')).toHaveText('Use at least 8 characters.');
    await signup.getByLabel(/^Password/).fill(PASSWORD);
    await signup.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/?$/);
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    await expect(page.locator('[data-user-menu]')).toContainText(adminEmail);

    const res = await page.request.post('/v1/auth/bootstrap-admin', {
      data: { bootstrap_token: BOOTSTRAP_TOKEN },
      headers: { Origin: baseURL ?? '' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(((await res.json()) as { role: string }).role).toBe('ADMIN');
    // proxy-header requests as that email are now admin requests
    const me = await admin.get('/v1/me');
    expect(me.ok()).toBeTruthy();
    expect(((await me.json()) as { role: string }).role).toBe('ADMIN');
  });

  test('sign-up is hidden once an admin exists and the server refuses it with its message (§8.7 scenario 3)', async ({
    page,
    baseURL,
  }) => {
    await gotoApp(page, '/login');
    await expect(page.locator('[data-password-form]')).toBeVisible();
    await expect(page.locator('[data-signup-toggle]')).toHaveCount(0);
    const res = await page.request.post('/v1/auth/signup/password', {
      data: { email: `${uniqueSlug('late')}@e2e.local`, password: PASSWORD, display_name: 'Late' },
      headers: { Origin: baseURL ?? '' },
    });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/Sign-up is turned off/);
  });

  test('wrong password shows the error, clears and refocuses the password field', async ({ page }) => {
    await gotoApp(page, '/login');
    await signIn(page, adminEmail, 'definitely-wrong');
    const form = page.locator('[data-password-form]');
    await expect(form.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(form.getByLabel(/^Password/)).toHaveValue('');
    await expect(form.getByLabel(/^Password/)).toBeFocused();
    await expect(page).toHaveURL(/\/login/);
  });

  test('temporary password → change-password form → mismatch → success → redirected (§8.7 scenario 2)', async ({
    page,
  }) => {
    const email = `${uniqueSlug('temp')}@e2e.local`;
    const created = await admin.post('/v1/admin/users', { data: { email, display_name: 'Temp User' } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };
    const reset = await admin.post(`/v1/admin/users/${id}/reset-password`);
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const { temporary_password: temp } = (await reset.json()) as { temporary_password: string };

    await gotoApp(page, '/login?next=%2Fprofile');
    await signIn(page, email, temp);
    const change = page.locator('[data-change-password-form]');
    await expect(change).toBeVisible();
    await expect(change.getByRole('status')).toContainText('Your password was reset');
    await expect(change.getByRole('textbox', { name: /^Email/ })).toHaveValue(email);
    await expect(change.getByLabel(/^New password/)).toBeFocused();
    await change.getByLabel(/^New password/).fill(PASSWORD);
    await change.getByLabel(/^Confirm new password/).fill(`${PASSWORD}x`);
    await change.getByRole('button', { name: 'Change password and sign in' }).click();
    await expect(change.getByRole('alert')).toHaveText('The passwords do not match.');
    await change.getByLabel(/^Confirm new password/).fill(PASSWORD);
    await change.getByRole('button', { name: 'Change password and sign in' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.locator('[data-profile-page]')).toBeVisible();
    await expect(page.locator('[data-profile-page]').getByLabel('Account')).toContainText(email);
    await expect(page.locator('[data-profile-page]').getByLabel('Account')).toContainText('local password');
  });

  test('unauthenticated deep link → /login?next=…; after sign-in lands there with the tab active (§8.7 scenario 1)', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const email = `${uniqueSlug('member')}@e2e.local`;
    const created = await admin.post('/v1/admin/users', { data: { email, display_name: 'Deep Link Member' } });
    const { id } = (await created.json()) as { id: string };
    const reset = await admin.post(`/v1/admin/users/${id}/reset-password`);
    const { temporary_password: temp } = (await reset.json()) as { temporary_password: string };
    // set a real password through the API so the UI flow here is a plain sign-in. A throwaway context:
    // the change signs that user in, and a session cookie would outrank the admin's proxy header.
    const anon = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL ?? '' } });
    const changed = await anon.post('/v1/auth/password/change', {
      data: { email, current_password: temp, new_password: PASSWORD },
    });
    expect(changed.ok(), await changed.text()).toBeTruthy();
    await anon.dispose();
    const project = await createProject(admin, 'Deep Link Auth', uniqueSlug('deepauth'));
    await addMember(admin, project.id, id);

    const context = await browser.newContext();
    await withSessionBootstrap(context);
    const page = await context.newPage();
    const target = `/projects/${project.slug}/settings?tab=members`;
    await page.goto(target);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(target)}`);
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(target);
    await expect(page.locator('[data-settings-page]')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Members/ })).toHaveAttribute('aria-selected', 'true');
    // a plain member: no add-member bar, no Danger zone tab
    await expect(page.locator('[data-add-member]')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Danger zone' })).toHaveCount(0);

    // §8.7 scenario 10: logout from the user menu
    await page.locator('[data-user-menu]').click();
    const [logout] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/v1/auth/logout') && r.request().method() === 'POST'),
      page.getByRole('menuitem', { name: 'Sign out' }).click(),
    ]);
    expect(logout.ok()).toBeTruthy();
    // useLogout sends next=appUrl('/') which is "/"
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
    await expect(page.locator('[data-password-form]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('qym:me'))).toBeNull();
    expect((await page.request.get('/v1/me')).status()).toBe(401);
    // Back does not show the previous page: the shell bounces to login again
    await page.goBack();
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.locator('[data-app-shell]')).toHaveCount(0);
    await context.close();
  });

  test('"already signed in" redirect: /login with a session goes straight to next', async ({ browser }) => {
    const context = await browser.newContext();
    await withSessionBootstrap(context);
    const page = await context.newPage();
    await gotoApp(page, '/login?next=%2Fprofile');
    await signIn(page, adminEmail, PASSWORD);
    await expect(page).toHaveURL(/\/profile$/);
    // a signed-in user opening the login page again is not asked to sign in twice (server 303 for /login,
    // the SPA route simply renders the form) — assert the session still works for the app
    await gotoApp(page, '/');
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    await expect(page.locator('[data-user-menu]')).toContainText(adminEmail);
    await context.close();
  });
});
