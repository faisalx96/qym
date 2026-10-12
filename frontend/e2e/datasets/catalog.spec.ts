/**
 * Brief 07 §2.1-2.3: catalog browse/search/sort in the URL, blank create, deleted view.
 */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, publishVersion, sampleItems } from './support';
import { pickSelect, query } from './ui';

test.describe('catalog', () => {
  test('cards, search mirrored to ?q=, sort in ?sort=, both survive reload', async ({ page, request }) => {
    const p = await createProject(request, 'Catalog Browse', uniqueSlug('cat'));
    const zeta = await createDataset(request, p.slug, 'Zeta Dataset', { description: 'last one' });
    const alpha = await createDataset(request, p.slug, 'Alpha Dataset', { description: 'first one' });
    const v = await createVersion(request, p.slug, alpha.slug);
    await bulkItems(request, p.slug, alpha.slug, v.version, sampleItems(5));
    await publishVersion(request, p.slug, alpha.slug, v.version, true);

    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await expect(page).toHaveTitle(/Datasets/);
    await expect(page.locator(`[data-dataset-card=${alpha.slug}]`)).toContainText('5');
    await expect(page.locator(`[data-dataset-card=${zeta.slug}]`)).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search datasets' }).fill('alpha');
    await expect(page.locator(`[data-dataset-card=${zeta.slug}]`)).toHaveCount(0);
    await expect.poll(() => query(page).get('q')).toBe('alpha');
    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search datasets' })).toHaveValue('alpha');
    await expect(page.locator(`[data-dataset-card=${zeta.slug}]`)).toHaveCount(0);
    await expect(page.locator(`[data-dataset-card=${alpha.slug}]`)).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search datasets' }).fill('nothing-here-zzz');
    await expect(page.getByText('No datasets match')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).last().click();
    await expect(page.locator(`[data-dataset-card=${zeta.slug}]`)).toBeVisible();
    await expect.poll(() => query(page).get('q')).toBeNull();

    await pickSelect(page, /Sort/, 'Name A→Z');
    await expect.poll(() => query(page).get('sort')).toBe('name_asc');
    const order = page.locator('[data-dataset-card]');
    await expect(order.first()).toHaveAttribute('data-dataset-card', alpha.slug);
    await page.reload();
    await expect(order.first()).toHaveAttribute('data-dataset-card', alpha.slug);
    expect(query(page).get('sort')).toBe('name_asc');
  });

  test('card click opens the detail page in-app', async ({ page, request }) => {
    const p = await createProject(request, 'Catalog Open', uniqueSlug('catopen'));
    const d = await createDataset(request, p.slug, 'Open Me');
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await page.locator(`[data-dataset-card=${d.slug}]`).click();
    await expect(page).toHaveURL(new RegExp(`/datasets/${d.slug}`));
    await expect(page.locator(`[data-dataset-detail=${d.slug}]`)).toBeVisible();
  });

  test('empty project: first dataset created blank, lands on the detail with no versions', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Catalog Blank', uniqueSlug('catblank'));
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await expect(page.getByText('No datasets yet')).toBeVisible();
    await page.getByRole('button', { name: /Create your first dataset/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New dataset' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Support QA');
    await expect(dialog.getByRole('textbox', { name: /^Slug/ })).toHaveValue('support-qa');
    await dialog.getByRole('button', { name: 'Create dataset' }).click();
    await expect(page).toHaveURL(/\/datasets\/support-qa/);
    await expect(page.getByText('No versions yet')).toBeVisible();
    await expect(page.getByTestId('create-first-draft')).toBeVisible();
  });

  test('New dataset menu > Start blank from the populated catalog', async ({ page, request }) => {
    const p = await createProject(request, 'Catalog Menu', uniqueSlug('catmenu'));
    await createDataset(request, p.slug, 'Existing One');
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await page.getByTestId('new-dataset').click();
    await page.getByRole('menuitem', { name: /Start blank/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New dataset' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('From Menu');
    await dialog.getByRole('textbox', { name: 'Description' }).fill('made by e2e');
    await dialog.getByRole('button', { name: 'Create dataset' }).click();
    await expect(page).toHaveURL(/\/datasets\/from-menu/);
    await expect(page.getByRole('button', { name: 'made by e2e' })).toBeVisible();
  });

  test('duplicate slug keeps the dialog open with the server error', async ({ page, request }) => {
    const p = await createProject(request, 'Catalog Dup', uniqueSlug('catdup'));
    await createDataset(request, p.slug, 'Dup Name');
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await page.getByTestId('new-dataset').click();
    await page.getByRole('menuitem', { name: /Start blank/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New dataset' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Another');
    await dialog.getByRole('textbox', { name: /^Slug/ }).fill('dup-name');
    await dialog.getByRole('button', { name: 'Create dataset' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toBeVisible();
  });
});
