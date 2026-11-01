import { test, expect } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { seedLive } from './support';

test('overview shows the worker, day numbers, skipped metric and ingest gap; day and label links carry filters', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-overview'));
  const today = seed.days.at(-1)!;
  await gotoApp(page, `/projects/${seed.projectSlug}/live?day=${today.day}`);
  await expect(page.getByRole('heading', { name: 'Live evaluation', exact: true })).toBeVisible();
  await expect(
    page.getByText('Every real user turn, evaluated as it happens', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-live-block="source"]')).toContainText('Preproduction worker');
  await expect(page.locator('[data-live-block="status"]')).toHaveAttribute('data-live-stale', 'false');
  await expect(page.getByRole('button', { name: 'Next day', exact: true })).toBeDisabled();
  await expect(page.locator('[data-live-stat]')).toHaveCount(6);
  await expect(page.locator('[data-live-stat="turns"]')).toHaveText(String(today.turns_seen));
  await expect(page.locator('[data-live-stat="evaluated"]')).toHaveText(String(today.evaluated));

  const primaryName = seed.metrics.find((metric) => 'is_primary' in metric && metric.is_primary)!.metric_name;
  const scores = today.turns.flatMap((turn) =>
    turn.scores.filter(
      (score) => score.metric_name === primaryName && !score.skipped && score.score_numeric !== null,
    ),
  );
  const mean = scores.reduce((sum, score) => sum + score.score_numeric!, 0) / scores.length;
  await expect(page.locator('[data-live-stat="primary"]')).toHaveText(`${(mean * 100).toFixed(0)}%`);
  const counts = Object.fromEntries(
    seed.labels.map((label) => [
      label.value,
      today.turns.filter((turn) => turn.label === label.value).length,
    ]),
  );
  const problems = seed.labels
    .filter((label) => label.tone === 'danger' || label.tone === 'warning')
    .sort((a, b) => counts[b.value]! - counts[a.value]!)
    .slice(0, 2);
  for (const label of problems) {
    await expect(page.locator(`[data-live-stat="${label.value}"]`)).toHaveText(String(counts[label.value]));
  }
  const latencies = today.turns.map((turn) => turn.latency_ms).sort((a, b) => a - b);
  const median = (latencies[latencies.length / 2 - 1]! + latencies[latencies.length / 2]!) / 2;
  await expect(page.locator('[data-live-stat="latency"]')).toHaveText(`${(median / 1000).toFixed(1)}s`);
  const skippedMetric = page.locator('[data-live-metric="chart_design"]');
  await expect(skippedMetric).toHaveText('Chart design—');
  await expect(skippedMetric).not.toContainText('0%');
  await expect(page.locator('[data-live-note="not-in-qym"]')).toHaveText(
    `${today.turns_seen - today.turns.length} turns not yet in qym`,
  );

  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  const previous = seed.days.at(-2)!;
  await expect.poll(() => new URL(page.url()).searchParams.get('day')).toBe(previous.day);
  await expect(page.locator('[data-live-stat="turns"]')).toBeVisible();
  await page.locator(`[data-live-stat="${problems[0]!.value}"] a`).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${seed.projectSlug}/live/turns`);
  const url = new URL(page.url());
  expect(url.searchParams.get('day')).toBe(previous.day);
  expect(url.searchParams.get('label')).toBe(problems[0]!.value);
  expect(url.searchParams.get('source')).toBe(seed.sourceKey);
});

test('a source without a heartbeat shows the stale error variant', async ({ page, request }) => {
  const { projectSlug } = await seedLive(request, uniqueSlug('live-stale'), { stale: true });
  await gotoApp(page, `/projects/${projectSlug}/live`);
  const status = page.locator('[data-live-block="status"]');
  await expect(status).toHaveAttribute('data-live-stale', 'true');
  await expect(status).toHaveAttribute('data-tone', 'danger');
  await expect(status).toContainText('No heartbeat yet');
});

test('service health links to failed service turns, with failed canaries first', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-services'));
  const day = seed.days.at(-1)!.day;
  await gotoApp(page, `/projects/${seed.projectSlug}/live?day=${day}`);
  const canaries = page.locator('[data-live-canary]');
  await expect(canaries).toHaveCount(2);
  await expect(canaries.first()).toHaveAttribute('data-live-canary', 'viz_agent');
  await expect(canaries.first()).toContainText('failed');
  await page.locator('[data-live-service="sql_generation"]').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${seed.projectSlug}/live/turns`);
  const url = new URL(page.url());
  expect(url.searchParams.get('day')).toBe(day);
  expect(url.searchParams.get('source')).toBe(seed.sourceKey);
  expect(url.searchParams.get('service')).toBe('sql_generation');
  expect(url.searchParams.get('service_status')).toBe('not_ok');
});

test('trend includes quiet days, switches its URL window and selects a day; Days rows open turns', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-trend'));
  const day = seed.days.at(-1)!.day;
  const overviewUrl = `/projects/${seed.projectSlug}/live?day=${day}&source=${seed.sourceKey}`;
  await gotoApp(page, overviewUrl);
  const columns = page.locator('[data-live-trend-day]');
  await expect(columns).toHaveCount(14);
  // record_heartbeat computes max_poll_gap_s from qym's receive clock, ignoring body.at.
  // DayBody also forbids polls/max_poll_gap_s. Two requests whose `at` values differ by
  // 7200 seconds cannot seed a gap without a server-clock override or actually waiting.
  // The real API fixture therefore has no gaps; Vitest verifies the hatched-gap rendering.
  await expect(page.locator('[data-live-trend-day][data-live-gap="false"]')).toHaveCount(14);
  await expect(page.locator('[data-live-trend-day][data-live-gap="true"]')).toHaveCount(0);

  await page.getByRole('radiogroup', { name: 'Trend period' }).getByText('30', { exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('trend_days')).toBe('30');
  await expect(columns).toHaveCount(30);
  await gotoApp(page, `${overviewUrl}&trend_days=30`);
  await expect(columns).toHaveCount(30);
  const previous = seed.days.at(-2)!.day;
  await page.locator(`[data-live-trend-day="${previous}"]`).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('day')).toBe(previous);
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${seed.projectSlug}/live`);

  await page.locator(`[data-live-day="${day}"]`).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${seed.projectSlug}/live/turns`);
  expect(new URL(page.url()).searchParams.get('day')).toBe(day);
  expect(new URL(page.url()).searchParams.get('source')).toBe(seed.sourceKey);
});

test('ninety trend days fit the card at a 390-pixel viewport', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seed = await seedLive(request, uniqueSlug('live-trend-dense'));
  await gotoApp(page, `/projects/${seed.projectSlug}/live?source=${seed.sourceKey}&trend_days=90`);
  const card = page.locator('[data-live-block="trend"]');
  await expect(card.locator('[data-live-trend-day]')).toHaveCount(90);
  await expect(card.locator('[data-live-block="trend-plot"]')).toHaveAttribute('data-dense', 'true');
  await expect
    .poll(() =>
      card
        .locator('[data-part="bar"]')
        .evaluateAll((bars) => Math.min(...bars.map((bar) => bar.getBoundingClientRect().width))),
    )
    .toBeGreaterThanOrEqual(2);
  await expect.poll(() => card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
