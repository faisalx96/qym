/**
 * Cutover of test_run_page_render_browser.py (C039): the live-follow controls of the run page.
 * A stop request shows STOPPING and probes faster; a hidden tab is not polled and resumes when it
 * shows; the first probe at the revision the rows were served at reloads nothing, and a new revision
 * reloads once. (Counts and cards following new items in place: live.spec.ts.)
 */
import { test, expect, type Page } from '@playwright/test';
import { client, openRun, seedProject, type Seeded } from './support';
import { seedRunningRun } from './seed';

let s: Seeded;

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-live');
});

test.describe('live follow', () => {
  // a RUNNING run with no events for 180 s is marked STOPPED: seed and observe inside each test
  test.setTimeout(60_000);

  async function liveRun(page: Page, answer: (n: number) => Record<string, unknown>) {
    const { runId } = await seedRunningRun(client, s.token, 12);
    const probes: number[] = [];
    await page.route(/\/api\/runs\/[^/]+\/live-status/, async (route) => {
      probes.push(Date.now());
      await route.fulfill({
        json: {
          run_id: runId,
          status: 'RUNNING',
          live: true,
          server_time: new Date().toISOString(),
          ...answer(probes.length),
        },
      });
    });
    return { runId, probes };
  }

  test('a stop request shows STOPPING and probes every 1.5 s instead of 3 s', async ({ page }) => {
    const { runId, probes } = await liveRun(page, () => ({ stop_requested: true, revision: 'r1' }));
    await openRun(page, s.slug, runId);
    await expect(page.getByRole('region', { name: 'Run summary' })).toContainText('STOPPING…', {
      timeout: 15_000,
    });
    await expect.poll(() => probes.length, { timeout: 25_000, intervals: [250] }).toBeGreaterThanOrEqual(5);
    const gaps = probes.slice(1).map((t, i) => t - probes[i]!);
    // the first answer says "stop requested": the probes after the next one follow 1.5 s apart (3 s otherwise)
    expect(Math.max(...gaps.slice(1, 4))).toBeLessThan(2400);
  });

  test('a hidden tab is not polled and polling resumes when it shows again', async ({ page }) => {
    const { runId, probes } = await liveRun(page, () => ({ revision: 'r1' }));
    await openRun(page, s.slug, runId);
    await expect.poll(() => probes.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    const hide = (hidden: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => (value ? 'hidden' : 'visible'),
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await hide(true);
    await page.waitForTimeout(500);
    const frozen = probes.length;
    await page.waitForTimeout(7000);
    expect(probes.length).toBe(frozen);
    await hide(false);
    await expect.poll(() => probes.length, { timeout: 10_000 }).toBeGreaterThan(frozen);
  });

  test('the first probe at the served revision reloads nothing; a new revision reloads once', async ({
    page,
  }) => {
    const seeded = await seedRunningRun(client, s.token, 12);
    const first = await fetch(`${client.baseUrl}/api/runs/${seeded.runId}?view=compact`).then((r) =>
      r.json(),
    );
    const served = (first as { run: { live_revision?: string } }).run.live_revision ?? 'r1';
    let revision = served;
    const probes: number[] = [];
    await page.route(/\/api\/runs\/[^/]+\/live-status/, async (route) => {
      probes.push(Date.now());
      await route.fulfill({
        json: {
          run_id: seeded.runId,
          status: 'RUNNING',
          live: true,
          revision,
          server_time: new Date().toISOString(),
        },
      });
    });
    const reloads: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === `/api/runs/${seeded.runId}` && r.method() === 'GET') reloads.push(u.search);
    });
    await openRun(page, s.slug, seeded.runId);
    const initial = reloads.length;
    expect(initial).toBeGreaterThanOrEqual(1);
    await expect.poll(() => probes.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    expect(reloads.length).toBe(initial);
    revision = 'r-next';
    await expect.poll(() => reloads.length, { timeout: 20_000 }).toBe(initial + 1);
    await page.waitForTimeout(4000);
    expect(reloads.length).toBe(initial + 1);
  });
});
