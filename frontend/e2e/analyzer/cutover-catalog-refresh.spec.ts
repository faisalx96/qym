/// <reference lib="dom" />
/**
 * Cutover of test_auto_analysis_release_gate_browser.py (catalog refresh): while a category edit is
 * unsaved a newly approved example does not replace the edits: a banner says so, the new example is
 * listed read-only, and the save still uses the revision the edits started from (so a concurrent
 * change conflicts instead of being overwritten). Once saved or discarded the catalog adopts the new
 * revision and its examples.
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { seedAnalyzer } from './helpers';

test('new approvals while editing keep the edits and the starting revision', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  let current: Record<string, unknown> | null = null;
  await page.route(/\/analysis-config$/, async (route) => {
    try {
      const res = await route.fetch();
      const config = (await res.json()) as Record<string, unknown>;
      current ??= config;
      await route.fulfill({ response: res, json: current });
    } catch {
      /* the page closed while a refetch was in flight */
    }
  });
  await gotoApp(page, `/projects/${seed.slug}/analysis?scope=categories`);
  const category = (current as unknown as { default_categories: string[] } | null)?.default_categories;
  await expect(page.getByRole('tab').first()).toBeVisible();
  const startRevision = Number((current as unknown as { category_catalog_version: number }).category_catalog_version);
  const first = (category ?? [])[0]!;

  // edit the first category's description: unsaved changes
  const description = page.getByRole('textbox', { name: /^Description/ });
  await description.fill('Edited before the approval arrived.');
  await expect(page.getByTestId('catalog-save-state')).toHaveText('Unsaved changes');

  // another reviewer approves an example: the config the page refetches has a new revision and example
  const cfg = current as unknown as {
    category_catalog_version: number;
    category_example_counts: Record<string, number>;
    category_examples: Record<string, unknown[]>;
  };
  cfg.category_catalog_version = startRevision + 1;
  cfg.category_example_counts = { ...cfg.category_example_counts, [first]: (cfg.category_example_counts?.[first] ?? 0) + 1 };
  cfg.category_examples = {
    ...cfg.category_examples,
    [first]: [
      ...(cfg.category_examples?.[first] ?? []),
      { id: 9001, item_id: 'late-item', metric_name: 'exact_match', detail: 'New approval', root_cause_issues: [{ category: first, subcategory: 'New approval' }] },
    ],
  };
  // the config is stale after 10 s; coming back to the tab refetches it
  await page.waitForTimeout(10_500);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText(/New approvals are available/)).toBeVisible();
  await expect(description).toHaveValue('Edited before the approval arrived.');

  // saving sends the revision the edits started from, not the refreshed one
  let body: { base_revision?: number } = {};
  await page.route(/analysis-category-catalog$/, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    body = route.request().postDataJSON() as { base_revision?: number };
    await route.fulfill({ json: { catalog: { version: startRevision + 2, categories: [] }, created: true } });
  });
  const put = page.waitForRequest((r) => r.method() === 'PUT' && /analysis-category-catalog$/.test(r.url()));
  await page.getByRole('button', { name: 'Save changes' }).click();
  await put;
  expect(body.base_revision).toBe(startRevision);
});
