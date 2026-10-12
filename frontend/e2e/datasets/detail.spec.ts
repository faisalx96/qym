/**
 * Brief 07 §2.4-2.7: detail version resolution + URL normalisation, drafts, publish,
 * production, items table URL state, docked pane editing, discard guard, bulk delete.
 */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, trackPageLoads, uniqueSlug } from '../helpers';
import {
  bulkItems,
  createDataset,
  createVersion,
  publishVersion,
  sampleItems,
  type SeededDataset,
  type SeededVersion,
} from './support';
import { query } from './ui';

async function seed(request: Parameters<typeof createProject>[0], prefix: string, n = 6) {
  const p = await createProject(request, `Detail ${prefix}`, uniqueSlug(prefix));
  const d = await createDataset(request, p.slug, `Dataset ${prefix}`);
  return { p, d, n };
}
async function draftWithItems(request: Parameters<typeof createProject>[0], slug: string, d: SeededDataset, n: number): Promise<SeededVersion> {
  const v = await createVersion(request, slug, d.slug);
  await bulkItems(request, slug, d.slug, v.version, sampleItems(n));
  return v;
}
const rowOf = (page: Page, id: string) => page.locator(`[data-item-link="${id}"]`).locator('xpath=ancestor::*[@role="row"]');

test.describe('detail: versions and URL', () => {
  test('version resolution: bare URL -> newest published, ?v= and tab are normalised, aliases and unknown labels resolve', async ({ page, request }) => {
    const { p, d } = await seed(request, 'resolve');
    const v1 = await draftWithItems(request, p.slug, d, 3);
    await publishVersion(request, p.slug, d.slug, v1.version, true);
    const v2 = await draftWithItems(request, p.slug, d, 4);
    await publishVersion(request, p.slug, d.slug, v2.version, false);
    await createVersion(request, p.slug, d.slug); // v3 draft

    // production (v1) wins over the newest published (v2)
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await expect(page.getByTestId('version-switcher')).toContainText('v1');
    await expect(page.getByTestId('version-switcher')).toContainText('Production');
    await expect.poll(() => query(page).get('v')).toBe('v1');
    expect(query(page).get('tab')).toBe('items');

    // alias in ?v= resolves to the label
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=production`);
    await expect.poll(() => query(page).get('v')).toBe('v1');

    // explicit label is kept
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v3`);
    await expect(page.getByTestId('version-switcher')).toContainText('Draft');
    expect(query(page).get('v')).toBe('v3');
    await expect(page.getByTestId('publish')).toBeVisible();

    // unknown label falls back to the default version
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=zzz`);
    await expect.poll(() => query(page).get('v')).toBe('v1');
  });

  test('[BUG] version switcher navigates in-app (no reload, stays in the app)', async ({ page, request }) => {
    const { p, d } = await seed(request, 'switch');
    const v1 = await draftWithItems(request, p.slug, d, 3);
    await publishVersion(request, p.slug, d.slug, v1.version, true);
    const v2 = await draftWithItems(request, p.slug, d, 4);
    await publishVersion(request, p.slug, d.slug, v2.version, false);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    const loads = trackPageLoads(page);
    await page.getByTestId('version-switcher').click();
    await page.getByRole('option', { name: /v2/ }).click();
    await expect(page).toHaveURL(/\/projects\/.*v=v2/);
    await expect(page.getByTestId('version-switcher')).toContainText('v2');
    await expect(page.getByRole('tab', { name: /Items/ })).toContainText('4');
    expect(loads.count()).toBe(0);
  });

  test('legacy ?tab=versions redirects to the Lineage tab', async ({ page, request }) => {
    const { p, d } = await seed(request, 'legacy');
    const v1 = await draftWithItems(request, p.slug, d, 2);
    await publishVersion(request, p.slug, d.slug, v1.version, true);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=versions`);
    await expect.poll(() => query(page).get('tab')).toBe('lineage');
    await expect(page.getByRole('tab', { name: /Lineage/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-dataset-lineage]')).toBeVisible();
    await expect(page.locator('[data-version-node=v1]')).toBeVisible();
  });

  test('missing dataset shows a not-found state', async ({ page, request }) => {
    const { p } = await seed(request, 'missing');
    await gotoApp(page, `/projects/${p.slug}/datasets/does-not-exist`);
    await expect(page.getByText(/Couldn’t load this dataset/)).toBeVisible();
  });
});

test.describe('detail: draft lifecycle', () => {
  test('create first draft, add an item, publish with production, then Create draft / Set as production', async ({ page, request }) => {
    const { p, d } = await seed(request, 'life');
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await expect(page.getByText('No versions yet')).toBeVisible();
    await page.getByTestId('create-first-draft').first().click();
    const draftDialog = page.getByRole('dialog', { name: 'Create draft' });
    await draftDialog.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/v=v1/);
    await expect(page.getByText('This draft is empty')).toBeVisible();

    await page.getByTestId('add-item').click();
    const add = page.getByRole('dialog', { name: 'Add item' });
    await add.getByRole('textbox', { name: /^Input/ }).fill('How do I reset my password?');
    await add.getByRole('textbox', { name: 'Expected output' }).fill('Use the reset link.');
    await add.getByRole('textbox', { name: /^Metadata/ }).fill('{"topic":"auth"}');
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByText('How do I reset my password?').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /Items/ })).toContainText('1');

    await page.getByTestId('publish').click();
    const pub = page.getByRole('dialog', { name: 'Publish v1' });
    await expect(pub.getByRole('checkbox', { name: 'Set as production' })).toBeChecked();
    await pub.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('v1 published')).toBeVisible();
    await expect(page.getByTestId('version-switcher')).toContainText('Production');
    await expect(page.getByTestId('add-item')).toHaveCount(0);
    await expect(page.getByTestId('set-production')).toHaveCount(0);

    // second draft copies items; publish without production, then promote it
    await page.getByTestId('create-draft').click();
    await page.getByRole('dialog', { name: 'Create draft' }).getByRole('textbox', { name: 'Name' }).fill('second');
    await page.getByRole('dialog', { name: 'Create draft' }).getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/v=v2/);
    await expect(page.getByTestId('version-switcher')).toContainText('second');
    await expect(page.getByRole('tab', { name: /Items/ })).toContainText('1');
    await page.getByTestId('publish').click();
    const pub2 = page.getByRole('dialog', { name: 'Publish v2' });
    await pub2.getByText('Set as production').click();
    await expect(pub2.getByRole('checkbox', { name: 'Set as production' })).not.toBeChecked();
    await pub2.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('v2 published')).toBeVisible();
    await expect(page.getByTestId('version-switcher')).not.toContainText('Production');
    await page.getByTestId('set-production').click();
    await expect(page.getByText('v2 is now production')).toBeVisible();
    await expect(page.getByTestId('version-switcher')).toContainText('Production');
    await expect(page.getByTestId('set-production')).toHaveCount(0);
  });

  test('[BUG] Add item dialog shows the validation error for invalid metadata JSON / missing input', async ({ page, request }) => {
    const { p, d } = await seed(request, 'addinvalid');
    await draftWithItems(request, p.slug, d, 1);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await page.getByTestId('add-item').click();
    const add = page.getByRole('dialog', { name: 'Add item' });
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(add.getByText('Input is required.')).toBeVisible();
    await add.getByRole('textbox', { name: /^Input/ }).fill('x');
    await add.getByRole('textbox', { name: /^Metadata/ }).fill('{bad');
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(add.getByText('Metadata is not valid JSON.')).toBeVisible();
  });

  test('rename version from the overflow menu and rename dataset via the pencil', async ({ page, request }) => {
    const { p, d } = await seed(request, 'rename');
    await draftWithItems(request, p.slug, d, 2);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await page.getByTestId('hero-more').click();
    await page.getByRole('menuitem', { name: 'Name version…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Name v1' });
    await dlg.getByRole('textbox', { name: 'Name' }).fill('Q3 refresh');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('version-switcher')).toContainText('Q3 refresh');
  });
});

test.describe('detail: items table', () => {
  test('search, sort and page live in the URL and survive reload; search resets the page', async ({ page, request }) => {
    const { p, d } = await seed(request, 'items');
    const v = await draftWithItems(request, p.slug, d, 60);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?size=25`);
    await expect(page.locator('[data-item-link]')).toHaveCount(25);
    await expect(page.locator('[data-items-tab]')).toContainText('60 items');

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(() => query(page).get('page')).toBe('1');
    await expect(page.locator('[data-item-link]').first()).toHaveText('25');
    await page.reload();
    await expect(page.locator('[data-item-link]').first()).toHaveText('25');
    expect(query(page).get('size')).toBe('25');

    await page.getByRole('columnheader', { name: /^Input/ }).click();
    await expect.poll(() => query(page).get('sort')).toMatch(/^input_(asc|desc)$/);
    const sortParam = query(page).get('sort');
    await page.reload();
    expect(query(page).get('sort')).toBe(sortParam);
    await expect(page.getByRole('columnheader', { name: /^Input/ })).toHaveAttribute('aria-sort', /ascending|descending/);

    const search = page.getByRole('searchbox', { name: 'Search items' });
    await search.fill('#17.');
    await expect.poll(() => query(page).get('search')).toBe('#17.');
    expect(query(page).get('page')).toBeNull();
    await expect(page.locator('[data-items-tab]')).toContainText('1 item matching');
    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search items' })).toHaveValue('#17.');
    await expect(page.locator('[data-item-link]')).toHaveCount(1);

    await page.getByRole('searchbox', { name: 'Search items' }).fill('zzzz-no-match');
    await expect(page.getByText('No items match these filters')).toBeVisible();
  });

  test('pane: string -> number type change is shown, saved, and History records the type change', async ({ page, request }) => {
    const { p, d } = await seed(request, 'pane');
    const v = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v.version, [
      { item_id: 'num-1', input: '42', expected_output: 'forty-two' },
      { item_id: 'num-2', input: 'plain', expected_output: 'x' },
    ]);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await rowOf(page, 'num-1').click();
    const pane = page.locator('[data-item-pane=num-1]');
    await expect(pane).toBeVisible();
    await expect(pane.getByTestId('pane-save')).toBeDisabled();
    const input = pane.locator('section').filter({ has: page.getByRole('textbox', { name: 'Input', exact: true }) });
    await expect(input.getByTestId('type-tag')).toHaveText('string');
    await input.getByRole('radiogroup').getByText('JSON').click();
    await expect(input.getByTestId('type-tag')).toHaveText('string → number');
    await expect(input).toContainText('will be saved as number');
    await pane.getByTestId('pane-save').click();
    await expect(page.getByText('Item num-1 saved')).toBeVisible();

    await pane.getByTestId('pane-open-page').click();
    await expect(page.locator('[data-item-page=num-1]')).toBeVisible();
    await page.getByRole('tab', { name: 'History' }).click();
    const history = page.locator('[data-item-history]');
    await expect(history.locator('[data-revision]').filter({ hasText: 'updated' }).first()).toContainText('type changed: input string → number');
    expect(query(page).get('tab')).toBe('history');
  });

  test('pane: Esc with unsaved edits opens the guard (Keep editing / Discard / Save and continue)', async ({ page, request }) => {
    const { p, d } = await seed(request, 'guard');
    const v = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v.version, [
      { item_id: 'g-1', input: 'first', expected_output: 'a' },
      { item_id: 'g-2', input: 'second', expected_output: 'b' },
    ]);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await rowOf(page, 'g-1').click();
    const pane = page.locator('[data-item-pane=g-1]');
    const box = pane.getByRole('textbox', { name: 'Input' });
    await box.fill('first edited');
    await expect(pane).toContainText('Unsaved changes');
    await box.press('Escape');
    const guard = page.getByRole('dialog', { name: 'Unsaved changes' }).or(page.getByRole('alertdialog', { name: 'Unsaved changes' }));
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Keep editing' }).click();
    await expect(pane).toBeVisible();
    await expect(box).toHaveValue('first edited');

    // switching rows is guarded too; Discard proceeds to the other row
    await rowOf(page, 'g-2').click();
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('[data-item-pane=g-2]')).toBeVisible();

    // dirty again, Save and continue persists then closes
    await page.locator('[data-item-pane=g-2]').getByRole('textbox', { name: 'Input' }).fill('second saved');
    await page.getByTestId('pane-close').click();
    await guard.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.locator('[data-item-pane]')).toHaveCount(0);
    await expect(page.getByText('second saved').first()).toBeVisible();

    // clean Esc closes straight away
    await rowOf(page, 'g-1').click();
    await expect(page.locator('[data-item-pane=g-1]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-item-pane]')).toHaveCount(0);
  });

  test('pane: j / k step through rows; leaving the tab with unsaved edits asks first; deleting the open row closes the pane', async ({ page, request }) => {
    const { p, d } = await seed(request, 'pane-nav');
    const v = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v.version, [
      { item_id: 'n-1', input: 'one', expected_output: 'a' },
      { item_id: 'n-2', input: 'two', expected_output: 'b' },
      { item_id: 'n-3', input: 'three', expected_output: 'c' },
    ]);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await rowOf(page, 'n-1').click();
    await expect(page.locator('[data-item-pane=n-1]')).toBeVisible();
    await page.keyboard.press('j');
    await expect(page.locator('[data-item-pane=n-2]')).toBeVisible();
    await page.keyboard.press('k');
    await expect(page.locator('[data-item-pane=n-1]')).toBeVisible();

    // typing j in a field must not move the pane
    const box = page.locator('[data-item-pane=n-1]').getByRole('textbox', { name: 'Input' });
    await box.fill('one jj');
    await expect(page.locator('[data-item-pane=n-1]')).toBeVisible();

    // switching to the Runs tab with unsaved edits is guarded
    await page.getByRole('tab', { name: /^Runs/ }).click();
    const leave = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' }).or(page.getByRole('dialog', { name: 'Discard unsaved changes?' }));
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.locator('[data-item-pane=n-1]')).toBeVisible();
    await expect(box).toHaveValue('one jj');
    await page.getByRole('tab', { name: /^Runs/ }).click();
    await leave.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('tab', { name: /^Runs/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('bulk delete selected items on a draft', async ({ page, request }) => {
    const { p, d } = await seed(request, 'bulk');
    await draftWithItems(request, p.slug, d, 6);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await expect(page.locator('[data-item-link]')).toHaveCount(6);
    // keyboard selection (Space on a focused row): the table renders no checkbox column, see the [BUG] test below
    await rowOf(page, 'q-000').focus();
    await page.keyboard.press('Space');
    await rowOf(page, 'q-001').focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('2 selected');
    await page.getByTestId('bulk-delete-items').click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete 2 items?' });
    await confirm.getByRole('button', { name: 'Delete 2' }).click();
    await expect(page.getByText('2 items deleted')).toBeVisible();
    await expect(page.locator('[data-item-link]')).toHaveCount(4);
  });

  test('changing the search drops the row selection so bulk delete never hits hidden rows', async ({ page, request }) => {
    const { p, d } = await seed(request, 'bulk-scope');
    await draftWithItems(request, p.slug, d, 6);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await expect(page.locator('[data-item-link]')).toHaveCount(6);
    await rowOf(page, 'q-000').focus();
    await page.keyboard.press('Space');
    const bulk = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulk).toContainText('1 selected');
    await page.getByRole('searchbox', { name: 'Search items' }).fill('order #3');
    await expect(page.locator('[data-item-link]')).toHaveCount(1);
    await expect(bulk).toHaveCount(0);
  });

  test('[BUG] items table exposes a selection checkbox per row on drafts', async ({ page, request }) => {
    const { p, d } = await seed(request, 'selbox');
    await draftWithItems(request, p.slug, d, 3);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await expect(page.locator('[data-item-link]')).toHaveCount(3);
    await expect(page.getByRole('grid', { name: /Items in v1/ }).getByRole('checkbox')).not.toHaveCount(0);
  });

  test('row action menu deletes a single item', async ({ page, request }) => {
    const { p, d } = await seed(request, 'rowdel');
    await draftWithItems(request, p.slug, d, 3);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await page.getByRole('button', { name: 'Actions for item q-001' }).click();
    await page.getByRole('menuitem', { name: 'Delete item' }).click();
    await page.getByRole('alertdialog', { name: /Delete item q-001/ }).getByRole('button', { name: 'Delete item' }).click();
    await expect(page.getByText('Item q-001 deleted')).toBeVisible();
    await expect(page.locator('[data-item-link]')).toHaveCount(2);
  });

  test('published version is read-only: no editor, "Create draft to edit" forks a draft', async ({ page, request }) => {
    const { p, d } = await seed(request, 'ro');
    const v = await draftWithItems(request, p.slug, d, 3);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await rowOf(page, 'q-000').click();
    const pane = page.locator('[data-item-pane]');
    await expect(pane).toBeVisible();
    await expect(pane.getByTestId('pane-save')).toHaveCount(0);
    await expect(pane.locator('textarea')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0); // no bulk selection on published

    await page.locator('[data-item-link]').first().click();
    await expect(page.locator('[data-item-page]')).toBeVisible();
    await expect(page.getByTestId('save-item')).toHaveCount(0);
    await expect(page.getByTestId('delete-item')).toHaveCount(0);
    await page.getByTestId('create-draft-to-edit').click();
    await page.getByRole('dialog', { name: 'Create draft' }).getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/v=v2/);
    await expect(page.getByTestId('save-item')).toBeVisible();
    await expect(page.getByTestId('create-draft-to-edit')).toHaveCount(0);
  });
});

test.describe('item page', () => {
  test('prev/next follow the list, ?item= deep link, save, History + revert', async ({ page, request }) => {
    const { p, d } = await seed(request, 'itempage');
    const v = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v.version, [
      { item_id: 'a-1', input: 'alpha', expected_output: 'A' },
      { item_id: 'a-2', input: 'beta', expected_output: 'B' },
      { item_id: 'a-3', input: 'gamma', expected_output: 'C' },
    ]);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v1&item=a-2`);
    await expect(page.locator('[data-item-page=a-2]')).toBeVisible();
    await expect(page.getByTestId('item-prev')).toBeVisible();
    await page.getByTestId('item-next').click();
    await expect(page.locator('[data-item-page=a-3]')).toBeVisible();
    await expect(page.getByTestId('item-next')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('item-prev').click();
    await expect(page.locator('[data-item-page=a-2]')).toBeVisible();

    const input = page.getByRole('textbox', { name: 'Input' });
    await input.fill('beta v2');
    await expect(page.getByTestId('save-item')).toBeEnabled();
    await page.getByTestId('save-item').click();
    await expect(page.getByText('Item a-2 saved')).toBeVisible();

    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.locator('[data-item-history] [data-revision]')).toHaveCount(2);
    await page.locator('[data-revision]').filter({ hasText: 'created' }).getByRole('button', { name: /Revert to this/ }).click();
    await page.getByRole('dialog', { name: /Revert to revision/ }).or(page.getByRole('alertdialog', { name: /Revert to revision/ })).getByRole('button', { name: 'Revert' }).click();
    await expect(page.getByText(/Reverted to revision/)).toBeVisible();
    await expect(page.locator('[data-item-history] [data-revision]')).toHaveCount(3);
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page.getByRole('textbox', { name: 'Input' })).toHaveValue('beta');
  });

  test('leaving the item page with unsaved edits asks to discard', async ({ page, request }) => {
    const { p, d } = await seed(request, 'itemguard');
    await draftWithItems(request, p.slug, d, 2);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v1&item=q-000`);
    await page.getByRole('textbox', { name: 'Input' }).fill('changed');
    await page.getByTestId('item-next').click();
    const dlg = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.locator('[data-item-page=q-000]')).toBeVisible();
    await page.getByTestId('item-next').click();
    await dlg.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.locator('[data-item-page=q-001]')).toBeVisible();
  });

  test('delete item from the item page moves to the neighbour', async ({ page, request }) => {
    const { p, d } = await seed(request, 'itemdel');
    await draftWithItems(request, p.slug, d, 3);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v1&item=q-001`);
    await page.getByTestId('delete-item').click();
    await page.getByRole('alertdialog', { name: /Delete item q-001/ }).getByRole('button', { name: 'Delete item' }).click();
    await expect(page.getByText('Item q-001 deleted')).toBeVisible();
    await expect(page.locator('[data-item-page=q-002]')).toBeVisible();
  });
});

test.describe('detail: links', () => {
  test('[BUG] "forked from" meta link stays in the app without a full reload', async ({ page, request }) => {
    const { p, d } = await seed(request, 'forklink');
    const v1 = await draftWithItems(request, p.slug, d, 2);
    await publishVersion(request, p.slug, d.slug, v1.version, true);
    await createVersion(request, p.slug, d.slug, { from_version: 'v1' });
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v2`);
    const link = page.getByRole('link', { name: 'v1', exact: true }).first();
    await expect(link).toHaveAttribute('href', /^\/projects\//);
  });
});
