/**
 * Versioning facets in the Filters popover (cutover of test_versioning_filter_browser.py).
 * The seeded runs carry no versioning metadata, so the facets of the overview answer are
 * overwritten the way the server computes them (each key narrows to what the other
 * keys' selection leaves); the server-side filter itself is pinned by
 * tests/platform/test_run_versioning_filter.py.
 */
import { test, expect, type Page } from '@playwright/test';
import { openFacet, openFilters, openRuns, sharedProject, capture, listRequests, urlParams } from './support';

async function mockFacets(page: Page) {
  await page.route(/\/api\/dashboard\/(runs|overview)$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const sent = route.request().postDataJSON?.() ?? {};
    const selected: Record<string, string[]> = sent?.filters?.versioning ?? {};
    const kb = selected.agent_version?.includes('v1') ? ['381'] : ['381', '400'];
    const agent = selected.kb_version?.includes('400') ? ['v2'] : ['v1', 'v2', '__empty__'];
    const facets = body.overview?.facets ?? body.facets;
    if (facets) facets.versioning = { agent_version: agent, kb_version: kb };
    await route.fulfill({ response, json: body });
  });
}

test('one facet per versioning key; choosing a value filters, chips and narrows the other key', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 12);
  await mockFacets(page);
  const cap = capture(page, 'runs');
  await openRuns(page, s.project.slug);
  await openFilters(page);
  const panel = page.getByTestId('filters-panel');
  await expect(panel.getByRole('button', { name: /^Agent version\b/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Kb version\b/ })).toBeVisible();

  await openFacet(page, 'Agent version');
  await panel.getByRole('button', { name: 'Only v1' }).click();
  await expect
    .poll(() => listRequests(cap).at(-1)?.body.filters.versioning)
    .toEqual({ agent_version: ['v1'] });
  const chips = page.getByRole('group', { name: 'Active filters', exact: true });
  await expect(chips).toContainText('Agent version: v1');
  await expect(page.getByTestId('filters-trigger')).toContainText('Filters · 1');
  expect(urlParams(page).getAll('v.agent_version')).toEqual(['v1']);
  // The other key's values narrow to what the selection leaves.
  await openFacet(page, 'Kb version');
  await expect(panel.getByRole('checkbox', { name: '381' })).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: '400' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Remove Agent version: v1' }).click();
  await expect.poll(() => urlParams(page).has('v.agent_version')).toBe(false);
  await expect(chips).toHaveCount(0);
  await expect(page.getByTestId('filters-trigger')).not.toContainText('Filters ·');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('the missing-key option reads "Empty / Missing" and survives a reload', async ({ page, request }) => {
  const s = await sharedProject(request, 12);
  await mockFacets(page);
  const cap = capture(page, 'runs');
  await openRuns(page, s.project.slug);
  await openFacet(page, 'Agent version');
  const panel = page.getByTestId('filters-panel');
  await panel.getByRole('button', { name: 'Only Empty / Missing' }).click();
  await expect
    .poll(() => listRequests(cap).at(-1)?.body.filters.versioning)
    .toEqual({ agent_version: ['__empty__'] });
  await expect(panel.getByRole('button', { name: /^Agent version\b/ })).toContainText('Empty / Missing');
  await page.reload();
  await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText(
    'Agent version: empty',
  );
  await expect
    .poll(() => listRequests(cap).at(-1)?.body.filters.versioning)
    .toEqual({ agent_version: ['__empty__'] });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
