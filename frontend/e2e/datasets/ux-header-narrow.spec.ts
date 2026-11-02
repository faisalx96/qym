/** UX review D: at phone width the dataset header actions must not overlap the title. */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, publishVersion, sampleItems } from './support';

test('dataset header: version switcher sits below the title at 390', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const p = await createProject(request, 'UX Hdr', uniqueSlug('uxhdr'));
  const d = await createDataset(request, p.slug, 'a-rather-long-dataset-name');
  const v1 = await createVersion(request, p.slug, d.slug);
  await bulkItems(request, p.slug, d.slug, v1.version, sampleItems(3));
  await publishVersion(request, p.slug, d.slug, v1.version, true);
  await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
  const title = page.getByRole('heading', { level: 1 });
  const switcher = page.getByTestId('version-switcher');
  await expect(switcher).toBeVisible();
  const t = (await title.boundingBox())!;
  const s = (await switcher.boundingBox())!;
  expect(s.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
});
