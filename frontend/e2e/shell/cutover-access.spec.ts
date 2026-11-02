/// <reference lib="dom" />
/**
 * Cutover of the role-dependent project settings checks from test_access_admin_browser.py
 * (C075/C078): only admins see the rename field, only people who can add members search
 * the candidate list, and nobody loads the user directory from Project Settings.
 * The server side of each rule is covered in tests/platform/test_access_admin_p1.py; here
 * the caller's role is set by answering GET /v1/me, which is what the client reads.
 */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';

async function actAs(page: Page, role: 'MEMBER' | 'MANAGER'): Promise<string[]> {
  await page.route(/\/v1\/me$/, async (route) => {
    const res = await route.fetch();
    const me = (await res.json()) as { role: string; projects: { role: string }[] };
    me.role = 'MEMBER';
    me.projects = me.projects.map((p) => ({ ...p, role }));
    await route.fulfill({ response: res, json: me });
  });
  const seen: string[] = [];
  page.on('request', (r) => seen.push(new URL(r.url()).pathname + new URL(r.url()).search));
  return seen;
}

test.describe('project settings by role', () => {
  test('a plain member sees no rename field, no add-member bar and never loads the user directory', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Access Member', uniqueSlug('acc-mem'));
    const seen = await actAs(page, 'MEMBER');
    await gotoApp(page, `/projects/${p.slug}/settings`);
    await expect(page.locator('[data-settings-page]')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Members/ }).click();
    await expect(
      page.getByRole('grid', { name: 'Members' }).or(page.getByRole('table', { name: 'Members' })),
    ).toBeVisible();
    await expect(page.locator('[data-add-member]')).toHaveCount(0);
    expect(seen.filter((u) => u.startsWith('/v1/users') || u.includes('member-candidates'))).toEqual([]);
  });

  test('a manager cannot rename but adds a member from the candidate search, never from the user directory', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Access Manager', uniqueSlug('acc-mgr'));
    const seen = await actAs(page, 'MANAGER');
    await gotoApp(page, `/projects/${p.slug}/settings`);
    await expect(page.locator('[data-settings-page]')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Members/ }).click();
    const combo = page.locator('[data-add-member]').getByRole('combobox', { name: 'Add member' });
    await expect(combo).toBeVisible();
    await combo.fill('dev');
    await expect
      .poll(() => seen.some((u) => u.includes(`/v1/projects/${p.id}/member-candidates`)))
      .toBe(true);
    expect(seen.filter((u) => u.startsWith('/v1/users'))).toEqual([]);
  });
});
