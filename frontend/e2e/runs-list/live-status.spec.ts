/** J3 / §8.3-4: live status without reload, run-status broadcast, visibility-aware polling. */
import { test, expect } from '@playwright/test';
import { BOOL, LOWER, SCORE, completeRun, seedRun } from './seed';
import {
  broadcastRunStatus,
  capture,
  freshProject,
  listRequests,
  openRuns,
  rowOf,
  statusText,
} from './support';

const LIVE_NAME = 'text2sql-gpt-4o-live';

test.describe('runs list: live status (J3)', () => {
  test('a RUNNING row shows progress text and flips to COMPLETED after a run-status broadcast, no reload', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 3);
    await seedRun(request, s.token, {
      name: 'rag-qa-repeat-live',
      task: 'rag-qa',
      dataset: 'hotpot-small',
      model: 'openai/gpt-4o',
      metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
      items: Array.from({ length: 4 }, () => ({ accuracy: 1, quality: 0.8, latency_s: 0.5 })),
      status: 'RUNNING',
      samples: 3,
    });
    await openRuns(page, s.project.slug);
    let loads = 0;
    page.on('load', () => loads++);
    const live = rowOf(page, LIVE_NAME);
    await expect(live).toHaveAttribute('data-live', '');
    await expect(live.locator('td[data-col="status"]')).toContainText(/running/i);
    // single-pass run: done/total + a progress label
    await expect(live.getByLabel(/^Progress \d+ percent$/)).toBeVisible();
    await expect(live.locator('td[data-col="status"]')).toContainText(/\d+\/10/);
    // repeat run: pass j/k
    await expect(rowOf(page, 'rag-qa-repeat-live').locator('td[data-col="status"]')).toContainText(
      'pass 1/3',
    );

    await completeRun(request, s.token, s.runs.find((r) => r.name === LIVE_NAME)!.id);
    await broadcastRunStatus(page, [s.runs.find((r) => r.name === LIVE_NAME)!.id], 'COMPLETED');
    await expect(live.locator('td[data-col="status"]')).toContainText(/completed/i, { timeout: 15_000 });
    await expect(live).not.toHaveAttribute('data-live', '');
    expect(await statusText(live)).not.toMatch(/\d+\/10/);
    expect(loads).toBe(0); // no full page load happened
  });

  test('without a broadcast the 15 s live poll picks the change up', async ({ page, request }) => {
    test.setTimeout(60_000);
    const s = await freshProject(request, 2);
    await openRuns(page, s.project.slug);
    const live = rowOf(page, LIVE_NAME);
    await expect(live.locator('td[data-col="status"]')).toContainText(/running/i);
    await completeRun(request, s.token, s.runs.find((r) => r.name === LIVE_NAME)!.id);
    await expect(live.locator('td[data-col="status"]')).toContainText(/completed/i, { timeout: 30_000 });
  });

  test('a hidden tab does not poll; becoming visible refetches once', async ({ page, request }) => {
    const s = await freshProject(request, 2);
    await page.clock.install();
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug);
    await expect(rowOf(page, LIVE_NAME)).toBeVisible();
    const setVisibility = (state: 'hidden' | 'visible') =>
      page.evaluate((st) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => st === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
    await setVisibility('hidden');
    const idle = listRequests(cap).length;
    // 3 minutes of page time: the visible cadence would have polled 12 times at 15 s
    await page.clock.fastForward('03:00');
    await page.waitForTimeout(500);
    expect(listRequests(cap).length - idle, 'requests while hidden').toBe(0);
    await setVisibility('visible');
    await expect
      .poll(() => listRequests(cap).length - idle, { message: 'one refetch on becoming visible' })
      .toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(500);
    expect(listRequests(cap).length - idle, 'exactly one refetch on becoming visible').toBe(1);
  });
});
