/**
 * Cutover: ported from tests/platform/test_dataset_search_browser.py. The items
 * table loads once on entry, and a slow older search / version response (success
 * or failure) never replaces the newer one.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, publishVersion } from './support';

const ITEMS_URL = /\/v1\/datasets\/[^/]+\/versions\/[^/]+\/items\?/;

async function seed(request: Parameters<typeof createProject>[0], prefix: string) {
  const p = await createProject(request, `Search ${prefix}`, uniqueSlug(prefix));
  const d = await createDataset(request, p.slug, `Search DS ${prefix}`);
  return { p, d };
}

const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search items' });
const link = (page: Page, id: string) => page.locator(`[data-item-link="${id}"]`);

/** Answers the items request for `search=<slow>` only after `delayMs`, as `status`. */
async function delaySearch(page: Page, slow: string, status: number, delayMs = 1500) {
  await page.route(ITEMS_URL, async (route: Route) => {
    if (new URL(route.request().url()).searchParams.get('search') !== slow) return route.continue();
    const real = status === 200 ? await route.fetch() : null;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (real) return route.fulfill({ response: real });
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'overloaded' }),
    });
  });
}

test.describe('dataset items: loading and stale responses', () => {
  for (const withItem of [true, false]) {
    test(`items load once on entry (${withItem ? 'one item' : 'empty draft'})`, async ({ page, request }) => {
      const { p, d } = await seed(request, withItem ? 'entry1' : 'entry0');
      const v = await createVersion(request, p.slug, d.slug);
      if (withItem)
        await bulkItems(request, p.slug, d.slug, v.version, [
          { item_id: 'first-item', input: 'السعودية', expected_output: 'الرياض' },
        ]);
      let itemRequests = 0;
      page.on('request', (r) => {
        if (ITEMS_URL.test(r.url()) && r.method() === 'GET') itemRequests += 1;
      });
      await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
      await expect(page.getByRole('tab', { name: /^Items/ })).toHaveAttribute('aria-selected', 'true');
      if (withItem) await expect(link(page, 'first-item')).toBeVisible();
      else await expect(page.getByText('This draft is empty')).toBeVisible();
      expect(itemRequests).toBe(1);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }

  for (const oldStatus of [200, 503]) {
    test(`the latest search wins over a late ${oldStatus === 200 ? 'success' : 'failure'}`, async ({
      page,
      request,
    }) => {
      const { p, d } = await seed(request, `late${oldStatus}`);
      const v = await createVersion(request, p.slug, d.slug);
      await bulkItems(request, p.slug, d.slug, v.version, [
        { item_id: 'obsolete', input: 'alpha text', expected_output: 'a' },
        { item_id: 'latest', input: 'beta text', expected_output: 'b' },
      ]);
      await delaySearch(page, 'alpha', oldStatus);
      await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
      await expect(link(page, 'latest')).toBeVisible();
      // the slow search is typed first; the newer one is typed before it answers
      await searchBox(page).fill('alpha');
      await page.waitForTimeout(500); // past the debounce so the slow request is really in flight
      await searchBox(page).fill('beta');
      await expect(link(page, 'latest')).toBeVisible();
      await expect(link(page, 'obsolete')).toHaveCount(0);
      await page.waitForTimeout(1800); // the stale response lands now
      await expect(link(page, 'latest')).toBeVisible();
      await expect(link(page, 'obsolete')).toHaveCount(0);
      await expect(page.getByText('1 item matching')).toBeVisible();
    });
  }

  test('typing again before the debounce ends drops the earlier search', async ({ page, request }) => {
    const { p, d } = await seed(request, 'debounce');
    const v = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v.version, [
      { item_id: 'obsolete', input: 'alpha text', expected_output: 'a' },
      { item_id: 'latest', input: 'beta text', expected_output: 'b' },
    ]);
    const searches: string[] = [];
    page.on('request', (r) => {
      if (ITEMS_URL.test(r.url())) searches.push(new URL(r.url()).searchParams.get('search') ?? '');
    });
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await expect(link(page, 'latest')).toBeVisible();
    await searchBox(page).pressSequentially('alpha', { delay: 20 });
    await searchBox(page).fill('beta');
    await expect(link(page, 'obsolete')).toHaveCount(0);
    await expect(link(page, 'latest')).toBeVisible();
    await page.waitForTimeout(800);
    expect(searches).not.toContain('alpha');
  });

  test('an old version response cannot replace the new version', async ({ page, request }) => {
    const { p, d } = await seed(request, 'ver');
    const v1 = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v1.version, [
      { item_id: 'old-version', input: 'alpha text', expected_output: 'a' },
    ]);
    await publishVersion(request, p.slug, d.slug, v1.version, true);
    const v2 = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v2.version, [
      { item_id: 'new-version', input: 'alpha text', expected_output: 'b' },
    ]);
    await publishVersion(request, p.slug, d.slug, v2.version, false);
    // v1's search answers late
    await page.route(ITEMS_URL, async (route) => {
      const url = new URL(route.request().url());
      if (!/\/versions\/v1\/items/.test(url.pathname) || url.searchParams.get('search') !== 'alpha')
        return route.continue();
      const real = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fulfill({ response: real });
    });
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?v=v1`);
    await expect(link(page, 'old-version')).toBeVisible();
    await searchBox(page).fill('alpha');
    await page.waitForTimeout(500);
    await page.getByTestId('version-switcher').click();
    await page.getByRole('option', { name: /^v2/ }).click();
    await expect(page).toHaveURL(/v=v2/);
    await expect(link(page, 'new-version')).toBeVisible();
    await page.waitForTimeout(1800);
    await expect(link(page, 'new-version')).toBeVisible();
    await expect(link(page, 'old-version')).toHaveCount(0);
  });

  test('zero search matches never claim the version is empty, and clearing restores the rows', async ({
    page,
    request,
  }) => {
    const { p, d } = await seed(request, 'zero');
    const v = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v.version, [
      { item_id: 'restored', input: 'السعودية', expected_output: 'الرياض' },
    ]);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    await expect(link(page, 'restored')).toBeVisible();
    await searchBox(page).fill('مفقود');
    await expect(page.getByText('No items match these filters')).toBeVisible();
    await expect(page.getByText('This version has no items')).toHaveCount(0);
    await searchBox(page).fill('');
    await expect(link(page, 'restored')).toBeVisible();
  });
});
