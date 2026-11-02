/** Brief 01 J5: /profile. */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, trackPageLoads, uniqueSlug } from '../helpers';

test.describe('profile (J5)', () => {
  test('account grid, projects table with a project link and Open/Settings row actions, no bootstrap panel for an admin', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Profile Project', uniqueSlug('profile'));
    await gotoApp(page, '/profile');
    await expect(page.locator('[data-profile-page]')).toBeVisible();
    await expect(page).toHaveTitle(/Profile/);
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]'),
    ).toHaveText('Profile');
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Projects' }),
    ).toBeVisible();
    const account = page.locator('[data-profile-page]').getByLabel('Account');
    await expect(account).toContainText('dev@local');
    await expect(account).toContainText('Dev User');
    await expect(account).toContainText('ADMIN');
    await expect(page.locator('[data-bootstrap-admin]')).toHaveCount(0);

    const row = page.getByRole('row').filter({ hasText: p.slug });
    await expect(row).toBeVisible();
    await expect(row.getByRole('link', { name: 'Profile Project' })).toHaveAttribute(
      'href',
      new RegExp(`/projects/${p.slug}$`),
    );
    const loads = trackPageLoads(page);
    await expect(row.getByRole('button', { name: /^Open / })).toBeVisible();
    await row.getByRole('button', { name: /^Settings for / }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${p.slug}/settings$`));
    await expect(page.locator('[data-settings-page]')).toBeVisible();
    expect(loads.count()).toBe(0);
  });

  test('breadcrumb "Projects" link goes home from the profile', async ({ page }) => {
    await gotoApp(page, '/profile');
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Projects' })
      .click();
    await expect(page).toHaveURL(/\/?$/);
    await expect(page.locator('[data-projects-page]')).toBeVisible();
  });
});
