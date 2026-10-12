/** Cutover: the Profile page offers the bootstrap-admin panel from the /v1/me flag. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';

test.describe('profile bootstrap-admin panel', () => {
  test('shows for a non-admin whose /v1/me allows bootstrapping and posts the token', async ({ page }) => {
    await page.route('**/v1/me', async (route) => {
      const res = await route.fetch();
      const me = await res.json();
      await route.fulfill({ response: res, json: { ...me, role: 'MEMBER', can_bootstrap_admin: true } });
    });
    const posted: unknown[] = [];
    await page.route('**/v1/auth/bootstrap-admin', async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 409, json: { detail: 'An admin already exists.' } });
    });
    await gotoApp(page, '/profile');
    const panel = page.locator('[data-bootstrap-admin]');
    await expect(panel).toBeVisible();
    await panel.getByPlaceholder('Bootstrap token').fill('e2e-token');
    await panel.getByRole('button').click();
    await expect(panel.getByRole('alert')).toHaveText('An admin already exists.');
    expect(posted).toEqual([{ bootstrap_token: 'e2e-token' }]);
  });

  test('is absent when /v1/me does not allow bootstrapping', async ({ page }) => {
    await page.route('**/v1/me', async (route) => {
      const res = await route.fetch();
      const me = await res.json();
      await route.fulfill({ response: res, json: { ...me, role: 'MEMBER', can_bootstrap_admin: false } });
    });
    await gotoApp(page, '/profile');
    await expect(page.locator('[data-profile-page]')).toBeVisible();
    await expect(page.locator('[data-bootstrap-admin]')).toHaveCount(0);
  });
});
