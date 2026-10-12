/// <reference lib="dom" />
/**
 * Cutover of test_p1_final_fixes_browser.py::test_deep_linked_item_header_lands_below_the_section_nav:
 * a deep-linked item opens with its header fully in the content area, not under the
 * top bar or any other fixed chrome, at the widths the old test used.
 */
import { test, expect } from '@playwright/test';
import { openRun, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-deeplink');
  classic = await seedClassic(s);
});

for (const width of [600, 1280, 1440]) {
  test(`?item= lands with the header uncovered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRun(page, s.slug, classic, 'item=item-0100');
    const card = page.locator('[data-testid=item-card][data-item-id="item-0100"]');
    await expect(card).toBeVisible();
    await expect(card).toBeInViewport();
    // the scroll settles (the landing may correct itself once)
    await page.waitForTimeout(800);
    const geometry = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=item-card][data-item-id="item-0100"]') as HTMLElement;
      const scroller = document.getElementById('shell-content') as HTMLElement;
      const rect = el.getBoundingClientRect();
      const area = scroller.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + 40, rect.top + Math.min(20, rect.height / 2));
      return { top: rect.top, areaTop: area.top, covered: !(hit && el.contains(hit)) };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.areaTop - 1);
    expect(geometry.covered, JSON.stringify(geometry)).toBe(false);
  });
}
