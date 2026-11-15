/// <reference lib="dom" />
/**
 * Cutover of test_p1_final_fixes_browser.py::test_deep_linked_item_header_lands_below_the_section_nav:
 * a deep-linked item opens with its header fully in the content area, not under the
 * top bar or any other fixed chrome, at the widths the old test used. The item opens in the pane at
 * the side now: the test checks the pane header and the row of the item.
 */
import { test, expect } from '@playwright/test';
import { itemPane, openRun, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-deeplink');
  classic = await seedClassic(s);
});

for (const width of [600, 1280, 1440]) {
  test(`?item= lands with the pane header and the item row uncovered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRun(page, s.slug, classic, 'item=item-0100');
    // the item opens in the pane at the side (a portal on the body); its row is a <tr>, or a card below 640 px
    const pane = itemPane(page, 'item-0100');
    await expect(pane).toBeVisible();
    await expect(pane).toBeInViewport();
    const row = page.locator('#run-items [data-item-id="item-0100"]');
    await expect(row).toBeVisible();
    // the scroll settles (the landing may correct itself once)
    await page.waitForTimeout(800);
    await expect(row).toBeInViewport();
    const geometry = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=item-pane][data-item-id="item-0100"]') as HTMLElement;
      const scroller = document.getElementById('shell-content') as HTMLElement;
      const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
      const rect = el.getBoundingClientRect();
      const area = scroller.getBoundingClientRect();
      // a point in the pane header (the item number is at its start)
      const hit = document.elementFromPoint(rect.left + 40, rect.top + Math.min(20, rect.height / 2));
      const item = document.querySelector('#run-items [data-item-id="item-0100"]') as HTMLElement;
      return {
        top: rect.top,
        areaTop: area.top,
        navBottom: nav ? nav.getBoundingClientRect().bottom : area.top,
        rowTop: item.getBoundingClientRect().top,
        covered: !(hit && el.contains(hit)),
      };
    });
    // the pane starts under the top bar and the sticky section nav, and nothing lies over its header
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.areaTop - 1);
    expect(geometry.covered, JSON.stringify(geometry)).toBe(false);
    // the row of the item is not under the sticky section nav
    expect(geometry.rowTop, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.navBottom - 1);
  });
}
