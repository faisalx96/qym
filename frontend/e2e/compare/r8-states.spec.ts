/** Round 8: loading frame, empty and error states (C-state-1..3). */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl, waitLoaded } from './support';
import { box, noSidewaysScroll, part, seedR8, within, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-states');
});

/** Hold /api/compare for `ms` so the loading frame can be measured, then release it. */
async function slowCompare(page: Page, ms: number) {
  await page.route('**/api/compare?*', async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

for (const width of [1440, 390]) {
  test(`C-state-1: the loading frame has the loaded height for Runs and Averages at ${width} and nothing jumps`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>)
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await slowCompare(page, 2500);
    await page.goto(compareUrl(s.four));
    const frame = page.getByTestId('compare-skeleton');
    await expect(frame).toBeVisible();
    await expect(part(page, 'run-grid').locator('[role="status"]')).toHaveCount(4);
    within((await box(part(page, 'run-grid').locator('[role="status"]').first())).h, width === 1440 ? 242 : 232, 4, 'run placeholder');
    const loading = {
      runs: (await box(part(page, 'section-runs'))).h,
      averages: (await box(part(page, 'section-averages'))).h,
      overview: (await box(part(page, 'section-overview'))).h,
    };
    const rows = await part(page, 'section-items').locator('[role="status"] > *').count();
    expect(rows).toBe(20);
    await waitLoaded(page);
    const loaded = {
      runs: (await box(part(page, 'section-runs'))).h,
      averages: (await box(part(page, 'section-averages'))).h,
      overview: (await box(part(page, 'section-overview'))).h,
    };
    within(loading.runs, loaded.runs, 1, 'Runs section height');
    within(loading.averages, loaded.averages, 1, 'Averages section height');
    if (width === 1440) within(loading.overview, loaded.overview, 6, 'Overview section height');
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, 'cumulative layout shift').toBeLessThan(0.05);
  });
}

test('C-state-1: the placeholder count follows the runs in the URL', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await slowCompare(page, 2000);
  await page.goto(compareUrl(s.eight));
  await expect(part(page, 'run-grid').locator('[role="status"]')).toHaveCount(8);
});

test('C-state-2: fewer than two runs: a plain empty state that fits 390 without scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(compareUrl([s.seed.runs.base]));
  await expect(page.getByText('No runs to compare')).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to runs/ })).toBeVisible();
  await noSidewaysScroll(page);
  const [sh, ch] = await page.locator('#shell-content').evaluate((e) => [e.scrollHeight, e.clientHeight]);
  expect(sh).toBeLessThanOrEqual(ch + 1);
});

test('C-state-3: runs missing: the count, up to five ids then "+ N more", a Back link, no sideways scroll at 390', async ({
  page,
}) => {
  const ids = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i + 10)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(compareUrl(ids));
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(/Runs in this comparison were not found/);
  await expect(alert).toContainText('7 of the runs in this link were deleted or are not visible to you');
  for (const id of ids.slice(0, 5)) await expect(alert).toContainText(id);
  await expect(alert).not.toContainText(ids[5]!);
  await expect(alert).toContainText('+ 2 more');
  await expect(alert).toContainText('404');
  await expect(page.getByRole('link', { name: /Back to runs/ })).toBeVisible();
  await noSidewaysScroll(page);
});
