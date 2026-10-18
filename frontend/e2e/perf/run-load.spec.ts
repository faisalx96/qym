/**
 * Perf round 6, part B (B1 to B4, B6): the run page paints in stages. The rows request is held for a fixed time, so the
 * assertions are about order and layout stability, not about how fast this machine is; the timings against the
 * production build (warm and cold chunk, Fast 3G) are measured by docs/internal/ui-migration/perf6/measure/load-run.mts
 * and recorded in impl-notes.md.
 */
import { test, expect, type Page } from '@playwright/test';
import { seedProjectWithRuns } from '../runs-list/seed';
import { openRuns } from '../runs-list/support';
import { waitForProjection } from '../runs-list/seed';
import { seedClassic, seedProject, runUrl } from '../run-detail/support';
import { limit } from './support';

const SHIFT_OBSERVER = `
window.__cls = 0;
new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
  .observe({ type: 'layout-shift', buffered: true });`;

const cls = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __cls: number }).__cls);

test.use({ viewport: { width: 1440, height: 900 } });

test('from the runs list the header paints at once, the sections hold their height until the rows arrive', async ({
  page,
  request,
}) => {
  // a run reachable from the list (its row is the stage-0 header)
  const s = await seedProjectWithRuns(request, { count: 6 });
  await waitForProjection(request, s.project.slug, s.runs.length);
  await page.addInitScript(SHIFT_OBSERVER);
  await openRuns(page, s.project.slug);
  const target = s.runs[0]!;

  // hold the rows (stage 2) for 1.2 s; the summary (stage 1) answers at once
  let rowsAnswered = 0;
  await page.route('**/api/runs/*?view=compact&fields=scores*', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    // (the dev server's StrictMode may abort a first request: only answered ones count)
    await route.continue().then(
      () => rowsAnswered++,
      () => undefined,
    );
  });

  const link = page.getByTestId('runs-table').locator(`a[href*="/runs/${target.id}"]`).first();
  await link.click();
  // B1: the header (name, task, dataset, model) is on screen long before the rows
  const hero = page.getByTestId('run-hero');
  await expect(hero).toBeVisible({ timeout: limit(2000, 1000) });
  await expect(hero.getByRole('heading', { level: 1 })).not.toHaveText('');
  // the rows are still held: the Overview and the Items are skeletons, the nav lists the sections
  await expect(page.locator('#run-section-overview [role="status"]')).toBeVisible();
  await expect(page.getByTestId('items-count')).toHaveCount(0);
  // B3: then the Overview content and the Items table arrive
  await expect(page.getByTestId('metric-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('items-count')).toBeVisible({ timeout: 20_000 });
  // B13: the Items rows paint with the Overview's data, not after the texts (the production numbers are in impl-notes.md)
  await expect(page.locator('tbody tr[data-item-id]').first()).toBeVisible({ timeout: limit(8000, 3000) });
  await page.waitForTimeout(600);
  // one rows request (core groups); the dev server's StrictMode remount may answer a cancelled first one too,
  // the production build asks once (impl-notes.md, load-run.mts)
  expect(rowsAnswered).toBeLessThanOrEqual(2);
  // B6: no layout jump across stage 0 -> 1 -> 2
  expect(await cls(page)).toBeLessThanOrEqual(limit(0.03, 0.02));
});

test('a deep link asks for its data without waiting for the page chunk', async ({ page }) => {
  const s = await seedProject('perf-deep');
  const runId = await seedClassic(s, { items: 40 });
  const starts: Array<{ url: string; t: number }> = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/runs/') || /RunDetailPage/.test(u.pathname))
      starts.push({ url: u.pathname + u.search, t: Date.now() });
  });
  await page.goto(runUrl(s.slug, runId));
  await expect(page.getByTestId('items-count')).toBeVisible();
  const rows = starts.find((r) => r.url.includes('view=compact&fields='));
  const chunk = starts.find((r) => /RunDetailPage/.test(r.url));
  expect(rows, 'the rows request').toBeTruthy();
  expect(chunk, 'the page chunk request').toBeTruthy();
  // B2/B5: the data request starts with the chunk (the old page started it after the chunk had run)
  expect(rows!.t - chunk!.t).toBeLessThan(limit(1500, 400));
});
