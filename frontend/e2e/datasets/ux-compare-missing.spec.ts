/** UX review D: comparing versions of a dataset that does not exist must end in an error, not a skeleton. */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';

test('compare page for a missing dataset shows the error state', async ({ page, request }) => {
  const p = await createProject(request, 'UX Cmp Missing', uniqueSlug('uxcmp'));
  // a slow answer lets the loading skeleton appear first (it only shows after 300 ms)
  await page.route('**/v1/datasets/nope-ds?**', async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });
  await gotoApp(page, `/projects/${p.slug}/datasets/nope-ds/compare`);
  await expect(page.getByText('Couldn’t load this dataset')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
});
