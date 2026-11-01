/** Round 8: Comparison overview (C-ov-1..6): controls in the head, stat grid, winner bar, distribution bar. */
import { expect, test, type Page } from '@playwright/test';
import { expectShown, urlParams } from './support';
import { box, openCompare, part, seedR8, within, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-ov');
});

const navControls = (page: Page) => part(page, 'page-controls');

test('K6 (C154): Metric and the pass slider sit in the sticky nav, not in the Overview head; both keep the URL', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const slider = navControls(page).getByRole('slider', { name: /Pass if/ });
  const metric = navControls(page)
    .locator('[data-part="metric-control"]')
    .getByRole('button', { name: /Metric/ });
  await expect(slider).toBeVisible();
  await expect(metric).toBeVisible();
  await expect(part(page, 'section-overview').getByRole('slider')).toHaveCount(0);
  await expect(
    part(page, 'section-overview').getByRole('radiogroup', { name: 'Overview metric' }),
  ).toHaveCount(0);
  // metric -> URL and the stat values change
  const stat = () => part(page, 'stat-grid').innerText();
  const before = await stat();
  await metric.click();
  await page.getByRole('option', { name: 'correct' }).click();
  await expect.poll(() => urlParams(page).get('metric')).toBe('correct');
  await expect.poll(stat).not.toBe(before);
  // slider -> thr
  await metric.click();
  await page.getByRole('option', { name: 'quality' }).click();
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => urlParams(page).getAll('thr')).toEqual(['quality:0.6']);
});

test('C-ov-2/3: the stat grid is 8 / 4 / 2 columns with 1 px gaps drawn by the grid', async ({ page }) => {
  for (const [w, h, perRow, boxW] of [
    [1440, 76, 8, 144], // box 148 before the section panel (owner decision H6)
    [1024, 151, 4, null],
    [390, 301, 2, null],
  ] as const) {
    await openCompare(page, s.four, w);
    const grid = part(page, 'stat-grid');
    within((await box(grid)).h, h, 2, `grid height at ${w}`);
    const tops = await part(page, 'stat-box').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().y)),
    );
    expect(tops.filter((t) => t === tops[0]).length).toBe(perRow);
    if (boxW) within((await box(part(page, 'stat-box').first())).w, boxW, 2, 'box width');
    within((await box(part(page, 'stat-box').first())).h, 74, 2, 'box height');
    const borders = await part(page, 'stat-box')
      .first()
      .evaluate((e) => getComputedStyle(e).borderTopWidth);
    expect(borders).toBe('0px');
  }
  await openCompare(page, s.four, 1440);
  const boxes = part(page, 'stat-box');
  const label = await boxes
    .first()
    .locator('span')
    .first()
    .evaluate((e) => ({ size: getComputedStyle(e).fontSize, weight: getComputedStyle(e).fontWeight }));
  expect(label.size).toBe('11px');
  expect(Number(label.weight)).toBe(600);
  const value = await boxes
    .first()
    .locator('b')
    .evaluate((e) => ({ f: getComputedStyle(e).fontFamily, w: getComputedStyle(e).fontWeight }));
  expect(value.f).toMatch(/mono/i);
  expect(Number(value.w)).toBe(650);
  // Pass@4 carries a help marker; the Errors value is red text
  await expect(boxes.first().getByRole('button')).toHaveCount(1);
  const colours = await boxes.evaluateAll((els) =>
    els.map((e) => getComputedStyle(e.querySelector('b')!).color),
  );
  expect(colours[7]).not.toBe(colours[6]); // Errors vs Avg latency (primary)
});

test('C-ov-4: the winner bar is 28 high, proportional, named and clickable; the legend lists every run and Ties', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const bar = part(page, 'winner-bar');
  within((await box(bar)).h, 28, 1, 'winner bar');
  const segs = bar.getByRole('button');
  const n = await segs.count();
  expect(n).toBeGreaterThanOrEqual(2);
  const wins: number[] = [];
  const widths: number[] = [];
  for (let i = 0; i < n; i++) {
    const label = (await segs.nth(i).getAttribute('aria-label')) ?? '';
    wins.push(Number(/won (\d+) items|^(\d+) ties/.exec(label)?.[1] ?? /^(\d+) ties/.exec(label)?.[1]));
    widths.push((await box(segs.nth(i))).w);
  }
  // widths are proportional to wins (flex-grow = wins)
  const ratio = widths.map((w, i) => w / wins[i]!);
  for (const r of ratio) within(r, ratio[0]!, ratio[0]! * 0.06, 'width per win');
  const seg = await segs
    .first()
    .evaluate((e) => ({
      bg: getComputedStyle(e).backgroundColor,
      f: getComputedStyle(e.firstElementChild!).fontFamily,
      s: getComputedStyle(e).fontSize,
      w: getComputedStyle(e).fontWeight,
    }));
  expect(seg.f).toMatch(/mono/i);
  expect(seg.s).toBe('11px');
  expect(Number(seg.w)).toBe(650);
  const legend = part(page, 'winner-legend');
  await expect(legend.locator('li')).toHaveCount(5); // 4 runs + Ties
  await expect(legend).toContainText('Ties');
  within((await box(legend)).h, 18, 2, 'legend at 4 runs, one line');
  const cut = await legend.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
  expect(cut).toBe(false);
  // click: filters by winner
  const label = (await segs.first().getAttribute('aria-label')) ?? '';
  const count = Number(/won (\d+) items/.exec(label)![1]);
  await segs.first().click();
  await expectShown(page, count);
  expect(urlParams(page).get('winner')).toMatch(/^win_\d$/);
  await expect(part(page, 'baseline-delta-banner')).toContainText('won');
});

test('C-ov-4: with 8 runs the legend is at most two lines and nothing is clipped', async ({ page }) => {
  await openCompare(page, s.eight, 1440);
  const legend = part(page, 'winner-legend');
  expect((await box(legend)).h).toBeLessThanOrEqual(42);
  expect(await legend.evaluate((e) => e.scrollWidth > e.clientWidth + 1)).toBe(false);
  await expect(legend.locator('li')).toHaveCount(9);
});

test('C-ov-5: the distribution bar is one 32 px stacked bar, a segment per count, clicking filters by pass count', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const bar = part(page, 'distribution-bar');
  within((await box(bar)).h, 32, 1, 'distribution bar');
  const segs = bar.getByRole('button');
  expect(await segs.count()).toBeGreaterThanOrEqual(2);
  const first = segs.first();
  const label = (await first.getAttribute('aria-label')) ?? '';
  const m = /^(\d+) items with (\d) of 4 runs correct/.exec(label)!;
  await expect(first).toContainText(m[2]!);
  await expect(first).toContainText(m[1]!);
  await first.click();
  await expectShown(page, Number(m[1]));
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(part(page, 'baseline-delta-banner')).toContainText(`Passing runs = ${m[2]} of 4`);
  // the old histogram is gone
  await expect(
    part(page, 'section-overview').getByRole('button', { name: /items with \d of 4 runs correct; filter$/ }),
  ).toHaveCount(await segs.count());
});

test('C-ov-6: the overview section is at most 410 high at 1440 with 4 runs', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  expect((await box(part(page, 'section-overview'))).h).toBeLessThanOrEqual(410); // amended from 400: +14 for the section panel (owner decision H6), measured 406
});

test('C-kbd-2: winner and distribution segments activate on Enter and Space', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const seg = part(page, 'winner-bar').getByRole('button').first();
  await seg.focus();
  await page.keyboard.press('Enter');
  await expect(seg).toHaveAttribute('aria-pressed', 'true');
  await seg.focus();
  await page.keyboard.press('Space');
  await expect(seg).toHaveAttribute('aria-pressed', 'false');
});
