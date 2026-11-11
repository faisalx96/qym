import { test, expect } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { seedLive } from './support';

test('deep-linked filters, CSV, trigger clearing and Arabic search stay in the URL', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-filters'));
  const day = seed.days.at(-1)!;
  const diagnosis = seed.labels[2]!;
  const matching = day.turns.filter((turn) => turn.label === diagnosis.value).length;
  const query = new URLSearchParams({ day: day.day, label: diagnosis.value, source: seed.sourceKey });
  await gotoApp(page, `/projects/${seed.projectSlug}/live/turns?${query}`);

  const dateLabel = new Date(`${day.day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const filters = page.locator('[data-live-block="filters"]');
  await expect(filters.getByRole('button', { name: 'Day filter, 1 selected', exact: true })).toBeVisible();
  await expect(
    filters.getByRole('button', { name: 'Diagnosis filter, 1 selected', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`${matching} of ${day.turns.length} turns on ${dateLabel}`, { exact: true }),
  ).toBeVisible();
  const rows = page.locator('[data-live-turn-row]');
  await expect(rows).toHaveCount(matching);

  const csv = page.getByRole('link', { name: 'Export CSV' });
  const csvUrl = new URL((await csv.getAttribute('href'))!, page.url());
  expect(csvUrl.searchParams.get('day')).toBe(day.day);
  expect(csvUrl.searchParams.get('label')).toBe(diagnosis.value);
  expect(csvUrl.searchParams.get('source')).toBe(seed.sourceKey);
  await expect(csv).toHaveAttribute('download', '');
  const downloadReady = page.waitForEvent('download');
  await csv.click();
  const download = await downloadReady;
  expect(await download.failure()).toBeNull();

  await filters.getByRole('button', { name: 'Diagnosis filter, 1 selected' }).click();
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(
    (url) => !url.searchParams.has('label') && url.searchParams.get('day') === day.day,
  );
  await expect(rows).toHaveCount(day.turns.length);
  await page.getByRole('searchbox', { name: 'Search questions and answers' }).fill('إجمالي');
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'إجمالي');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('[data-live-question]')).toContainText('إجمالي');
  await expect(rows.first().locator('[data-live-question]')).toHaveAttribute('dir', 'auto');
});

test('latency sorts descending and Enter opens the encoded turn with list context', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-order'));
  const day = seed.days.at(-1)!.day;
  await gotoApp(
    page,
    `/projects/${seed.projectSlug}/live/turns?${new URLSearchParams({ day, source: seed.sourceKey })}`,
  );
  await page.getByRole('button', { name: 'Latency', exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('sort') === '-latency_ms');
  await expect(page.getByRole('columnheader', { name: /Latency/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  const rows = page.locator('[data-live-turn-row]');
  await expect(rows).toHaveCount(12);
  await expect(rows.first()).toHaveAttribute('data-live-turn-row', `${day}/turn-12`);
  const latencies = await rows
    .locator('[data-live-latency]')
    .evaluateAll((cells) => cells.map((cell) => Number(cell.getAttribute('data-live-latency'))));
  expect(latencies[0]).toBeGreaterThanOrEqual(latencies[1]!);
  expect(latencies).toEqual([...latencies].sort((a, b) => b - a));

  const turnId = (await rows.first().getAttribute('data-live-turn-row'))!;
  const list = new URL(page.url()).searchParams.toString();
  await rows.first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/projects/${seed.projectSlug}/live/turns/${encodeURIComponent(turnId)}` &&
      url.searchParams.get('source') === seed.sourceKey &&
      url.searchParams.get('list') === list,
  );
});

test('two sources can be selected on Turns and reload its numbers', async ({ page, request }) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-sources'), { secondSource: true });
  const day = seed.days.at(-1)!.day;
  await gotoApp(page, `/projects/${seed.projectSlug}/live/turns?source=${seed.sourceKey}&day=${day}`);
  await expect(page.locator('[data-live-turn-row]')).toHaveCount(12);
  const source = page.locator('[data-live-block="source"]');
  await source.getByRole('button', { name: /Live source/ }).click();
  await page.getByRole('option', { name: 'Development worker', exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('source') === 'worker-dev');
  await expect(page.locator('[data-live-turn-row]')).toHaveCount(3);
  await expect(page.getByText(/^3 of 3 turns on/)).toBeVisible();
  await expect(source).toContainText('Development worker');
  const box = await source.boundingBox();
  // Content-sized control: the whole source name is visible, never cut with an ellipsis.
  expect(box?.width).toBeGreaterThan(120);
  expect(
    await source.evaluate((el) => {
      const trigger = el.querySelector('button') ?? el;
      return trigger.scrollWidth <= trigger.clientWidth;
    }),
  ).toBe(true);
  expect(box?.height).toBeCloseTo(24, 0);
});
