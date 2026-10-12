/// <reference lib="dom" />
/**
 * Cutover of test_access_admin_browser.py::test_deleted_runs_pages_filters_and_keeps_restore_in_view:
 * with long run, dataset and model names the Restore button stays inside the table at laptop widths
 * and the rows stay one line high. (Paging, the project facet and restore-selection are in trash.spec.ts.)
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { seedTrash } from './support';

for (const width of [1280, 1440]) {
  test(`Restore stays in view and rows stay compact at ${width}px`, async ({ page, request }) => {
    // The Restore column is pinned to the end of the table (TrashPage.module.css), so it stays in view.
    const prefix = `qwen2.5-72b_insightor_arabic_subset_${Date.now().toString(36)}`;
    await seedTrash(request, prefix, 3);
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, `/trash?q=${prefix}`);
    const grid = page.getByRole('grid', { name: 'Deleted runs' });
    await expect(grid.locator('[role=row]:has([role=gridcell])')).toHaveCount(3);
    const layout = await page.evaluate(() => {
      const g = document.querySelector('[role=grid][aria-label="Deleted runs"]') as HTMLElement;
      const buttons = Array.from(g.querySelectorAll<HTMLElement>('[data-testid^="restore-"]'));
      const rows = Array.from(g.querySelectorAll<HTMLElement>('[role=row]')).filter((r) =>
        r.querySelector('[role=gridcell]'),
      );
      return {
        count: buttons.length,
        // fully visible: inside the viewport and inside every clipping ancestor
        inView: buttons.every((b) => {
          const r = b.getBoundingClientRect();
          if (r.left < -0.5 || r.right > window.innerWidth + 0.5) return false;
          for (let n = b.parentElement; n; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === 'visible') continue;
            const c = n.getBoundingClientRect();
            if (r.left < c.left - 0.5 || r.right > c.right + 0.5) return false;
          }
          return true;
        }),
        maxRow: Math.max(...rows.map((r) => r.getBoundingClientRect().height)),
      };
    });
    expect(layout.count).toBe(3);
    expect(layout.inView, JSON.stringify(layout)).toBe(true);
    expect(layout.maxRow, JSON.stringify(layout)).toBeLessThanOrEqual(56);
  });
}

test('a deleted reasoning-model run carries the reasoning badge and Task/Dataset fit at 1440px', async ({
  page,
  request,
}) => {
  const prefix = `reason_${Date.now().toString(36)}`;
  await seedTrash(request, prefix, 1);
  await page.route(/\/api\/runs\/trash\?/, async (route) => {
    const res = await route.fetch();
    const runs = (await res.json()) as { trace_stats: Record<string, unknown> | null }[];
    await route.fulfill({
      response: res,
      json: runs.map((r) => ({ ...r, trace_stats: { ...(r.trace_stats ?? {}), has_reasoning: true } })),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, `/trash?q=${prefix}`);
  const grid = page.getByRole('grid', { name: 'Deleted runs' });
  const body = grid.locator('[role=row]:has([role=gridcell])').first();
  await expect(body).toContainText('reasoning');
  const fits = await page.evaluate(() => {
    const g = document.querySelector('[role=grid][aria-label="Deleted runs"]') as HTMLElement;
    const heads = Array.from(g.querySelectorAll<HTMLElement>('[role=columnheader]')).filter((h) =>
      /Task|Dataset/.test(h.textContent ?? ''),
    );
    return heads.length === 2 && heads.every((h) => h.getBoundingClientRect().right <= window.innerWidth);
  });
  expect(fits).toBe(true);
});
