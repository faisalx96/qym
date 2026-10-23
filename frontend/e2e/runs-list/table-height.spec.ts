/// <reference lib="dom" />
/**
 * Runs table height: the table card fills the content area down to the page's bottom edge (its body scrolls
 * inside) instead of stopping at a viewport-based cap and leaving empty space below the footer.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { dataRows, freshProject, openRuns } from './support';

const SHOTS = process.env.QYM_SHOTS_DIR;

async function measure(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const r = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
    };
    const content = document.querySelector('[data-shell-content]')!;
    const table = document.querySelector('[data-testid="runs-table"]');
    const footer = document.querySelector('[data-dt-footer]');
    // The body's scroll container: the DataTable scroller on wide screens, the card list's own scroller at 390.
    const scroller = table
      ? (Array.from(table.querySelectorAll('*')).find((n) => {
          const o = getComputedStyle(n).overflowY;
          return (o === 'auto' || o === 'scroll') && n.clientHeight > 100;
        }) ?? null)
      : null;
    const rows = document.querySelectorAll('[data-testid="runs-table"] tr[data-run-id], [data-testid="runs-table"] li[data-run-id]').length;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      content: r(content),
      contentScroll: { scrollHeight: content.scrollHeight, clientHeight: content.clientHeight },
      table: r(table),
      scroller: r(scroller),
      scrollerScroll: scroller ? { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight } : null,
      footer: r(footer),
      rows,
      gapBelowTable: table ? Math.round((content.getBoundingClientRect().bottom - table.getBoundingClientRect().bottom) * 10) / 10 : null,
    };
  });
}

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

test.describe('runs table fills the page height', () => {
  for (const vp of VIEWPORTS) {
    test(`many runs at ${vp.width}x${vp.height}: the card reaches the bottom, its body scrolls`, async ({ page, request }) => {
      const s = await freshProject(request, 60, { running: false });
      await page.setViewportSize(vp);
      await openRuns(page, s.project.slug, '?pageSize=100');
      await expect.poll(() => dataRows(page).count(), { timeout: 20_000 }).toBeGreaterThan(20);
      const m = await measure(page);
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        fs.writeFileSync(path.join(SHOTS, `runs-height-many-${vp.width}.json`), JSON.stringify(m, null, 2));
        await page.screenshot({ path: path.join(SHOTS, `runs-height-many-${vp.width}.png`) });
      }
      test.info().annotations.push({ type: 'measure', description: JSON.stringify(m) });
      expect(m.table).not.toBeNull();
      // Criterion RH-1: the table card ends one page padding (8 px) above the content area's bottom edge.
      expect(m.gapBelowTable!, 'gap below the table').toBeGreaterThanOrEqual(7);
      expect(m.gapBelowTable!, 'gap below the table').toBeLessThanOrEqual(9);
      // Criterion RH-2: the page itself does not scroll; the table body does.
      expect(m.contentScroll.scrollHeight - m.contentScroll.clientHeight, 'page scroll').toBeLessThanOrEqual(1);
      expect(m.scrollerScroll!.scrollHeight, 'body scrolls inside').toBeGreaterThan(m.scrollerScroll!.clientHeight);
    });
  }

  test('few runs at 1440x900: the card is as tall as its rows, nothing scrolls', async ({ page, request }) => {
    const s = await freshProject(request, 3, { running: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRuns(page, s.project.slug);
    await expect(page.locator('[data-testid="runs-table"] tbody tr').nth(2)).toBeAttached({ timeout: 20_000 });
    const m = await measure(page);
    if (SHOTS) {
      fs.writeFileSync(path.join(SHOTS, `runs-height-few-1440.json`), JSON.stringify(m, null, 2));
      await page.screenshot({ path: path.join(SHOTS, `runs-height-few-1440.png`) });
    }
    test.info().annotations.push({ type: 'measure', description: JSON.stringify(m) });
    // Criterion RH-3: with three rows the body has no scrollbar and the page has none either.
    expect(m.scrollerScroll!.scrollHeight - m.scrollerScroll!.clientHeight).toBeLessThanOrEqual(1);
    expect(m.contentScroll.scrollHeight - m.contentScroll.clientHeight).toBeLessThanOrEqual(1);
  });
});
