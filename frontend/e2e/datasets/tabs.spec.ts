/**
 * Brief 07 §2.8-2.13: compare, runs, lineage, settings (delete/restore, private test set).
 */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { createApiKey } from '../shell/support';
import {
  bulkItems,
  createDataset,
  createVersion,
  ingestRun,
  patchItem,
  publishVersion,
  sampleItems,
} from './support';
import { query } from './ui';

async function twoVersions(request: Parameters<typeof createProject>[0], prefix: string) {
  const p = await createProject(request, `Tabs ${prefix}`, uniqueSlug(prefix));
  const d = await createDataset(request, p.slug, `Tabs ${prefix}`);
  const v1 = await createVersion(request, p.slug, d.slug);
  const items = sampleItems(5);
  await bulkItems(request, p.slug, d.slug, v1.version, items);
  await publishVersion(request, p.slug, d.slug, v1.version, true);
  const v2 = await createVersion(request, p.slug, d.slug, { from_version: 'v1', name: 'edited' });
  await patchItem(request, p.slug, d.slug, v2.version, 'q-001', {
    input: 'What is the refund policy, edited?',
  });
  await request.post(`/v1/datasets/${d.slug}/versions/v2/items:bulk?project_slug=${p.slug}`, {
    data: {
      deletes: ['q-002'],
      upserts: [{ item_id: 'brand-new', input: 'a new question', expected_output: 'new' }],
    },
  });
  await publishVersion(request, p.slug, d.slug, v2.version, false);
  return { p, d, v1, v2, items };
}

test.describe('compare', () => {
  test('summary, kind tabs in the URL, swap, download diff', async ({ page, request }) => {
    const { p, d } = await twoVersions(request, 'cmp');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}/compare?base=v1&head=v2`);
    const summary = page.getByLabel('Comparison summary');
    await expect(summary).toContainText('Added');
    await expect(summary).toContainText('Removed');
    await expect(summary).toContainText('Changed');
    await expect(summary).toContainText('Unchanged');
    await expect(page.getByRole('tab', { name: /Changed/ })).toContainText('1');
    await expect(page.getByRole('tab', { name: /Added/ })).toContainText('1');
    await expect(page.getByRole('tab', { name: /Removed/ })).toContainText('1');
    await expect(page.getByRole('tab', { name: /Unchanged/ })).toContainText('3');
    await expect(page.locator('[data-compare-row=q-001]')).toBeVisible();

    await page.getByRole('tab', { name: /Added/ }).click();
    await expect.poll(() => query(page).get('tab')).toBe('added');
    await expect(page.locator('[data-compare-row=brand-new]')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: /Added/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /Removed/ }).click();
    await expect(page.locator('[data-compare-row=q-002]')).toBeVisible();
    await page.getByRole('tab', { name: /Changed/ }).click();
    await expect.poll(() => query(page).get('tab')).toBeNull();

    await page.getByTestId('compare-swap').click();
    await expect.poll(() => query(page).get('base')).toBe('v2');
    expect(query(page).get('head')).toBe('v1');
    await expect(page.getByRole('tab', { name: /Added/ })).toContainText('1'); // removed<->added swap
    await page.getByTestId('compare-swap').click();
    await expect.poll(() => query(page).get('base')).toBe('v1');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-diff').click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${d.slug}_v1_vs_v2.diff.json`);
  });

  test('"Show more" pages the list 50 at a time', async ({ page, request }) => {
    const p = await createProject(request, 'Compare More', uniqueSlug('cmpmore'));
    const d = await createDataset(request, p.slug, 'Compare More');
    const v1 = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v1.version, sampleItems(60));
    await publishVersion(request, p.slug, d.slug, v1.version, true);
    const v2 = await createVersion(request, p.slug, d.slug); // empty draft + one new item (an empty version cannot be published)
    await bulkItems(request, p.slug, d.slug, v2.version, [
      { item_id: 'only', input: 'only item', expected_output: 'x' },
    ]);
    await publishVersion(request, p.slug, d.slug, v2.version, false);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}/compare?base=v1&head=v2&tab=removed`);
    await expect(page.locator('[data-compare-row]')).toHaveCount(50);
    await expect(page.getByText('Showing 50 of 60')).toBeVisible();
    await page.getByTestId('compare-more').click();
    await expect(page.locator('[data-compare-row]')).toHaveCount(60);
    await expect(page.getByTestId('compare-more')).toHaveCount(0);
  });

  test('defaults fill base/head into the URL; hero menu Compare… opens it; single-version dataset has nothing to compare', async ({
    page,
    request,
  }) => {
    const { p, d } = await twoVersions(request, 'cmpdef');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}/compare`);
    await expect.poll(() => query(page).get('head')).toBe('v1'); // production is the default head
    expect(query(page).get('base')).toBe('v2');

    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v2`);
    await page.getByTestId('hero-more').click();
    await page.getByRole('menuitem', { name: 'Compare…' }).click();
    await expect(page).toHaveURL(/compare\?base=v1&head=v2/);

    const solo = await createDataset(request, p.slug, 'Solo');
    const sv = await createVersion(request, p.slug, solo.slug);
    await bulkItems(request, p.slug, solo.slug, sv.version, sampleItems(1));
    await publishVersion(request, p.slug, solo.slug, sv.version);
    await gotoApp(page, `/projects/${p.slug}/datasets/${solo.slug}/compare`);
    await expect(page.getByText('Nothing to compare yet')).toBeVisible();
  });
});

test.describe('runs and lineage tabs', () => {
  test('Runs tab lists runs ingested on the dataset and opens the run', async ({ page, request }) => {
    const p = await createProject(request, 'Tab Runs', uniqueSlug('tabruns'));
    const d = await createDataset(request, p.slug, 'Runs DS');
    const v = await createVersion(request, p.slug, d.slug);
    const items = sampleItems(6);
    await bulkItems(request, p.slug, d.slug, v.version, items);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    const apiKey = await createApiKey(request, p.id, 'e2e-runs').then((k) => k.token);
    const run = await ingestRun(request, {
      apiKey,
      task: 'qa',
      runName: `run-${Date.now().toString(36)}`,
      dataset: d,
      version: { ...v, status: 'published' },
      items,
    });
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=runs`);
    await expect(page.getByRole('tab', { name: /Runs/ })).toHaveAttribute('aria-selected', 'true');
    const grid = page.locator('[data-dataset-runs]');
    await expect(grid).toContainText(run.run_name);
    await expect(grid).toContainText('exact_match');
    await grid.getByText(run.run_name).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${run.id}`));
  });

  test('Runs tab empty state, item page Runs tab shows the item results', async ({ page, request }) => {
    const p = await createProject(request, 'Tab Runs2', uniqueSlug('tabruns2'));
    const d = await createDataset(request, p.slug, 'Runs DS2');
    const v = await createVersion(request, p.slug, d.slug);
    const items = sampleItems(3);
    await bulkItems(request, p.slug, d.slug, v.version, items);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=runs`);
    await expect(page.locator('[data-dataset-runs]')).toHaveCount(0);
    const apiKey = await createApiKey(request, p.id, 'e2e-runs2').then((k) => k.token);
    const run = await ingestRun(request, {
      apiKey,
      task: 'qa',
      runName: `run2-${Date.now().toString(36)}`,
      dataset: d,
      version: { ...v, status: 'published' },
      items,
    });
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v1&item=q-000&tab=runs`);
    await expect(page.getByRole('tab', { name: /Runs/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(run.run_name).first()).toBeVisible();
  });

  test('Lineage tab shows the version tree with fork nesting, compare link and the change log', async ({
    page,
    request,
  }) => {
    const { p, d } = await twoVersions(request, 'lin');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=lineage`);
    await expect(page.locator('[data-version-node=v1]')).toBeVisible();
    await expect(page.locator('[data-version-node=v2]')).toBeVisible();
    await expect(
      page.locator(
        '[data-version-node=v1] ~ ul [data-version-node=v2], li:has([data-version-node=v1]) ul [data-version-node=v2]',
      ),
    ).toHaveCount(1);
    await expect(page.getByText('Change log')).toBeVisible();
    await page
      .locator('[data-version-node=v2]')
      .getByRole('link', { name: /Compare/ })
      .first()
      .click();
    await expect(page).toHaveURL(/compare\?base=v1&head=v2/);
    await page.goBack();
    await page.locator('[data-version-node=v2]').getByRole('link', { name: 'v2' }).first().click();
    await expect(page).toHaveURL(/v=v2/);
  });
});

test.describe('settings', () => {
  test('general settings save; tags add/remove', async ({ page, request }) => {
    const p = await createProject(request, 'Set General', uniqueSlug('setgen'));
    const d = await createDataset(request, p.slug, 'Settings DS');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=settings`);
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeDisabled();
    await page.getByRole('textbox', { name: 'Description' }).fill('now described');
    const tags = page.getByRole('textbox', { name: 'Tags' });
    await tags.fill('alpha');
    await tags.press('Enter');
    await tags.fill('Alpha');
    await tags.press('Enter');
    await expect(page.getByText('“Alpha” is already a tag.')).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Settings saved')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue('now described');
    await expect(page.getByRole('list', { name: 'Tags' })).toContainText('alpha');
  });

  test('delete needs the typed name, then the dataset lives under ?view=deleted and Restore brings it back', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Set Delete', uniqueSlug('setdel'));
    const d = await createDataset(request, p.slug, 'Doomed Set');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=settings`);
    await page.getByTestId('delete-dataset').click();
    const dlg = page.getByRole('alertdialog', { name: /Delete “Doomed Set”/ });
    const confirm = dlg.getByRole('button', { name: 'Delete dataset' });
    await expect(confirm).toBeDisabled();
    await dlg.getByRole('textbox').fill('wrong name');
    await expect(confirm).toBeDisabled();
    await dlg.getByRole('textbox').fill('Doomed Set');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${p.slug}/datasets$`));
    await expect(page.locator(`[data-dataset-card=${d.slug}]`)).toHaveCount(0);

    await gotoApp(page, `/projects/${p.slug}/datasets?view=deleted`);
    await expect(page.locator('[data-deleted-datasets]')).toContainText('Doomed Set');
    await page.getByTestId(`restore-${d.slug}`).click();
    await expect(page.getByText('"Doomed Set" restored')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/datasets/${d.slug}`));
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await expect(page.locator(`[data-dataset-card=${d.slug}]`)).toBeVisible();
  });

  test('empty deleted view and the catalog link into it', async ({ page, request }) => {
    const p = await createProject(request, 'Set Deleted Empty', uniqueSlug('setdelempty'));
    await createDataset(request, p.slug, 'Alive');
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    await page.getByRole('link', { name: 'Deleted datasets' }).click();
    await expect(page).toHaveURL(/view=deleted/);
    await expect(page.getByText('No deleted datasets')).toBeVisible();
    await page.getByRole('link', { name: '← All datasets' }).click();
    await expect(page.getByTestId('new-dataset')).toBeVisible();
  });

  test('private test set: toggle with confirm; non-admin locked state requests no items', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Set Private', uniqueSlug('setpriv'));
    const d = await createDataset(request, p.slug, 'Secret Set');
    const v = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v.version, sampleItems(3));
    await publishVersion(request, p.slug, d.slug, v.version, true);

    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=settings`);
    const toggle = page.getByTestId('private-toggle');
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    const dlg = page
      .getByRole('dialog', { name: 'Hide items from the team?' })
      .or(page.getByRole('alertdialog', { name: 'Hide items from the team?' }));
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Hide items' }).click();
    await expect(page.getByText('Items are now hidden from non-admins')).toBeVisible();
    await expect(page.getByTestId('private-toggle')).toBeChecked();
    await expect(page.getByText('Private test set').first()).toBeVisible();

    // Under auth=none the user is an admin, so the API still serves items. Simulate a non-admin
    // by rewriting the dataset payload (items_visible=false) and fail any /items request.
    const itemCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/items(\?|$|\/|:)/.test(new URL(r.url()).pathname + new URL(r.url()).search))
        itemCalls.push(r.url());
    });
    await page.route(new RegExp(`/v1/datasets/${d.slug}\\?`), async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { dataset: Record<string, unknown> };
      body.dataset.items_visible = false;
      await route.fulfill({ response: res, json: body });
    });
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=items`);
    await expect(page.getByText('Private test set').first()).toBeVisible();
    await expect(page.getByText('Item contents are hidden from non-admins.')).toBeVisible();
    await page.waitForTimeout(500);
    expect(itemCalls).toEqual([]);
    await expect(page.getByTestId('add-item')).toHaveCount(0);

    // item deep link and compare also stay locked
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v1&item=q-000`);
    await expect(page.getByText('Item contents are hidden from non-admins.')).toBeVisible();
    await page.waitForTimeout(300);
    expect(itemCalls).toEqual([]);

    // toggling back (settings) with confirm
    await page.unroute(new RegExp(`/v1/datasets/${d.slug}\\?`));
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=settings`);
    await page.getByTestId('private-toggle').click();
    await page.getByRole('button', { name: 'Make visible' }).click();
    await expect(page.getByText('Items are visible to the whole project')).toBeVisible();
    await expect(page.getByTestId('private-toggle')).not.toBeChecked();
  });
});
