/**
 * Topbar KPI chips (cutover of test_runs_kpis_browser.py). The numbers themselves are
 * pinned at the API in tests/platform/test_runs_kpis.py + test_dashboard_kpis.py; here
 * the chips' layout beside the breadcrumb and the scope label are checked in the browser.
 */
import { test, expect, type Page } from '@playwright/test';
import { APP } from '../helpers';
import { openFacet, openRuns, sharedProject } from './support';

const ORDER = [/runs?$/, /execution success$/, /runs? with errors$/, /models?$/, /items?$/];

async function chips(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-topbar-stats]') as HTMLElement;
    const crumb = document.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
    const crumbRight = crumb.getBoundingClientRect().right;
    // React clips the chips that do not fit (overflow: hidden) instead of dropping them whole.
    return Array.from(bar.children)
      .map((chip) => ({ el: chip as HTMLElement, box: chip.getBoundingClientRect() }))
      .filter(({ box, el }) => getComputedStyle(el).display !== 'none' && box.width > 0)
      .map(({ el, box }) => ({
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        clearOfBreadcrumb: box.left >= crumbRight - 0.5,
      }));
  });
}

for (const width of [1100, 900, 768]) {
  test(`topbar KPIs never cover the breadcrumb at ${width}px (Runs and Overview)`, async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['', '/overview']) {
      await page.goto(`${APP}/projects/${s.project.slug}${path}`);
      await expect(page.locator('[data-topbar-stats]')).toBeVisible();
      const shown = await chips(page);
      expect(shown.length, `${width}${path}`).toBeGreaterThan(1);
      for (const chip of shown) {
        expect(chip.clearOfBreadcrumb, `${width}${path}: ${chip.text} overlaps the breadcrumb`).toBe(true);
      }
      // The scope leads, then the chips in their fixed order.
      expect(shown[0]!.text).toBe('All runs');
      shown.slice(1).forEach((chip, i) => expect(chip.text).toMatch(ORDER[i]!));
    }
  });
}

test('the topbar states the active filter scope', async ({ page, request }) => {
  const s = await sharedProject(request, 12);
  await openRuns(page, s.project.slug);
  const bar = page.locator('[data-topbar-stats]');
  await expect(bar).toContainText('All runs');
  await openFacet(page, 'Tasks');
  await page
    .getByTestId('filters-panel')
    .getByRole('button', { name: /^Only / })
    .first()
    .click();
  await expect(bar).toContainText('Filtered runs');
  await expect(bar).toHaveAttribute('aria-label', 'Totals across the runs that match the active filters.');
});
