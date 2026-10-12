/// <reference lib="dom" />
/**
 * Cutover: the member-removal dialog offers to transfer the member's runs in the
 * same request as the removal (was tests/platform/test_p1b_member_removal_browser.py).
 * Removing without a transfer keeps the runs; Escape sends nothing.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { seedReviews } from '../reviews/support';
import { addMember, createUser } from './support';

async function setup(request: APIRequestContext) {
  const tag = uniqueSlug('rm');
  const seed = await seedReviews(request, tag, 1);
  const dana = await createUser(request, `dana-${tag}@e2e.local`, `Dana ${tag}`);
  const sam = await createUser(request, `sam-${tag}@e2e.local`, `Sam ${tag}`);
  await addMember(request, seed.project.id, dana.id);
  await addMember(request, seed.project.id, sam.id);
  const res = await request.post(`/v1/runs/${seed.run.id}/owner`, { data: { user_id: dana.id } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { seed, dana, sam, tag };
}

async function openRemoval(page: Page, slug: string, email: string) {
  await page.goto(`/projects/${slug}/settings?tab=members`);
  const row = page.getByRole('row').filter({ hasText: email });
  await row.getByRole('button', { name: 'Remove' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog.getByText('They own 1 run here.')).toBeVisible();
  return { dialog, row };
}

test.describe('member removal with a run transfer', () => {
  test('choosing a member transfers their runs in the removal request', async ({ page, request }) => {
    const { seed, dana, sam, tag } = await setup(request);
    const { dialog, row } = await openRemoval(page, seed.project.slug, dana.email);
    await dialog.getByRole('button', { name: 'Transfer their runs to' }).click();
    const options = page.getByRole('option');
    await expect(options.filter({ hasText: 'Keep the runs (no transfer)' })).toBeVisible();
    // only other active members can take the runs; the removed member is not offered
    await expect(options.filter({ hasText: `Dana ${tag}` })).toHaveCount(0);
    await options.filter({ hasText: `Sam ${tag}` }).click();
    const removal = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().includes('/members/'));
    await dialog.getByRole('button', { name: 'Remove member' }).click();
    expect((await removal).url()).toContain(`/members/${dana.id}?transfer_runs_to=${sam.id}`);
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
    // the runs moved to Sam: his removal preview now counts them
    const preview = await request.get(`/v1/projects/${seed.project.id}/members/${sam.id}/removal-preview`);
    expect((await preview.json()).owned_runs).toBe(1);
  });

  test('Escape sends nothing; removing without a transfer keeps the runs with the member row gone', async ({
    page,
    request,
  }) => {
    const { seed, dana } = await setup(request);
    const deletes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'DELETE') deletes.push(r.url());
    });
    const { dialog, row } = await openRemoval(page, seed.project.slug, dana.email);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(deletes).toEqual([]);
    await row.getByRole('button', { name: 'Remove' }).click();
    const removal = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().includes('/members/'));
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove member' }).click();
    expect(new URL((await removal).url()).search).toBe('');
    await expect(row).toHaveCount(0);
  });
});
