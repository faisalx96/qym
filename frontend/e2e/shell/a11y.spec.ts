/** axe-core (serious + critical must be zero) on the shell surfaces. */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { axeSeriousViolations, describeViolations } from './support';

test.describe('axe', () => {
  test('projects landing', async ({ page, request }) => {
    await createProject(request, 'Axe Landing', uniqueSlug('axe'));
    await gotoApp(page, '/');
    await expect(page.locator('[data-projects-page]')).toBeVisible();
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test('projects landing with the switcher open and the user menu open', async ({ page, request }) => {
    const p = await createProject(request, 'Axe Chrome', uniqueSlug('axechrome'));
    await gotoApp(page, `/projects/${p.slug}`);
    await page.locator('[data-project-switcher]').click();
    await expect(page.getByRole('dialog', { name: 'Switch project' })).toBeVisible();
    let v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.locator('[data-user-menu]').click();
    await expect(page.getByRole('menu')).toBeVisible();
    v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test('project settings (general, members, api keys, danger)', async ({ page, request }) => {
    const p = await createProject(request, 'Axe Settings', uniqueSlug('axeset'));
    for (const t of ['general', 'members', 'apikeys', 'llm', 'prompts', 'danger']) {
      await gotoApp(page, `/projects/${p.slug}/settings?tab=${t}`);
      await expect(page.locator('[data-settings-page]')).toBeVisible();
      await expect(page.getByRole('tabpanel').first()).toBeVisible();
      const v = await axeSeriousViolations(page);
      expect(v, `${t}\n${describeViolations(v)}`).toEqual([]);
    }
  });

  test('archived project page (banner + read-only tag)', async ({ page, request }) => {
    const p = await createProject(request, 'Axe Archived', uniqueSlug('axearch'));
    const res = await request.post(`/v1/admin/projects/${p.id}/archive`);
    expect(res.ok()).toBeTruthy();
    await gotoApp(page, `/projects/${p.slug}/settings`);
    await expect(page.locator('[data-archived-banner]')).toBeVisible();
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test('login page (/login)', async ({ page }) => {
    await gotoApp(page, '/login');
    await expect(page.locator('[data-login-page]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in to qym' })).toBeVisible();
    // auth mode none: no methods, "Open qym" shortcut
    await expect(page.getByText('No login methods are configured')).toBeVisible();
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test('UI gallery (/__ui)', async ({ page }) => {
    test.setTimeout(90_000);
    await gotoApp(page, '/__ui');
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForLoadState('networkidle');
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });
});
