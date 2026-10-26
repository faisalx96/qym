/** Round 8: Per-run averages (C-avg-1..9), including the count-button journey. */
import { expect, test } from '@playwright/test';
import { averagesGrid, expectShown, urlParams } from './support';
import { box, noSidewaysScroll, openCompare, part, seedR8, shell, within, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-avg');
});

test('C-avg-1: the Baseline select is in the head (14 rem x 24); the sticky nav has neither select nor pass toggle', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const control = part(page, 'section-averages').locator('[data-part="section-head"] [data-part="baseline-control"]');
  await expect(control).toBeVisible();
  const trigger = control.getByRole('button', { name: /Baseline/ });
  within((await box(trigger)).w, 224, 3, 'select width');
  within((await box(trigger)).h, 24, 1, 'select height');
  await expect(part(page, 'section-nav').locator('select, [role=radiogroup], button')).toHaveCount(0);
  // no repeat run selected: no pass toggle
  await expect(page.getByRole('radiogroup', { name: 'Repeat run columns' })).toHaveCount(0);
});

test('C-avg-1: with a repeat run the head carries Run average | Each pass and it switches the columns', async ({
  page,
}) => {
  await openCompare(page, [s.seed.runs.repeat3, s.seed.runs.base], 1440);
  const toggle = part(page, 'section-averages').getByRole('radiogroup', { name: 'Repeat run columns' });
  await expect(toggle).toBeVisible();
  await expect(part(page, 'averages-colhead')).toHaveCount(2);
  await toggle.getByText('Each pass').click();
  await expect.poll(() => urlParams(page).get('columns')).toBe('passes');
  await expect(part(page, 'averages-colhead')).toHaveCount(4);
  await toggle.getByText('Run average').click();
  await expect(part(page, 'averages-colhead')).toHaveCount(2);
});

test('C-avg-2/3: 1440 with 4 runs: metric column 144, run columns 261, heads 34 high, sentence case', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const heads = part(page, 'averages-colhead');
  await expect(heads).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    within((await box(heads.nth(i))).w, 261, 2, `column ${i}`);
    within((await box(heads.nth(i))).h, 34, 2, `head ${i}`);
  }
  const metricHead = averagesGrid(page).getByRole('columnheader', { name: 'Metric' });
  within((await box(metricHead)).w, 144, 2, 'metric column');
  expect(await heads.first().evaluate((e) => getComputedStyle(e).textTransform)).toBe('none');
  const [sw, cw] = await part(page, 'averages-table').evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  await expect(heads.first().locator('[data-part="baseline-tag"]')).toHaveText('Baseline');
});

test('C-avg-2/3/4: 8 runs fit at 1440 (column >= 120, heads wrap), amended heights 315 table / 60 head', async ({
  page,
}) => {
  await openCompare(page, s.eight, 1440);
  const heads = part(page, 'averages-colhead');
  await expect(heads).toHaveCount(8);
  within((await box(heads.first())).w, 131, 3, 'column');
  expect((await box(heads.first())).w).toBeGreaterThanOrEqual(120);
  expect((await box(heads.first())).h).toBeLessThanOrEqual(62); // amended from 54: letter badge + name wrap to 3 lines
  const [sw, cw] = await part(page, 'averages-table').evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  expect((await box(part(page, 'averages-table'))).h).toBeLessThanOrEqual(320); // amended from 296
  for (const cell of await part(page, 'averages-cell').filter({ has: page.locator('[data-part=averages-value]') }).all())
    within((await box(cell)).h, 76, 2, 'metric cell at 8 runs');
});

test('C-avg-2: 1024: 4 runs fit (157), 8 runs scroll (>= 1104) and the metric column stays pinned', async ({ page }) => {
  await openCompare(page, s.four, 1024);
  within((await box(part(page, 'averages-colhead').first())).w, 157, 3, 'column at 1024');
  const [sw, cw] = await part(page, 'averages-table').evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  await openCompare(page, s.eight, 1024);
  const t = part(page, 'averages-table');
  const [sw8, cw8] = await t.evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw8).toBeGreaterThanOrEqual(1104 - 2);
  expect(sw8).toBeGreaterThan(cw8);
  const head = averagesGrid(page).getByRole('columnheader', { name: 'Metric' });
  const x0 = (await box(head)).x;
  await t.evaluate((e) => e.scrollTo(300, 0));
  within((await box(head)).x, x0, 2, 'pinned metric column');
});

test('C-avg-4/5/6/8: row heights, the verdict box only beyond noise, the change line, latency and errors', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const rows = await page.evaluate(() => {
    const q = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
    return {
      metric: q('[data-part="averages-metric-row"] [data-part="averages-cell"]').map((e) => Math.round(e.getBoundingClientRect().height)),
      latency: q('[data-part="averages-latency-row"] [data-part="averages-cell"]').map((e) => Math.round(e.getBoundingClientRect().height)),
      errors: q('[data-part="averages-errors-row"] [data-part="averages-cell"]').map((e) => Math.round(e.getBoundingClientRect().height)),
      table: Math.round(document.querySelector('[data-part="averages-table"]')!.getBoundingClientRect().height),
    };
  });
  for (const h of rows.metric) within(h, 76, 2, 'metric cell');
  for (const h of rows.latency) within(h, 51, 2, 'latency cell');
  for (const h of rows.errors) within(h, 44, 2, 'errors cell');
  within(rows.table, 283, 6, 'table');
  // the value box: 20 high, mono 12/600, always a 1 px border, coloured only beyond the noise band
  const vals = part(page, 'averages-value');
  const n = await vals.count();
  expect(n).toBe(8);
  let boxed = 0;
  for (let i = 0; i < n; i++) {
    const v = vals.nth(i);
    within((await box(v)).h, 20, 1, 'value box');
    const css = await v.evaluate((e) => {
      const c = getComputedStyle(e);
      return { f: c.fontFamily, w: c.fontWeight, b: c.borderTopWidth, col: c.borderTopColor, v: e.getAttribute('data-verdict') };
    });
    expect(css.f).toMatch(/mono/i);
    expect(Number(css.w)).toBe(600);
    expect(css.b).toBe('1px');
    if (css.v) {
      boxed += 1;
      expect(css.col).not.toBe('rgba(0, 0, 0, 0)');
    } else expect(css.col).toBe('rgba(0, 0, 0, 0)');
  }
  expect(boxed).toBeGreaterThan(0);
  expect(boxed).toBeLessThan(n);
  // the baseline cell has the value only
  const baseCell = part(page, 'averages-metric-row').first().locator('[data-part="averages-cell"]').first();
  await expect(baseCell.locator('[data-part="averages-delta"]')).toHaveCount(0);
  await expect(baseCell.locator('[data-part="averages-counts"]')).toHaveCount(0);
  // the change line: 15 high, mono 11, glyph + pts + band
  const delta = part(page, 'averages-delta').first();
  within((await box(delta)).h, 15, 1, 'delta');
  expect(await delta.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/mono/i);
  await expect(delta).toContainText(/[▲▼≈]/);
  await expect(delta).toContainText('pts');
  await expect(delta).toContainText('±');
  // latency row: value and percent; errors row
  await expect(part(page, 'averages-latency-row')).toContainText('%');
  await expect(part(page, 'averages-errors-row')).toContainText('2 task · 1 scorer');
  await expect(part(page, 'averages-errors-row')).toContainText('none');
});

test('C-avg-7: a count button filters, scrolls the list under the nav, shows the banner and moves nothing sideways', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const widths = async () => ({
    runs: (await box(part(page, 'run-grid'))).w,
    avg: (await box(part(page, 'averages-table'))).w,
    cats: (await box(part(page, 'section-categories'))).w,
    errs: (await box(part(page, 'section-errors'))).w,
    items: (await box(part(page, 'section-items'))).w,
  });
  const before = await widths();
  const btn = part(page, 'averages-counts').first().locator('button').first();
  within((await box(btn)).h, 20, 1, 'count button height');
  expect((await box(btn)).w).toBeGreaterThanOrEqual(24);
  await expect(btn).toHaveAttribute('aria-label', /^\d+ items improved vs baseline on correct/);
  await btn.click();
  await expect(part(page, 'baseline-delta-banner')).toBeVisible();
  await expect(part(page, 'baseline-delta-banner')).toContainText('improved');
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  await expectShown(page, 9);
  // the list head is under the nav (+12 +-6) once the scroll settles
  await expect
    .poll(async () => Math.abs((await box(part(page, 'section-items'))).y - (await box(part(page, 'section-nav'))).bottom - 12), { timeout: 5000 })
    .toBeLessThanOrEqual(6);
  expect(await widths()).toEqual(before);
  await expect(page.getByRole('complementary', { name: 'Quick filters' })).toHaveCount(0);
  void shell;
});

test('C-avg-7: count buttons activate with Enter and Space', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  const btn = part(page, 'averages-counts').first().locator('button').first();
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await btn.focus();
  await page.keyboard.press('Space');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
});

test('C-avg-9: at 390 one block per metric, one line per run (>= 44 high), no sideways scroll, table <= 1200', async ({
  page,
}) => {
  await openCompare(page, s.four, 390);
  const blocks = part(page, 'averages-table').locator('section[data-row]');
  await expect(blocks).toHaveCount(4);
  const lines = part(page, 'averages-cell');
  const n = await lines.count();
  expect(n).toBe(16);
  for (let i = 0; i < n; i++) expect((await box(lines.nth(i))).h).toBeGreaterThanOrEqual(44);
  expect((await box(part(page, 'averages-table'))).h).toBeLessThanOrEqual(1200);
  await noSidewaysScroll(page);
});
