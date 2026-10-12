/// <reference lib="dom" />
/** Admin shell, tabs and Runs tab (brief 09 §2, §8.2). */
import { test, expect } from '@playwright/test';
import { createApiKey, createProject, createRun, gotoApp, uniqueSlug } from '../helpers';

test.describe('admin tabs', () => {
  test('/admin redirects to /admin/runs; tab clicks change the URL; back button restores', async ({ page }) => {
    await gotoApp(page, '/admin');
    await expect(page).toHaveURL(/\/app\/admin\/runs$/);
    await expect(page.getByRole('tab', { name: /^Runs/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /^Users/ }).click();
    await expect(page).toHaveURL(/\/app\/admin\/users$/);
    await expect(page.getByRole('tab', { name: /^Users/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /^Projects/ }).click();
    await expect(page).toHaveURL(/\/app\/admin\/projects$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/admin\/users$/);
    await expect(page.getByRole('tab', { name: /^Users/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-create-user]')).toBeVisible();
  });

  test('deep link /admin/users opens the Users tab; unknown tab falls back to runs', async ({ page }) => {
    await gotoApp(page, '/admin/users');
    await expect(page.getByRole('tab', { name: /^Users/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-create-user]')).toBeVisible();
    await gotoApp(page, '/admin/nope');
    await expect(page).toHaveURL(/\/app\/admin\/runs$/);
  });

  test('member forbidden state is not reachable under auth none', async () => {
    test.skip(true, 'QYM_AUTH_MODE=none makes every request ADMIN; see admin/proxy.spec.ts for the member case');
  });
});

test.describe('force stop', () => {
  test('confirm dialog, exactly one POST, row leaves Live and appears as STOPPED in Recent', async ({ page, request }) => {
    const project = await createProject(request, 'Force Stop', uniqueSlug('fstop'));
    const token = await createApiKey(request, project.id);
    const run = await createRun(request, token, { name: uniqueSlug('live'), finish: false });
    const name = run.run_id.slice(0, 8); // the label shown when a run has no name

    const posts: string[] = [];
    let liveGets = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/force-stop')) posts.push(r.url());
      if (r.method() === 'GET' && r.url().includes('/api/runs/live')) liveGets++;
    });

    await gotoApp(page, '/admin/runs');
    const live = page.getByRole('grid', { name: 'Live runs' });
    const stopBtn = page.locator(`[data-force-stop="${run.run_id}"]`);
    await expect(stopBtn).toBeVisible();
    await expect(live).toContainText(name);

    // Cancel first: no request.
    await stopBtn.click();
    const dialog = page.getByRole('alertdialog', { name: 'Force stop run' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(posts).toHaveLength(0);

    await stopBtn.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(name);
    await dialog.getByRole('button', { name: 'Force stop' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.locator(`[data-force-stop="${run.run_id}"]`)).toHaveCount(0);
    await expect(live).not.toContainText(name);
    await expect(page.getByText(/was force stopped/).first()).toBeVisible();
    await expect(page.locator('[data-status-line]')).toContainText('force stopped');

    // Recent shows the run as STOPPED, and offers no Force stop.
    const recent = page.getByRole('grid', { name: 'Recent runs' });
    const row = recent.getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(/stopped/i);
    await expect(row.getByRole('button', { name: /Force stop/ })).toHaveCount(0);

    // The poll must not overlap/repeat the mutation: still one POST and a bounded number of live refetches.
    const before = liveGets;
    await page.waitForTimeout(2500);
    expect(posts).toHaveLength(1);
    expect(liveGets - before).toBeLessThanOrEqual(1);
    // still gone after the refetches settle
    await expect(live).not.toContainText(name);
  });
});
