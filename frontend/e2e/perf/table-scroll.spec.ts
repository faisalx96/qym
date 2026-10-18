/**
 * Perf round 6, part A (criteria A1 to A6, A9 to A12, A14): scrolling the two tables.
 * Runs on the Vite dev server (unminified, slower than the production build the numbers in
 * docs/internal/ui-migration/perf6/impl-notes.md come from), so times carry the CI margins; counts are exact.
 */
import { test, expect, type Page } from '@playwright/test';
import { seedProjectWithRuns } from '../runs-list/seed';
import { openRuns } from '../runs-list/support';
import { waitForProjection } from '../runs-list/seed';
import { openRun, seedClassic, seedProject, showItems } from '../run-detail/support';
import { COMMIT_HOOK, commits, frames, limit, median, traced } from './support';

test.describe.configure({ mode: 'serial' });

const PINS = `localStorage.setItem('qym:data-table:v2:runs.v2', JSON.stringify({widths:{},hidden:null,pins:{'metric-quality':'start','metric-exact_match':'start'},order:null,density:null,collapsed:[]}));`;

async function wheel(page: Page, dx: number, dy: number, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(16);
  }
}

test.describe('runs table: frozen columns', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('scrolls sideways with no React work, few sticky layers and no pop', async ({ page, request }) => {
    const s = await seedProjectWithRuns(request, { count: 30 });
    await waitForProjection(request, s.project.slug, s.runs.length);
    await page.addInitScript(COMMIT_HOOK);
    await page.addInitScript(PINS);
    await openRuns(page, s.project.slug);
    const scroller = page.getByTestId('runs-table').locator('[data-dt-scroller]');
    await expect.poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(200);
    await page.waitForTimeout(900);

    // A9: the header is one sticky element (not one per cell); amended at 50 rows: <= 270 sticky layers
    const rows = await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').count();
    expect(rows).toBeLessThanOrEqual(50);
    const sticky = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[data-testid="runs-table"] *')).filter(
          (e) => getComputedStyle(e).position === 'sticky',
        ).length,
    );
    expect(sticky).toBeLessThanOrEqual(270);

    // A12: nothing but opacity transitions while scrolling
    await page.evaluate(() => {
      const w = window as unknown as { __tr: string[] };
      w.__tr = [];
      document.addEventListener(
        'transitionstart',
        (e) => w.__tr.push(`${(e.target as Element).tagName}:${e.propertyName}`),
        true,
      );
    });

    const box = (await page.locator('[data-testid="runs-table"] tbody').boundingBox())!;
    await page.mouse.move(box.x + 500, box.y + 40);
    const before = await commits(page);
    const cdp = await page.context().newCDPSession(page);
    const trace = await traced(cdp, () => wheel(page, 60, 0, 60));
    // A3: no React commit from scrolling
    expect((await commits(page)) - before).toBeLessThanOrEqual(limit(1, 0));
    // A2: no layout read in the scroll path
    expect(trace.layoutsInScroll).toBe(0);
    // A1 (runs): the handler does almost nothing
    expect(trace.scrollMsMedian).toBeLessThanOrEqual(limit(2.5, 1));
    const tr = await page.evaluate(() => (window as unknown as { __tr: string[] }).__tr);
    expect(tr.filter((t) => !t.endsWith(':opacity'))).toEqual([]);

    // A10/A11: frozen cells sit on their header cells at ten positions (LTR), and under dir=rtl
    const align = async (): Promise<number> =>
      page.evaluate(() => {
        const sc = document.querySelector('[data-testid="runs-table"] [data-dt-scroller]') as HTMLElement;
        const max = sc.scrollWidth - sc.clientWidth;
        let worst = 0;
        for (let i = 0; i < 10; i++) {
          sc.scrollLeft = ((i + 1) / 10) * max * (getComputedStyle(sc).direction === 'rtl' ? -1 : 1);
          for (const col of ['run', 'status', 'metric-quality', 'metric-exact_match']) {
            const th = document.querySelector(`[data-testid="runs-table"] thead th[data-col="${col}"]`);
            const td = document.querySelector(`[data-testid="runs-table"] tbody td[data-col="${col}"]`);
            if (!th || !td) continue;
            worst = Math.max(
              worst,
              Math.abs(th.getBoundingClientRect().left - td.getBoundingClientRect().left),
            );
          }
        }
        return worst;
      });
    expect(await align()).toBeLessThanOrEqual(0.5);
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
      document.querySelector('[data-testid="runs-table"]')!.closest('[dir]')?.setAttribute('dir', 'rtl');
    });
    expect(await align()).toBeLessThanOrEqual(0.5);
    await cdp.detach();
  });

  test('the edge shadow is one element that fades (no per-cell box-shadow swap)', async ({
    page,
    request,
  }) => {
    const s = await seedProjectWithRuns(request, { count: 12 });
    await waitForProjection(request, s.project.slug, s.runs.length);
    await page.addInitScript(PINS);
    await openRuns(page, s.project.slug);
    const edge = page.getByTestId('runs-table').locator('[data-edge="start"]');
    const cell = page.locator('[data-testid="runs-table"] tbody td[data-pin-edge="start"]').first();
    await expect(edge).toHaveCSS('opacity', '0');
    const shadowBefore = await cell.evaluate((e) => getComputedStyle(e).boxShadow);
    const scroller = page.getByTestId('runs-table').locator('[data-dt-scroller]');
    await scroller.evaluate((el) => el.scrollTo({ left: 120 }));
    await expect(scroller).toHaveAttribute('data-scrolled-x', '');
    await expect
      .poll(async () => Number(await edge.evaluate((e) => getComputedStyle(e).opacity)))
      .toBeGreaterThan(0.5);
    // no pinned cell changed its box-shadow when scrolling started (the old rule swapped it on every pinned-edge cell)
    expect(await cell.evaluate((e) => getComputedStyle(e).boxShadow)).toBe(shadowBefore);
  });
});

test.describe('items table: sticky header', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('scrolls 300 items with few commits, no handler layout reads and a header that stays put', async ({
    page,
  }) => {
    const s = await seedProject('perf-items');
    const runId = await seedClassic(s, { items: 300, traced: 3 });
    await page.addInitScript(COMMIT_HOOK);
    await openRun(page, s.slug, runId);
    await showItems(page);
    await page.waitForTimeout(900);
    const box = (await page.locator('tbody').first().boundingBox())!;
    await page.mouse.move(box.x + 400, 500);

    const headerError = () =>
      page.evaluate(() => {
        const nav = document.querySelector('[data-run-nav]') as HTMLElement;
        const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
        const line = Math.max(
          nav.getBoundingClientRect().bottom,
          filters && getComputedStyle(filters).position === 'sticky'
            ? filters.getBoundingClientRect().bottom
            : 0,
        );
        const th = document.querySelector('[role=treegrid][aria-label=Items] thead th') as HTMLElement;
        const table = th.closest('table') as HTMLElement;
        return table.hasAttribute('data-stuck') ? Math.abs(th.getBoundingClientRect().top - line) : 0;
      });
    const cdp = await page.context().newCDPSession(page);
    const passes: Array<{ commits: number; handler: number; layouts: number }> = [];
    let headerErr = 0;
    for (let pass = 0; pass < 3; pass++) {
      const c0 = await commits(page);
      const trace = await traced(cdp, () => wheel(page, 0, 60, 60));
      passes.push({
        commits: (await commits(page)) - c0,
        handler: trace.scrollMsMedian,
        layouts: trace.layoutsInScroll,
      });
      await page.waitForTimeout(150); // the last scroll event has been handled
      // A10: the header holds the sticky line (within 1 px of the line under the bars) after every pass
      headerErr = Math.max(headerErr, await headerError());
      await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(150);
    }
    // A4: about one commit per window of rows crossed, never per scroll event (60 events per pass)
    expect(median(passes.map((p) => p.commits))).toBeLessThanOrEqual(limit(40, 20));
    // A2: at most the layout reads of the few commits that move the row window (none from handlers)
    expect(median(passes.map((p) => p.layouts))).toBeLessThanOrEqual(8);
    // A1: dev server margin; the production numbers are in impl-notes.md
    expect(median(passes.map((p) => p.handler))).toBeLessThanOrEqual(limit(5, 1));
    expect(headerErr).toBeLessThanOrEqual(1);
    await cdp.detach();
  });

  test('frames: fewer dropped frames at 4x CPU than the budget', async ({ page }) => {
    const s = await seedProject('perf-items-cpu');
    const runId = await seedClassic(s, { items: 300 });
    await openRun(page, s.slug, runId);
    await showItems(page);
    await page.waitForTimeout(900);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const box = (await page.locator('tbody').first().boundingBox())!;
    await page.mouse.move(box.x + 400, 500);
    const r = await frames(page, () => wheel(page, 0, 60, 60));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // A5, amended: <= 26 local (measured 24 on the production build), 40 on the dev server
    expect(r.dropped).toBeLessThanOrEqual(limit(40, 26));
    await cdp.detach();
  });
});
