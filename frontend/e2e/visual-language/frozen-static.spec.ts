/**
 * Frozen column names must not move when the table scrolls sideways: header cells AND band cells of every pinned
 * column. A frame-by-frame probe (requestAnimationFrame) records the x of every pinned header cell and of its label
 * while real wheel events (large, trackpad-small, and with vertical page scroll mixed in) scroll the table, and
 * fails on any frame where one of them is off its resting x.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { compareUrl } from '../compare/support';
import { runUrl } from '../run-detail/support';
import { seedProjectWithRuns, waitForProjection } from '../runs-list/seed';
import { seedTour, settled, type Tour } from './support';

interface Frame {
  t: number;
  scroll: number;
  /** key -> [cell left, label left] relative to the scroller's left edge */
  x: Record<string, [number, number]>;
}

/**
 * Records only the scroller under test: measuring every table of the gallery on every frame (59 tables now, more
 * after each round) made each probe take 13 s and the gallery test outgrow its budget.
 */
async function startProbe(page: Page, only: Locator): Promise<void> {
  await only.evaluate((el) => {
    (el as HTMLElement).dataset.probe = '1';
  });
  await page.evaluate(() => {
    const w = window as unknown as { __probe: { frames: unknown[]; on: boolean } };
    w.__probe = { frames: [], on: true };
    const tick = () => {
      if (!w.__probe.on) return;
      const x: Record<string, [number, number]> = {};
      let scroll = 0;
      document.querySelectorAll<HTMLElement>('[data-dt-scroller][data-probe]').forEach((sc, si) => {
        const sr = sc.getBoundingClientRect();
        scroll = Math.max(scroll, Math.abs(sc.scrollLeft));
        sc.querySelectorAll<HTMLElement>('thead th[data-pin]').forEach((th, i) => {
          const r = th.getBoundingClientRect();
          const label = th.querySelector<HTMLElement>('[data-th-label]') ?? th;
          const range = document.createRange();
          range.selectNodeContents(label);
          const lr = range.getBoundingClientRect();
          x[`${si}:${i}:${th.dataset.col ?? th.textContent}`] = [r.left - sr.left, lr.left - sr.left];
        });
      });
      (w.__probe.frames as unknown[]).push({ t: performance.now(), scroll, x });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopProbe(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __probe: { frames: Frame[]; on: boolean } };
    w.__probe.on = false;
    document.querySelectorAll<HTMLElement>('[data-probe]').forEach((el) => delete el.dataset.probe);
    return w.__probe.frames;
  });
}

/** "<section heading> / <table label>" so a failing gallery table can be found. */
async function describeTable(scroller: Locator): Promise<string> {
  return scroller.evaluate((el) => {
    const section = el.closest('section');
    const heading = section?.querySelector('h2, h3')?.textContent?.trim() ?? '';
    const table = el.querySelector('[role="grid"], [role="table"], table');
    const label = table?.getAttribute('aria-label') ?? '';
    return [heading, label].filter(Boolean).join(' / ');
  });
}

/** Scrolls like a mouse wheel and like a trackpad (many tiny deltas), sideways and with some vertical mix. */
async function wheelAround(page: Page, over: Locator, vertical: boolean): Promise<void> {
  const b = (await over.boundingBox())!;
  const vh = page.viewportSize()!.height;
  // aim at the part of the table that is on screen
  const top = Math.max(b.y, 0);
  const bottom = Math.min(b.y + b.height, vh);
  await page.mouse.move(b.x + b.width / 2, top + Math.min(Math.max((bottom - top) / 2, 20), 200));
  for (let i = 0; i < 12; i++) await page.mouse.wheel(40, 0); // mouse wheel notches
  await page.waitForTimeout(60);
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(3, vertical && i % 7 === 0 ? 2 : 0); // trackpad: tiny deltas
    if (i % 5 === 0) await page.waitForTimeout(8);
  }
  for (let i = 0; i < 40; i++) await page.mouse.wheel(-5, 0); // and back
  await page.waitForTimeout(150);
}

function assertStatic(frames: Frame[], label: string): void {
  const moved = frames.filter((f) => f.scroll > 20);
  expect(moved.length, `${label}: the table never scrolled sideways`).toBeGreaterThan(3);
  const first = frames[0]!;
  const keys = Object.keys(first.x);
  expect(keys.length, `${label}: no pinned header cells to probe`).toBeGreaterThan(0);
  const worst: string[] = [];
  for (const k of keys) {
    for (const f of frames) {
      const cur = f.x[k];
      if (!cur) continue;
      const dx = Math.max(Math.abs(cur[0] - first.x[k]![0]), Math.abs(cur[1] - first.x[k]![1]));
      if (dx > 0.5) {
        worst.push(`${k} moved ${dx.toFixed(2)}px at scroll ${Math.round(f.scroll)}`);
        break;
      }
    }
  }
  expect(worst, `${label}: pinned header cells moved`).toEqual([]);
}

/** The first scroller that overflows sideways and has frozen header cells. */
async function pinnedScroller(page: Page): Promise<Locator | null> {
  const all = page.locator('[data-dt-scroller]');
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const sc = all.nth(i);
    const ok = await sc.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 50 && el.querySelector('thead th[data-pin]') !== null,
    );
    if (ok) return sc;
  }
  return null;
}

async function probe(page: Page, scroller: Locator, label: string, vertical = false): Promise<void> {
  await scroller.scrollIntoViewIfNeeded();
  await settled(page).catch(() => undefined);
  await startProbe(page, scroller);
  await page.waitForTimeout(100);
  await wheelAround(page, scroller, vertical);
  assertStatic(await stopProbe(page), label);
}

let tour: Tour;
let runsSlug = '';
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  tour = await seedTour();
  const seeded = await seedProjectWithRuns(request, { count: 14, running: false });
  await waitForProjection(request, seeded.project.slug, seeded.runs.length);
  runsSlug = seeded.project.slug;
  void uniqueSlug;
});

test.describe('frozen names stay put on real scrolling', () => {
  test.setTimeout(600_000);
  for (const width of [1440, 1000]) {
    test(`runs list at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, `/projects/${runsSlug}`);
      const scroller = page.getByTestId('runs-table').locator('[data-dt-scroller]').first();
      await expect(scroller).toBeVisible();
      await probe(page, scroller, `runs ${width}`);
      // the band cell above the frozen columns is pinned too
      await expect(
        page
          .getByTestId('runs-table')
          .locator('thead th.bandCell[data-pin], thead th[scope="colgroup"][data-pin]'),
      ).not.toHaveCount(0);
    });
  }

  test('runs list with a passes panel open', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${tour.slug}`);
    const scroller = page.getByTestId('runs-table').locator('[data-dt-scroller]').first();
    await expect(scroller).toBeVisible();
    await probe(page, scroller, 'runs with panel', true);
  });

  test('charts table', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await gotoApp(page, `/projects/${runsSlug}/charts`);
    await expect(page.getByTestId('charts-page')).toBeVisible();
    const scroller = await pinnedScroller(page);
    test.skip(!scroller, 'the charts table has no frozen columns here');
    await probe(page, scroller!, 'charts');
  });

  test('run detail items (page scroller sticky header)', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await gotoApp(page, runUrl(tour.slug, tour.runId));
    await expect(page.getByTestId('items-count')).toBeVisible();
    const scroller = await pinnedScroller(page);
    test.skip(!scroller, 'the items table has no frozen columns here');
    await probe(page, scroller!, 'run detail', true);
  });

  test('compare matrix', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await gotoApp(page, compareUrl(tour.compareIds));
    await expect(page.getByTestId('item-list')).toBeVisible({ timeout: 20_000 });
    const scroller = await pinnedScroller(page);
    test.skip(!scroller, 'the compare table has no frozen columns here');
    await probe(page, scroller!, 'compare', true);
  });

  test('every frozen header of the /__ui gallery is narrower than its scroller', async ({ page }) => {
    // A sticky cell stays inside its row: a frozen column wider than the scroller scrolls away with the content.
    // (The Experiments mock, `minWidth` 1000 with a frozen flex name, had a 680 px name in a 588 px scroller.)
    await page.setViewportSize({ width: 660, height: 900 });
    await gotoApp(page, '/__ui');
    await page.locator('[data-dt-scroller]').first().waitFor();
    const wide = await page
      .locator('[data-dt-scroller]')
      .evaluateAll((scrollers) =>
        scrollers.flatMap((sc, i) =>
          Array.from(sc.querySelectorAll<HTMLElement>('thead th[data-pin]'))
            .filter((th) => th.getBoundingClientRect().width > sc.clientWidth * 0.75)
            .map(
              (th) =>
                `table ${i}: ${th.dataset.col} ${Math.round(th.getBoundingClientRect().width)} of ${sc.clientWidth}`,
            ),
        ),
      );
    expect(wide, 'frozen header cells wider than 75% of their scroller').toEqual([]);
  });

  test('every table of the /__ui gallery', async ({ page }) => {
    // Each probed table costs about 12 s of wheel events (the renderer acknowledges each one); the gallery had 59
    // scrollers, 23 of them frozen and overflowing, in October 2026. The budget follows the gallery, not the tables.
    test.setTimeout(480_000);
    await page.setViewportSize({ width: 660, height: 900 });
    await gotoApp(page, '/__ui');
    await page.locator('[data-dt-scroller]').first().waitFor();
    await page.getByLabel('Reorderable columns').first().scrollIntoViewIfNeeded();
    const scrollers = page.locator('[data-dt-scroller]');
    const n = await scrollers.count();
    let probed = 0;
    for (let i = 0; i < n; i++) {
      const sc = scrollers.nth(i);
      const ok = await sc.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 10 && el.querySelector('thead th[data-pin]') !== null,
      );
      if (!ok) continue;
      await sc.scrollIntoViewIfNeeded();
      await probe(page, sc, `gallery table ${i} (${await describeTable(sc)})`);
      probed++;
    }
    expect(probed, 'no pinned, overflowing gallery table to probe').toBeGreaterThan(0);
  });
});
