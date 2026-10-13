/**
 * Dataset items table on DataTable v2: column menu, density, bulk bar with "select all matching",
 * and the stacked card layout at phone width.
 */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, sampleItems } from './support';

async function seedDraft(request: Parameters<typeof createProject>[0], n: number) {
  const p = await createProject(request, 'Items v2', uniqueSlug('itv2'));
  const d = await createDataset(request, p.slug, 'Items v2 DS');
  const v = await createVersion(request, p.slug, d.slug);
  await bulkItems(request, p.slug, d.slug, v.version, sampleItems(n));
  return { p, d };
}

test.describe('items table (DataTable v2)', () => {
  test('Columns menu shows a hidden column and hides it again; Edits starts hidden', async ({
    page,
    request,
  }) => {
    const { p, d } = await seedDraft(request, 4);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    const grid = page.getByRole('grid', { name: /Items in v1/ });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: /Edits/ })).toHaveCount(0);

    await page.getByRole('button', { name: /^Columns/ }).click();
    const menu = page.getByRole('dialog', { name: 'Columns' });
    await menu.getByText('Edits', { exact: true }).click();
    await expect(grid.getByRole('columnheader', { name: /Edits/ })).toHaveCount(1);
    await menu.getByText('Edits', { exact: true }).click();
    await expect(grid.getByRole('columnheader', { name: /Edits/ })).toHaveCount(0);
  });

  test('header checkbox offers "Select all N items" and the bar shows the full count', async ({
    page,
    request,
  }) => {
    const { p, d } = await seedDraft(request, 60);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?size=25`);
    await expect(page.locator('[data-item-link]')).toHaveCount(25);
    await page
      .locator('label')
      .filter({ has: page.getByRole('checkbox', { name: 'Select all rows' }) })
      .click();
    await page.getByRole('button', { name: 'Select all 60 items' }).click();
    const bar = page.getByRole('region', { name: 'Selection actions' });
    await expect(bar).toContainText('60 selected');
    await expect(bar.getByTestId('bulk-delete-items')).toHaveText('Delete 60');
    await bar.getByRole('button', { name: 'Clear selection' }).click();
    await expect(bar).toHaveCount(0);
  });

  test('at 390px rows become cards that still open the item', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { p, d } = await seedDraft(request, 3);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await expect(page.getByRole('grid', { name: /Items in v1/ })).toHaveCount(0);
    const cards = page.getByRole('list', { name: /Items in v1/ }).getByRole('listitem');
    await expect(cards).toHaveCount(3);
    await expect(cards.first().locator('[data-item-link]')).toBeVisible();
    await cards.first().locator('[data-item-link]').click();
    await expect(page).toHaveURL(/item=/);
  });
});
