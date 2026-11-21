import { test, expect } from '@playwright/test';
import { formatDayKey } from '../../src/lib/dates';
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

  const dateLabel = formatDayKey(day.day);
  const filters = page.locator('[data-live-block="filters"]');
  await expect(filters.getByRole('button', { name: 'Clear 2 filters' })).toBeVisible();
  await expect(
    filters.getByRole('group', { name: 'Active filters' }).getByRole('button', { name: /^Remove / }),
  ).toHaveCount(0);
  await expect(filters.getByRole('button', { name: /^Day: .* filter, 1 selected$/ })).toContainText('Day:');
  await expect(
    filters.getByRole('button', { name: `${diagnosis.label} ${matching}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(`${matching} turns on ${dateLabel}`, { exact: true })).toBeVisible();
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

  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page).toHaveURL(
    (url) => !url.searchParams.has('label') && url.searchParams.get('day') === day.day,
  );
  await expect(rows).toHaveCount(day.turns.length);
  await page.getByRole('searchbox', { name: 'Search questions and answers' }).fill('إجمالي');
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'إجمالي');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('[data-live-question]')).toContainText('إجمالي');
  await expect(rows.first().locator('[data-live-question]')).toHaveAttribute('dir', 'rtl');
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
  await expect(page.getByText(/^3 turns on/)).toBeVisible();
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

test('layout A fits 1366px, caps problems and keeps expansion separate from navigation', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-fit'));
  const day = seed.days.at(-1)!.day;
  await page.route(`**/api/projects/${seed.projectSlug}/live/turns?*`, async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as { rows: { turn_id: string }[] };
    const first = data.rows[0]!;
    data.rows = [1, 5].map((count, index) => ({
      ...first,
      turn_id: data.rows[index]!.turn_id,
      question: 'كم عدد السكان؟',
      label_reason: 'لم يتم العثور على نتيجة مناسبة',
      user_ref: 'مستخدم الاختبار',
      mode: 'محادثة',
      services_not_ok: Array.from({ length: count }, (_, i) => ({
        name: i === 0 ? 'خدمة' : i === 1 ? 'service-with-a-long-name' : `service-${i}`,
        fault: i === 0 ? null : 'agent',
      })),
      charts: { count: 1, failed: 1 },
    }));
    await route.fulfill({ response, json: data });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoApp(page, `/projects/${seed.projectSlug}/live/turns?source=${seed.sourceKey}&day=${day}`);
  const rows = page.locator('[data-live-turn-row]');
  await expect(rows).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  // A fitted table has no overflow region; measure its scroller at every width.
  const table = page.getByRole('treegrid', { name: 'Live turns', exact: true });
  const frame = page.locator('[data-live-block="turns-table"] [data-dt-scroller]');
  await expect(table).toBeVisible();
  const initialWidth = (await frame.boundingBox())!.width;
  await page.setViewportSize({ width: Math.round(1600 + 1366 - initialWidth), height: 900 });
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(1366);
  expect(await frame.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await expect(
    page.getByRole('treegrid', { name: 'Live turns', exact: true }).locator('thead th'),
  ).toHaveCount(10);
  const heights = await rows.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  expect(heights[0]).toBeCloseTo(heights[1]!, 0);
  await expect(rows.nth(1).getByText('+4 more')).toHaveAttribute('title', /service-4 · agent/);
  const alignments = await rows
    .first()
    .locator('td')
    .evaluateAll((cells) =>
      cells.map((cell) => ({
        align: getComputedStyle(cell).verticalAlign,
        padding: getComputedStyle(cell).paddingTop,
      })),
    );
  expect(alignments.every((cell) => cell.align === 'baseline')).toBe(true);
  expect(new Set(alignments.map((cell) => cell.padding)).size).toBe(1);
  for (const row of await rows.all()) {
    const tags = await row.locator('[data-live-problem-tag]').evaluateAll((items) =>
      items.map((item) => ({
        y: item.getBoundingClientRect().y,
        height: item.getBoundingClientRect().height,
      })),
    );
    expect(tags[1]!.y - tags[0]!.y).toBeLessThanOrEqual(tags[0]!.height + 5);
  }
  const shortTags = await rows.first().locator('[data-live-problem-tag]').all();
  expect(
    Math.abs((await shortTags[0]!.boundingBox())!.y - (await shortTags[1]!.boundingBox())!.y),
  ).toBeLessThanOrEqual(4);
  const arabicProblem = rows.first().getByText('خدمة', { exact: true });
  await expect(arabicProblem).toHaveAttribute('dir', 'rtl');
  expect(await arabicProblem.evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');
  const secondTag = (await rows.nth(1).locator('[data-live-problem-tag]').nth(1).boundingBox())!;
  const more = (await rows.nth(1).getByText('+4 more').boundingBox())!;
  expect(more.x).toBeGreaterThanOrEqual(secondTag.x + secondTag.width);
  expect(Math.abs(more.y - secondTag.y)).toBeLessThanOrEqual(5);
  const question = rows.first().locator('[data-live-question]');
  await expect(question).toHaveAttribute('dir', 'rtl');
  const textStart = await question.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().x;
  });
  const headerStart = (await page.locator('th[data-col="question"] [data-th-label]').boundingBox())!.x;
  expect(Math.abs(textStart - headerStart)).toBeLessThanOrEqual(1);
  const reason = rows.first().getByTitle('لم يتم العثور على نتيجة مناسبة');
  await expect(reason).toHaveAttribute('dir', 'rtl');
  expect(await reason.evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');
  const before = page.url();
  await rows.first().getByRole('button', { name: 'Expand row' }).click();
  await expect(page.getByText('Why this diagnosis', { exact: true })).toBeVisible();
  for (const value of ['مستخدم الاختبار', 'محادثة']) {
    const text = page.getByText(value, { exact: true });
    await expect(text).toHaveAttribute('dir', 'rtl');
    expect(await text.evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');
  }
  expect(page.url()).toBe(before);
  await rows.first().getByRole('button', { name: 'Collapse row' }).click();
  const id = (await rows.first().getAttribute('data-live-turn-row'))!;
  await question.click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith(`/turns/${encodeURIComponent(id)}`));
});
