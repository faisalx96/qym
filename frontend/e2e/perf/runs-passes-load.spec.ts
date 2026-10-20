/// <reference lib="dom" />
/**
 * Redesign round 7, Q2 (docs/internal/ui-migration/redesign7/qa.md): loading the passes of a repeat run on the runs page.
 * The page warms the passes and the strip statistics of its finished repeat runs after the list has settled, so a click finds
 * them in the cache; a run nobody prefetched still costs two requests (`/passes` and `group-metrics?view=group`) and no
 * bootstrap; the loading frame has the loaded height. Runs on the Vite dev server (slower than the production build the
 * numbers in impl-notes.md come from), so times carry the CI margin and counts are exact (criteria Q2-4 to Q2-10, Q2-12).
 */
import { test, expect, type APIRequestContext, type Page, type Request } from '@playwright/test';
import { seedR7, type SeededR7 } from '../runs-list/seed';
import { openRuns, table, withoutPrefetch } from '../runs-list/support';
import { limit } from './support';

const g = globalThis as unknown as { __r7Passes?: Promise<SeededR7> };
const seeded = (request: APIRequestContext): Promise<SeededR7> =>
  (g.__r7Passes ??= seedR7(request, {
    repeat: 4,
    items: 24,
    passes19: true,
    classic: 2,
    slugPrefix: 'r7pass',
  }));

const isPasses = (u: string) => /\/api\/runs\/[^/?]+\/passes(\?|$)/.test(u);
const isGroup = (u: string) => /\/api\/runs\/[^/?]+\/group-metrics/.test(u);
const isPrefetchApi = (u: string) => isPasses(u) || isGroup(u);

interface Logged {
  url: string;
  start: number;
  end: number;
  /** Aborted before an answer: the dev server's StrictMode remounts a query and cancels its first request. */
  failed?: boolean;
}

/** Every API request of the page with its start and end time (ms since the log began). */
function logApi(page: Page): { all: Logged[]; reset: () => void } {
  let t0 = Date.now();
  const all: Logged[] = [];
  const open = new Map<Request, Logged>();
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/')) return;
    const entry = { url: url.pathname + url.search, start: Date.now() - t0, end: NaN };
    open.set(r, entry);
    all.push(entry);
  });
  const done = (r: Request, failed = false) => {
    const entry = open.get(r);
    if (entry) {
      entry.end = Date.now() - t0;
      if (failed) entry.failed = true;
    }
  };
  page.on('requestfinished', (r) => done(r));
  page.on('requestfailed', (r) => done(r, true));
  return {
    all,
    reset: () => {
      all.length = 0;
      t0 = Date.now();
    },
  };
}

const chevron = (page: Page, name: string, samples = 10, open = false) =>
  page.getByRole('button', { name: `${open ? 'Collapse' : 'Expand'} ${samples} passes of ${name}` });

/** Click a chevron and read, in the page, when its pass rows and its strip statistics were painted (ms from the click). */
async function openTimed(
  page: Page,
  name: string,
  runId: string,
  samples: number,
): Promise<{
  rows: number;
  strip: number;
  placeholders: number | null;
  hPlaceholders: number | null;
  hRows: number;
  hBefore: number;
  stripFrame: number | null;
  stripLoaded: number;
}> {
  await page.evaluate(() => {
    const w = window as unknown as { __open?: unknown };
    delete w.__open;
  });
  return page.evaluate(
    ({ id, k }) =>
      new Promise((resolve) => {
        const root = document.querySelector('[data-testid="runs-table"]')!;
        const tableEl = () => root.querySelector('table')!;
        const hBefore = tableEl().getBoundingClientRect().height;
        const res: Record<string, number | null> = {
          rows: null,
          strip: null,
          placeholders: null,
          hPlaceholders: null,
          hRows: null,
          stripFrame: null,
          stripLoaded: null,
        };
        const t0 = performance.now();
        (root.querySelector(`tr[data-run-id="${id}"] button[aria-expanded]`) as HTMLElement).click();
        const stripRow = () => {
          let el = root.querySelector(`tr[data-run-id="${id}"]`)?.nextElementSibling ?? null;
          while (el && !el.hasAttribute('data-strip-row') && !el.hasAttribute('data-run-id'))
            el = el.nextElementSibling;
          return el && el.hasAttribute('data-strip-row') ? el : null;
        };
        const tick = () => {
          const now = performance.now() - t0;
          const ph = root.querySelectorAll(`tr[data-loading-row][data-parent-run="${id}"]`).length;
          const pr = root.querySelectorAll(`tr[data-pass-row][data-parent-run="${id}"]`).length;
          if (res.placeholders === null && ph > 0) {
            res.placeholders = now;
            res.hPlaceholders = tableEl().getBoundingClientRect().height;
            res.stripFrame = stripRow()?.getBoundingClientRect().height ?? null;
          }
          if (res.rows === null && pr >= k) {
            res.rows = now;
            res.hRows = tableEl().getBoundingClientRect().height;
          }
          const sr = stripRow();
          const dd = sr?.querySelector('[role=group][aria-label="Group metrics"] dl[aria-busy="false"] dd');
          if (res.strip === null && dd && /\d/.test(dd.textContent ?? '')) {
            res.strip = now;
            res.stripLoaded = sr!.getBoundingClientRect().height;
          }
          if (res.rows !== null && res.strip !== null) return resolve({ ...res, hBefore });
          if (now > 20000) return resolve({ ...res, hBefore });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { id: runId, k: samples },
  ) as never;
}

test.describe.configure({ mode: 'serial' });

for (const width of [1440, 1024] as const) {
  test.describe(`Q2 at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('Q2-7 and Q2-8: the prefetch starts after the list settles, in row order, four at a time, finished repeat runs only', async ({
      page,
      request,
    }) => {
      const s = await seeded(request);
      const log = logApi(page);
      await openRuns(page, s.project.slug);
      await page.waitForTimeout(3500); // the idle callback fires (500 ms at the latest) and the queue drains
      const prefetch = log.all.filter((r) => isPrefetchApi(r.url) && !r.failed);
      const own = log.all.filter((r) => !isPrefetchApi(r.url));
      // the runs that are prefetched are the repeat runs (4 x 10 passes and the 19-pass run), nothing else, 2 requests each
      const ids = (rs: Logged[]) => [...new Set(rs.map((r) => /\/api\/runs\/([^/?]+)/.exec(r.url)![1]!))];
      const repeat = [...s.repeat, s.passes19!].map((r) => r.id);
      expect(ids(prefetch)).toEqual(repeat); // row order, repeat runs only (the classic runs have one pass)
      expect(prefetch.filter((r) => isPasses(r.url))).toHaveLength(repeat.length);
      expect(prefetch.filter((r) => isGroup(r.url))).toHaveLength(repeat.length);
      expect(prefetch.length).toBeLessThanOrEqual(2 * 20);
      for (const r of prefetch.filter((x) => isGroup(x.url))) expect(r.url).toContain('view=group');
      // Q2-7: it starts after the list's own requests are done, within 600 ms of that moment
      const listDone = Math.max(...own.map((r) => (Number.isNaN(r.end) ? 0 : r.end)));
      const firstStart = Math.min(...prefetch.map((r) => r.start));
      expect(firstStart).toBeGreaterThanOrEqual(listDone - 5);
      expect(firstStart - listDone).toBeLessThanOrEqual(limit(1500, 600));
      // never more than four in flight
      let worst = 0;
      for (const r of prefetch)
        worst = Math.max(
          worst,
          prefetch.filter((o) => o.start <= r.start && (Number.isNaN(o.end) || o.end > r.start)).length,
        );
      expect(worst).toBeLessThanOrEqual(4);
      // the page's own request count is unchanged by the prefetch
      expect(own.length).toBeLessThanOrEqual(8);
    });

    test('Q2-4 and Q2-6: a click on a prefetched run paints its rows at once and sends no request, for five groups in a row', async ({
      page,
      request,
    }) => {
      const s = await seeded(request);
      const log = logApi(page);
      await openRuns(page, s.project.slug);
      await expect
        .poll(() => log.all.filter((r) => isPrefetchApi(r.url) && !Number.isNaN(r.end)).length, {
          timeout: 15_000,
        })
        .toBe(2 * (s.repeat.length + 1));
      await page.waitForTimeout(300);
      log.reset();
      const timings: number[] = [];
      for (const run of [...s.repeat, s.passes19!]) {
        const samples = run === s.passes19 ? 19 : 10;
        const t = await openTimed(page, run.name, run.id, samples);
        timings.push(Math.max(t.rows, t.strip));
        // Q2-4: rows and strip statistics in the same frame family as the click (<= 80 ms local, CI margin on the dev server)
        expect(Math.max(t.rows, t.strip), `${run.name}: rows and strip painted`).toBeLessThanOrEqual(
          limit(400, 80),
        );
        await expect(table(page).locator(`tr[data-pass-row][data-parent-run="${run.id}"]`)).toHaveCount(
          samples,
        );
      }
      await page.waitForTimeout(400);
      // Q2-6: not one request after the first click
      expect(
        log.all.filter((r) => isPrefetchApi(r.url)),
        'requests after the clicks',
      ).toEqual([]);
      test.info().annotations.push({
        type: `Q2-4 ${width}`,
        description: `click to rows+strip painted: ${timings.map(Math.round).join(', ')} ms`,
      });
    });

    test('Q2-5: without a prefetch a click costs exactly two requests, `/passes` and `group-metrics?view=group`, and no bootstrap', async ({
      page,
      request,
    }) => {
      const s = await seeded(request);
      await withoutPrefetch(page);
      const log = logApi(page);
      await openRuns(page, s.project.slug);
      await page.waitForTimeout(1500);
      expect(
        log.all.filter((r) => isPrefetchApi(r.url)),
        'saveData: nothing is prefetched',
      ).toEqual([]);
      const run = s.repeat[1]!;
      log.reset();
      const t = await openTimed(page, run.name, run.id, 10);
      await page.waitForTimeout(300);
      const calls = log.all.filter((r) => isPrefetchApi(r.url) && !r.failed);
      expect(
        calls.map((r) => r.url.replace(/\?.*/, '').replace(run.id, ':id')).sort(),
        calls.map((r) => r.url).join('  '),
      ).toEqual(['/api/runs/:id/group-metrics', '/api/runs/:id/passes']);
      expect(calls.find((r) => isGroup(r.url))!.url).toContain('view=group');
      expect(Math.max(t.rows, t.strip)).toBeLessThanOrEqual(limit(2500, 250));
    });

    test('Q2-9: the loading frame has the loaded height (10 and 19 passes), the strip frame is the strip', async ({
      page,
      request,
    }) => {
      const s = await seeded(request);
      await withoutPrefetch(page);
      // hold both requests so the frame is on screen for a while
      await page.route(/\/api\/runs\/[^/?]+\/(passes|group-metrics)/, async (route) => {
        await new Promise((r) => setTimeout(r, 700));
        await route.continue();
      });
      await openRuns(page, s.project.slug);
      for (const [run, samples] of [
        [s.repeat[0]!, 10],
        [s.passes19!, 19],
      ] as const) {
        const t = await openTimed(page, run.name, run.id, samples);
        expect(t.placeholders, `${run.name}: a placeholder frame was painted`).not.toBeNull();
        // placeholder rows = min(samples, 20): the table does not change height when the rows arrive (0 +- 1 px)
        expect(
          Math.abs(t.hPlaceholders! - t.hRows),
          `${run.name}: table height placeholders -> rows`,
        ).toBeLessThanOrEqual(1);
        // the strip frame is the strip's own layout: its height at the placeholder frame equals the loaded height
        expect(
          Math.abs(t.stripFrame! - t.stripLoaded),
          `${run.name}: strip frame ${t.stripFrame} -> ${t.stripLoaded}`,
        ).toBeLessThanOrEqual(1);
        if (width === 1440) expect(t.stripLoaded).toBeLessThanOrEqual(46);
        await chevron(page, run.name, samples, true).click();
        await expect(table(page).locator('tr[data-pass-row]')).toHaveCount(0);
      }
    });

    test('Q2-10: changing the Metric select asks for the new statistics (view=group) and shows them quickly', async ({
      page,
      request,
    }) => {
      const s = await seeded(request);
      await withoutPrefetch(page);
      const log = logApi(page);
      await openRuns(page, s.project.slug);
      const run = s.repeat[2]!;
      await openTimed(page, run.name, run.id, 10);
      const strip = table(page)
        .locator('tr[data-strip-row] [role="group"][aria-label="Group metrics"]')
        .first();
      const current = (await strip.getByRole('button', { name: /Metric/ }).textContent()) ?? '';
      const other = /quality/.test(current) ? 'faithfulness' : 'quality';
      log.reset();
      const t0 = Date.now();
      await strip.getByRole('button', { name: /Metric/ }).click();
      await page.getByRole('option', { name: other }).click();
      await expect
        .poll(() => log.all.filter((r) => isGroup(r.url) && r.url.includes(`metric=${other}`)).length)
        .toBe(1);
      expect(log.all.find((r) => isGroup(r.url))!.url).toContain('view=group');
      await expect(strip.locator('dl[aria-busy="false"]')).toBeVisible();
      expect(Date.now() - t0, 'select change to new statistics').toBeLessThanOrEqual(limit(1500, 100));
    });
  });
}

test('Q2-12: the run page still reads the default view, and its group equals the strip’s for the same metric and threshold', async ({
  request,
}) => {
  const s = await seeded(request);
  const run = s.repeat[0]!;
  const full = await (
    await request.get(`/api/runs/${run.id}/group-metrics?metric=quality&threshold=0.7`)
  ).json();
  const grouped = await (
    await request.get(`/api/runs/${run.id}/group-metrics?metric=quality&threshold=0.7&view=group`)
  ).json();
  expect(Object.keys(full)).toEqual(expect.arrayContaining(['band', 'distribution', 'uncertainty', 'group']));
  expect(Object.keys(grouped).sort()).toEqual([
    'direction',
    'group',
    'metric',
    'report_k',
    'run_id',
    'samples',
    'threshold',
  ]);
  expect(grouped.group).toEqual(full.group);
});

test.describe('Q2-5 at 10 passes x 1,200 items', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a click on a run nobody prefetched paints its rows in <= 500 ms (CI margin on the dev server), with 2 requests', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const s = await seedR7(request, { repeat: 1, items: 24, big: 1200, classic: 1, slugPrefix: 'r7big' });
    await withoutPrefetch(page);
    const log = logApi(page);
    await openRuns(page, s.project.slug);
    await page.waitForTimeout(1500);
    log.reset();
    const run = s.big!;
    const t = await openTimed(page, run.name, run.id, 10);
    await page.waitForTimeout(300);
    const calls = log.all.filter((r) => isPrefetchApi(r.url) && !r.failed);
    expect(
      calls.map((r) => r.url.replace(/\?.*/, '').replace(run.id, ':id')).sort(),
      calls.map((r) => r.url).join('  '),
    ).toEqual(['/api/runs/:id/group-metrics', '/api/runs/:id/passes']);
    expect(calls.find((r) => isGroup(r.url))!.url).toContain('view=group');
    // spec Q2-5 (amended): <= 500 ms on the production build (measured 460); the dev server carries the usual CI margin
    const ms = Math.max(t.rows, t.strip);
    test.info().annotations.push({ type: 'Q2-5 1,200', description: `${Math.round(ms)} ms` });
    expect(ms).toBeLessThanOrEqual(limit(3000, 500));
  });
});
