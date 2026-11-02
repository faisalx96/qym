/** UX review D: the "forked from vN" link in the dataset header must not be colour-only (axe link-in-text-block at 768). */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { bulkItems, createDataset, createVersion, publishVersion, sampleItems } from './support';

test('forked-from link is distinguishable at 768', async ({ page, request }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const p = await createProject(request, 'UX Fork', uniqueSlug('uxfork'));
  const d = await createDataset(request, p.slug, 'fork-ds');
  const v1 = await createVersion(request, p.slug, d.slug);
  await bulkItems(request, p.slug, d.slug, v1.version, sampleItems(3));
  await publishVersion(request, p.slug, d.slug, v1.version, true);
  await createVersion(request, p.slug, d.slug, { from_version: 'v1' });
  await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v2`);
  const link = page.getByRole('link', { name: 'v1', exact: true }).first();
  await expect(link).toBeVisible();
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
  const v = await axeSeriousViolations(page);
  expect(v, describeViolations(v)).toEqual([]);
});
