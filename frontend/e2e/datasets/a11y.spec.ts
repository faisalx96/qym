/** axe-core (serious + critical must be zero) on datasets, item page, compare, reviews and trash. */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { seedReviews } from '../reviews/support';
import { seedTrash } from '../trash/support';
import { bulkItems, createDataset, createVersion, publishVersion, sampleItems } from './support';

async function clean(page: Page, label: string) {
  await page.waitForTimeout(450); // let open/close animations finish so contrast is measured on settled colours
  const v = await axeSeriousViolations(page);
  expect(v, `${label}\n${describeViolations(v)}`).toEqual([]);
}

async function seedTwoVersions(request: Parameters<typeof createProject>[0], prefix: string) {
  const p = await createProject(request, `Axe ${prefix}`, uniqueSlug(prefix));
  const d = await createDataset(request, p.slug, `Axe ${prefix}`, { description: 'a11y' });
  const v1 = await createVersion(request, p.slug, d.slug);
  await bulkItems(request, p.slug, d.slug, v1.version, sampleItems(8));
  await publishVersion(request, p.slug, d.slug, v1.version, true);
  await createVersion(request, p.slug, d.slug, { from_version: 'v1' });
  return { p, d };
}

test.describe('axe: datasets', () => {
  test('catalog (cards) and the empty catalog', async ({ page, request }) => {
    const { p } = await seedTwoVersions(request, 'axecat');
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await expect(page.locator('[data-dataset-card]')).toHaveCount(1);
    await clean(page, 'catalog');
    const empty = await createProject(request, 'Axe Empty', uniqueSlug('axeempty'));
    await gotoApp(page, `/projects/${empty.slug}/datasets`);
    await expect(page.getByText('No datasets yet')).toBeVisible();
    await clean(page, 'empty catalog');
  });

  test('detail: items tab with the editor pane open, runs, lineage, settings, version popover', async ({ page, request }) => {
    const { p, d } = await seedTwoVersions(request, 'axedet');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v2`);
    await expect(page.locator('[data-item-link]').first()).toBeVisible();
    await clean(page, 'items tab (draft)');
    await page.locator('[data-item-link="q-001"]').locator('xpath=ancestor::*[@role="row"]').click();
    await expect(page.locator('[data-item-pane=q-001]')).toBeVisible();
    await clean(page, 'items tab with pane');
    await page.keyboard.press('Escape');
    for (const tab of ['runs', 'settings']) {
      await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v2&tab=${tab}`);
      await expect(page.getByRole('tab', { name: new RegExp(tab, 'i') })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await clean(page, tab);
    }
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await page.getByTestId('version-switcher').click();
    await expect(page.getByRole('listbox', { name: 'Versions' })).toBeVisible();
    await clean(page, 'version popover');
  });

  test('lineage tab with change counts', async ({ page, request }) => {
    const { p, d } = await seedTwoVersions(request, 'axelin');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v2&tab=lineage`);
    await expect(page.locator('[data-version-node=v2]')).toBeVisible();
    await clean(page, 'lineage');
  });

  test('item page (details, history)', async ({ page, request }) => {
    const { p, d } = await seedTwoVersions(request, 'axeitem');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v2&item=q-001`);
    await expect(page.locator('[data-item-page=q-001]')).toBeVisible();
    await clean(page, 'item details');
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.locator('[data-item-history]')).toBeVisible();
    await clean(page, 'item history');
  });

  test('compare', async ({ page, request }) => {
    const { p, d } = await seedTwoVersions(request, 'axecmp');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}/compare?base=v1&head=v2`);
    await expect(page.locator('[data-compare-page]')).toBeVisible();
    await expect(page.getByLabel('Comparison summary')).toBeVisible();
    await clean(page, 'compare');
  });

  test('upload wizard dialog and new-dataset dialog', async ({ page, request }) => {
    const { p } = await seedTwoVersions(request, 'axewiz');
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await page.getByTestId('new-dataset').click();
    await page.getByRole('menuitem', { name: /Start blank/ }).click();
    await expect(page.getByRole('dialog', { name: 'New dataset' })).toBeVisible();
    await clean(page, 'new dataset dialog');
    await page.keyboard.press('Escape');
    await page.getByTestId('new-dataset').click();
    await page.getByRole('menuitem', { name: /Import CSV/ }).click();
    await expect(page.getByRole('dialog', { name: 'Upload dataset' })).toBeVisible();
    await clean(page, 'upload wizard');
  });
});

test.describe('axe: reviews and trash', () => {
  test('reviews queue with detail pane, filters popover and shortcuts dialog', async ({ page, request }) => {
    const s = await seedReviews(request, 'axerev', 3);
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(page.locator('[data-correction-row]')).toHaveCount(3);
    await clean(page, 'reviews');
    await page.getByTestId('filters-trigger').click();
    await expect(page.getByRole('group', { name: 'Filters' })).toBeVisible();
    await clean(page, 'reviews filters popover');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await clean(page, 'shortcuts dialog');
  });

  test('trash', async ({ page, request }) => {
    const s = await seedTrash(request, `axetr${Date.now().toString(36)}`, 2);
    await gotoApp(page, `/trash?q=${s.prefix}`);
    await expect(page.locator('[data-trash-page]')).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Deleted runs' })).toBeVisible();
    await clean(page, 'trash');
  });
});
