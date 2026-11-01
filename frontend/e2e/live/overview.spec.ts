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
