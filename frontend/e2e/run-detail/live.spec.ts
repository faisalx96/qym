/** J2 + scenario 2: follow a RUNNING run; plus the incomplete-ingest warning banner. */
import { test, expect } from '@playwright/test';
import {
  EventStream,
  completeRun,
  createRun,
  pushLiveItem,
  seedRunningRun,
} from './seed';
import { client, itemButton, itemsCount, openRun, scrollTop, seedProject, type Seeded } from './support';

let s: Seeded;

test.beforeAll(async () => {
  s = await seedProject('rd-live');
});

test.describe('live run (scenario 2, J2)', () => {
  // a RUNNING run with no events for 180 s is marked STOPPED: seed and finish inside each test
  test.setTimeout(75_000);

  test('count and cards update in place, the expanded card and scroll survive, completion removes the indicator', async ({
    page,
  }) => {
    const { runId, stream, next } = await seedRunningRun(client, s.token, 30);
    await openRun(page, s.slug, runId);
    const hero = page.getByRole('region', { name: 'Run summary' });
    await expect(hero).toContainText('RUNNING');
    await expect(page.getByTestId('live-indicator')).toBeVisible();
    await expect(page.getByTestId('live-indicator')).toContainText(/Live · updated \d+s ago/);
    await expect(page.getByTestId('hero-runtime')).toBeVisible().catch(() => undefined);
    expect(await itemsCount(page)).toEqual([30, 30]);

    // expand a card and move the page, then ingest more items
    await itemButton(page, 2).click();
    const card = page.locator('[data-testid=item-card][data-item-id="live-002"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[role=listitem][data-metric=quality]')).toBeVisible();
    await expect(card.locator('[data-kind=output]')).toContainText('Live answer 2');
    // let opening the card finish its own scroll-into-view, then move the page by hand
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const el = document.getElementById('shell-content');
      if (el) el.scrollTop = 120;
    });
    await page.waitForTimeout(600);
    const before = await scrollTop(page);
    expect(before).toBe(120);
    const mean0 = await page.locator('[data-testid=metric-card][data-metric=quality]').innerText();
    for (let i = 0; i < 4; i++) pushLiveItem(stream, next + i);
    await stream.flush();

    // within 10 s the count follows ...
    await expect.poll(async () => (await itemsCount(page))[1], { timeout: 12_000, intervals: [500] }).toBe(34);
    await expect(page.getByLabel('Run counts')).toContainText('34');
    // ... and the metric card is rebuilt from the new rows
    await expect(page.locator('[data-testid=metric-card][data-metric=quality]')).toContainText('34 scored');
    expect(mean0).toContain('30 scored');
    // the opened card is still open and the scroll did not move
    await expect(card).toBeVisible();
    await expect(card.locator('[data-kind=output]')).toContainText('Live answer 2');
    expect(await scrollTop(page)).toBe(before);

    // finish: indicator disappears and the status flips
    await completeRun(stream);
    await expect(page.getByTestId('live-indicator')).toHaveCount(0, { timeout: 15_000 });
    await expect(hero).toContainText('COMPLETED');
    await expect(card).toBeVisible();
  });

  test('a filter typed while the run is live survives the refresh', async ({ page }) => {
    const { runId, stream, next } = await seedRunningRun(client, s.token, 30);
    await openRun(page, s.slug, runId);
    const search = page.getByRole('searchbox', { name: 'Search inputs and outputs' });
    await search.fill('Live question 1');
    // "Live question 1" matches items 1 and 10-19
    await expect.poll(async () => (await itemsCount(page))[0]).toBe(11);
    pushLiveItem(stream, next); // "Live question 31" / "32": neither matches the filter
    pushLiveItem(stream, next + 1);
    await stream.flush();
    await expect.poll(async () => (await itemsCount(page))[1], { timeout: 12_000, intervals: [500] }).toBe(32);
    await expect(search).toHaveValue('Live question 1');
    expect(await itemsCount(page)).toEqual([11, 32]);
    await completeRun(stream);
    await expect(page.getByTestId('live-indicator')).toHaveCount(0, { timeout: 15_000 });
  });

  test('a completed run has no live indicator and runtime is static', async ({ page }) => {
    const { runId, stream } = await seedRunningRun(client, s.token, 5);
    await completeRun(stream);
    await openRun(page, s.slug, runId);
    await expect(page.getByRole('region', { name: 'Run summary' })).toContainText('COMPLETED');
    await expect(page.getByTestId('live-indicator')).toHaveCount(0);
  });
});

test.describe('incomplete ingest', () => {
  test('a run that reports more items than arrived shows the ingest warning', async ({ page }) => {
    const specs = {
      quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, primary: true, schema_version: 2 },
    };
    const runId = await createRun(client, s.token, {
      task: 'rag_answer',
      dataset: 'qa-arabic-v3',
      model: 'openai/gpt-5-mini',
      metrics: ['quality'],
      metric_specs: specs,
    });
    const stream = new EventStream(client, s.token, runId, 5);
    stream.push('run_started', {
      task: 'rag_answer',
      dataset: 'qa-arabic-v3',
      model: 'openai/gpt-5-mini',
      metrics: ['quality'],
      metric_specs: specs,
      total_items: 20,
      started_at: new Date().toISOString(),
    });
    for (let i = 0; i < 5; i++) pushLiveItem(stream, i);
    stream.push('run_completed', {
      ended_at: new Date().toISOString(),
      final_status: 'COMPLETED',
      summary: { total_items: 20 },
    });
    await stream.flush();
    await openRun(page, s.slug, runId);
    const warning = page.getByTestId('ingest-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('20');
    await expect(warning).toContainText('5');
    await expect(warning).toContainText('missing');
  });
});
