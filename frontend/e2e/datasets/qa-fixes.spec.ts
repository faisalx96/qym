/// <reference lib="dom" />
/** QA fix list (datasets.md): catalog header, wizard navigation, compare errors, hover popover, crumbs, type confirm. */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { createApiKey } from '../shell/support';
import {
  bulkItems,
  createDataset,
  createVersion,
  deleteDataset,
  ingestRun,
  publishVersion,
  sampleItems,
} from './support';
import { tmpFile } from './ui';

const rowOf = (page: Page, id: string) =>
  page.locator(`[data-item-link="${id}"]`).locator('xpath=ancestor::*[@role="row"]');

test.describe('catalog', () => {
  test('a project with no live datasets keeps the header, New dataset and the Deleted datasets link', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'QA Empty', uniqueSlug('qaempty'));
    const d = await createDataset(request, p.slug, 'Gone Soon');
    await deleteDataset(request, p.slug, d.slug);
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await expect(page.getByText('No datasets yet')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Datasets', level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-dataset')).toBeVisible();
    await page.getByRole('link', { name: 'Deleted datasets' }).click();
    await expect(page).toHaveURL(/view=deleted/);
    await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  });

  test('a dataset with one run reads "1 run", not "1 runs"', async ({ page, request }) => {
    const p = await createProject(request, 'QA Plural', uniqueSlug('qaplural'));
    const d = await createDataset(request, p.slug, 'Plural DS');
    const v = await createVersion(request, p.slug, d.slug);
    const items = sampleItems(3);
    await bulkItems(request, p.slug, d.slug, v.version, items);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    const apiKey = await createApiKey(request, p.id, 'qa-plural').then((k) => k.token);
    await ingestRun(request, {
      apiKey,
      task: 'qa',
      runName: `plural-${Date.now()}`,
      dataset: d,
      version: { ...v, status: 'published' },
      items,
    });
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    const stats = page.locator(`[data-dataset-card=${d.slug}]`);
    await expect(stats).toContainText(/1\s*run(?!s)/);
    await expect(stats).not.toContainText('1 runs');
  });

  test('state line colours production and draft parts', async ({ page, request }) => {
    const p = await createProject(request, 'QA State', uniqueSlug('qastate'));
    const d = await createDataset(request, p.slug, 'State DS');
    const v1 = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v1.version, sampleItems(2));
    await publishVersion(request, p.slug, d.slug, v1.version, true);
    await createVersion(request, p.slug, d.slug, { from_version: v1.version });
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    const card = page.locator(`[data-dataset-card=${d.slug}]`);
    const color = (kind: string) =>
      card.locator(`[data-kind=${kind}]`).evaluate((el) => getComputedStyle(el).color);
    const [prod, draft] = [await color('prod'), await color('draft')];
    expect(prod).not.toBe(draft);
  });
});

test.describe('wizard', () => {
  test('importing a new dataset lands on its detail page; a legacy code page is explained', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'QA Wizard', uniqueSlug('qawiz'));
    await createDataset(request, p.slug, 'Seed Wiz');
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await page.getByTestId('new-dataset').click();
    await page.getByRole('menuitem', { name: /Import CSV/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload dataset' });
    // "مرحبا" in Windows-1256: not valid UTF-8, so detection picks a legacy code page.
    const bytes = Buffer.concat([
      Buffer.from('input,output\n'),
      ...Array.from({ length: 4 }, () =>
        Buffer.concat([Buffer.from([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]), Buffer.from(',x\n')]),
      ),
    ]);
    await dialog.locator('#wizard-file').setInputFiles(tmpFile('legacy.csv', bytes));
    await expect(dialog.getByTestId('encoding-note')).toContainText('not UTF-8');
    await expect(dialog.getByTestId('encoding-note')).toContainText('Windows-1256');
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Landed Wiz');
    for (let i = 0; i < 2; i++) await dialog.getByTestId('wizard-next').click();
    await dialog.getByTestId('wizard-next').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${p.slug}/datasets/landed-wiz`), { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Landed Wiz' })).toBeVisible();
  });
});

test.describe('detail', () => {
  async function twoVersions(request: Parameters<typeof createProject>[0], prefix: string) {
    const p = await createProject(request, `QA ${prefix}`, uniqueSlug(prefix));
    const d = await createDataset(request, p.slug, `QA DS ${prefix}`);
    const v1 = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v1.version, [
      { item_id: 'a-1', input: '42', expected_output: 'x'.repeat(120), metadata: { topic: 'math' } },
      { item_id: 'a-2', input: 'two', expected_output: 'y' },
    ]);
    await publishVersion(request, p.slug, d.slug, v1.version, true);
    const v2 = await createVersion(request, p.slug, d.slug, { from_version: v1.version });
    return { p, d, v1, v2 };
  }

  test('compare with an unknown base/head says so and links back to the defaults', async ({
    page,
    request,
  }) => {
    const { p, d } = await twoVersions(request, 'qacmp');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}/compare?base=v9&head=v1`);
    await expect(page.getByText('Dataset version or alias not found: v9')).toBeVisible();
    await page.getByRole('link', { name: 'Compare the default versions' }).click();
    await expect(page.locator('[data-compare-page]')).toBeVisible();
  });

  test('the breadcrumb carries the dataset name', async ({ page, request }) => {
    const { p, d } = await twoVersions(request, 'qacrumb');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(nav.getByRole('link', { name: 'Datasets' })).toBeVisible();
    await expect(nav.locator('[aria-current=page]')).toHaveText(d.name);
  });

  test('hovering a cell for 700 ms shows its full value', async ({ page, request }) => {
    const { p, d } = await twoVersions(request, 'qahover');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v1`);
    const cell = rowOf(page, 'a-1').getByRole('gridcell').filter({ hasText: 'xxxx' });
    await cell.hover();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-cell-popover]')).toHaveCount(0);
    await expect(page.locator('[data-cell-popover]')).toContainText('x'.repeat(120), { timeout: 3000 });
    await page.mouse.move(5, 5);
    await expect(page.locator('[data-cell-popover]')).toHaveCount(0);
  });

  test('pane: metadata that is JSON but not an object is not called invalid JSON; a type change asks first', async ({
    page,
    request,
  }) => {
    const { p, d, v2 } = await twoVersions(request, 'qapane');
    await bulkItems(request, p.slug, d.slug, v2.version, [
      { item_id: 'n-1', input: '42', expected_output: 'z', metadata: { a: 1 } },
    ]);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=${v2.version}`);
    await rowOf(page, 'n-1').click();
    const pane = page.locator('[data-item-pane=n-1]');
    await expect(pane).toBeVisible();
    const meta = pane
      .locator('section')
      .filter({ has: page.getByRole('textbox', { name: 'Metadata', exact: true }) });
    await pane.getByRole('textbox', { name: 'Metadata', exact: true }).fill('[1]');
    await expect(meta).toContainText('Metadata must be a JSON object.');
    await expect(meta).not.toContainText('Not valid JSON');
    await pane.getByRole('textbox', { name: 'Metadata', exact: true }).fill('{}');
    const input = pane
      .locator('section')
      .filter({ has: page.getByRole('textbox', { name: 'Input', exact: true }) });
    await input.getByRole('radiogroup').getByText('JSON').click();
    await pane.getByTestId('pane-save').click();
    const confirm = page.getByRole('dialog', { name: 'Change the stored type?' });
    await expect(confirm).toContainText('input');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Item n-1 saved')).toHaveCount(0);
    await pane.getByTestId('pane-save').click();
    await page.getByRole('button', { name: 'Save with new type' }).click();
    await expect(page.getByText('Item n-1 saved')).toBeVisible();
  });
});
