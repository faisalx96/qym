/**
 * A lazy route whose chunk fails to load (stale bundle after a deploy) reloads the page once instead of showing
 * "Something went wrong". The dev server has no preload helper, so the failure is produced by aborting the first
 * request for the compare page's module; the reload fetches it again and the page renders.
 */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, trackPageLoads, uniqueSlug } from '../helpers';
import { createDataset } from './support';

test('a missing route chunk reloads the page once and then renders', async ({ page, request }) => {
  const p = await createProject(request, uniqueSlug('chunk'));
  const ds = await createDataset(request, p.slug, 'Chunk recovery');
  let aborted = 0;
  await page.route('**/DatasetComparePage*', (route) => {
    if (aborted === 0) {
      aborted += 1;
      return route.abort('failed');
    }
    return route.continue();
  });
  const loads = trackPageLoads(page);
  await gotoApp(page, `/projects/${p.slug}/datasets/${ds.slug}/compare`);
  await expect(page.getByRole('heading', { name: 'Compare versions' })).toBeVisible({ timeout: 20_000 });
  expect(aborted).toBe(1);
  expect(loads.count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});
