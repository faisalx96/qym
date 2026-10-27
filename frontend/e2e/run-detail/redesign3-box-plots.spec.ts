/// <reference lib="dom" />
/** Round 3 P7 (run-detail.md section 6b): distribution box plots replace Min / Avg / Max / Total. P7-1 .. P7-20. */
import { test, expect, type Page } from '@playwright/test';
import {
  chooseOption,
  itemsCount,
  openRun,
  params,
  seedClassic,
  seedProject,
  seedWideRepeat,
  type Seeded,
} from './support';
import { PERCENT, seedCustomRun } from './cutover-support';

let s: Seeded;
let classic: string;
let wide: string;
let big: string;
let plain: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  s = await seedProject('rd-r3-box');
  classic = await seedClassic(s);
  wide = await seedWideRepeat(s);
  big = await seedClassic(s, { items: 1200, traced: 5 });
  // a run whose items carry no trace stats
  plain = await seedCustomRun(s, {
    name: 'no-trace-stats',
    specs: { accuracy: PERCENT },
    items: Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      input: `q${i}`,
      scores: { accuracy: { score: 0.5 } },
    })),
  });
});

const settle = (page: Page) =>
  page.waitForFunction(
    () =>
      !document
        .getAnimations()
        .some((a) =>
          /rise|count-in|grow|arrive|box-grow|dot-fade/.test((a as CSSAnimation).animationName ?? ''),
        ),
  );

const card = (page: Page, metric: string) =>
  page.locator(`[data-testid=metric-card][data-metric="${metric}"]`);

for (const width of [1440, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('P7-1, P7-5 (round 5 R2: no number row, Total moved to the card header): a numeric card is a box plot with a Total in its header; score and latency cards have no Total', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      const c = card(page, 'tokens_used');
      await expect(c.getByRole('img', { name: /^tokens_used/ })).toBeVisible();
      await expect(c.locator('dl[aria-label="Distribution values"]')).toHaveCount(0);
      await expect(c.getByTestId('box-total')).toContainText('Total');
      await expect(card(page, 'quality').getByTestId('box-total')).toHaveCount(0);
      await expect(page.locator('[data-cells], [class*=_cells_]')).toHaveCount(0);
      // no Min / Avg / Max / Total cell group any more
      await expect(c.getByText('Avg', { exact: true })).toHaveCount(0);
      await page.locator('#run-section-latency').scrollIntoViewIfNeeded();
      const rt = page.getByRole('region', { name: 'Response time' });
      await expect(rt).toBeVisible();
      await expect(rt.getByTestId('box-total')).toHaveCount(0);
    });

    test('P7-6, P7-7, P7-20 (round 5 R2: no cells; the plot labels do not overlap; card gap <= 16px): nothing clipped or overlapping; the plot fits its card; no dead space under it', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      await expect(card(page, 'tokens_used')).toBeVisible();
      await settle(page);
      for (const name of ['tokens_used', 'trace-tokens']) {
        const c =
          name === 'trace-tokens' ? page.getByTestId('trace-card').first() : card(page, 'tokens_used');
        const info = await c.evaluate((el) => {
          const slot = el.querySelector('[data-slot]')!.getBoundingClientRect();
          // round 5 review: an all-equal distribution (Tokens per item in this seed) is a compact note, not an svg
          const svg = el.querySelector('svg[role=img], [role=img]')!.getBoundingClientRect();
          const ticks = Array.from(el.querySelectorAll('svg text')).map((t) => t.getBoundingClientRect());
          ticks.sort((a, b) => a.left - b.left);
          const overlap = ticks.some(
            (t, i) =>
              i > 0 &&
              t.top > ticks[i - 1]!.top - 2 &&
              t.left < ticks[i - 1]!.right - 0.5 &&
              Math.abs(t.top - ticks[i - 1]!.top) < 4,
          );
          const card = el.getBoundingClientRect();
          let lowest = 0;
          el.querySelectorAll('*').forEach((n) => {
            const r = n.getBoundingClientRect();
            if (r.height > 0 && r.width > 0 && !n.closest('[class*=_header_]'))
              lowest = Math.max(lowest, r.bottom);
          });
          return {
            slotW: slot.width,
            svgW: svg.width,
            overlap,
            gap: card.bottom - lowest,
          };
        });
        expect(info.svgW, name).toBeLessThanOrEqual(info.slotW + 1);
        if (width === 390 && name !== 'trace-tokens') expect(info.svgW).toBeGreaterThanOrEqual(215); // 220 before the section panel took 30 px (owner decision H6); measured 218
        expect(info.overlap, name).toBe(false);
        expect(info.gap, name).toBeLessThanOrEqual(16);
      }
    });

    test('P7-8: every mark has a tooltip with its value on hover and on keyboard focus', async ({ page }) => {
      await openRun(page, s.slug, classic);
      const c = card(page, 'tokens_used');
      await expect(c.getByRole('img', { name: /^tokens_used/ })).toBeVisible();
      await settle(page);
      for (const [kind, text] of [
        ['box', 'Middle 50%'],
        ['median', 'Median'],
        ['mean', 'Mean'],
        ['cap-low', '5th percentile'],
        ['cap-high', '95th percentile'],
        ['dot-min', '·'],
        ['dot-max', '·'],
      ] as const) {
        const mark = c.locator(`[data-mark-kind="${kind}"]`).first();
        await mark.focus();
        await expect(page.getByRole('tooltip'), `focus ${kind}`).toContainText(text);
        await page.keyboard.press('Escape');
      }
      const box = c.locator('[data-mark-kind=box]').first();
      await box.hover({ position: { x: 3, y: 5 }, force: true });
      await expect(page.getByRole('tooltip')).toContainText('Middle 50%');
      // the middle of the box body reads the box too: the mean hit area is the diamond only
      const bb = (await box.boundingBox())!;
      await page.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height / 2);
      await expect(page.getByRole('tooltip')).toContainText('Middle 50%');
    });

    test('P7-9: Tab order box, low whisker, high whisker, min, max; Enter on the box filters; Enter on a dot opens the item; Escape closes a tooltip', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      const c = card(page, 'tokens_used');
      await expect(c.getByRole('img', { name: /^tokens_used/ })).toBeVisible();
      await settle(page);
      await c.locator('[data-mark-kind=box]').first().focus();
      const order: string[] = ['box'];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        order.push((await page.evaluate(() => document.activeElement?.getAttribute('data-mark-kind'))) ?? '');
      }
      expect(order).toEqual(['box', 'cap-low', 'cap-high', 'dot-min', 'dot-max']);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      // a dot opens its item
      await page.keyboard.press('Enter');
      await expect.poll(() => params(page).get('item')).not.toBeNull();
    });
  });
}

test('P7-9b: Enter on the box applies a p25-p75 filter (a scope chip and fewer items)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  const before = (await itemsCount(page))[0];
  const box = card(page, 'tokens_used').locator('[data-mark-kind=box]').first();
  await box.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(before);
  await expect(page.getByTestId('clear-filters')).toBeVisible();
  await page.getByTestId('clear-filters').click();
  await expect.poll(async () => (await itemsCount(page))[0]).toBe(before);
});

test('P7-10: with 1,200 items no plot holds more than 80 dots and min and max are drawn', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, big);
  const c = card(page, 'tokens_used');
  await expect(c.getByRole('img', { name: /^tokens_used/ })).toBeVisible();
  const n = await c.locator('circle[data-mark-kind^=dot]').count();
  expect(n).toBeLessThanOrEqual(80);
  expect(await c.locator('[data-mark-kind=dot-min]').count()).toBe(1);
  expect(await c.locator('[data-mark-kind=dot-max]').count()).toBe(1);
});

test('P7-12: the response-time card keeps Mean, the pins and the histogram, adds a box strip on the histogram x scale and fastest / slowest', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic, 'panel=latency');
  const rt = page.getByRole('region', { name: 'Response time' });
  await expect(rt).toBeVisible();
  await expect(rt.getByText('Mean', { exact: true })).toBeVisible();
  for (const pin of ['p50', 'p90', 'p95'])
    await expect(rt.getByRole('button', { name: new RegExp(`^${pin} `) })).toBeVisible();
  await expect(rt.getByRole('group', { name: /Latency histogram/ })).toBeVisible();
  await expect(rt.getByText('fastest')).toBeVisible();
  await expect(rt.getByText('slowest')).toBeVisible();
  const strip = rt.locator('svg[data-variant=strip]');
  await expect(strip).toBeVisible();
  await settle(page);
  const geo = await rt.evaluate((el) => {
    const hist = el.querySelector('[role=group][aria-label^="Latency histogram"]')!.getBoundingClientRect();
    const svg = el.querySelector('svg[data-variant=strip]')!.getBoundingClientRect();
    return { histLeft: hist.left, histRight: hist.right, svgLeft: svg.left, svgRight: svg.right };
  });
  expect(Math.abs(geo.histLeft - geo.svgLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(geo.histRight - geo.svgRight)).toBeLessThanOrEqual(1);
  // the strip filters like the histogram: its box selects p25 to p75
  await rt.locator('[data-mark-kind=box]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => params(page).get('filters') ?? '').toContain('latency');
});

test('P7-13: "{metric} by pass" has one 32px row per pass, follows the Select, a row opens ?pass=n; boolean metrics hide it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRun(page, s.slug, wide, 'panel=repeat');
  const panel = page.getByTestId('repeat-analysis');
  await expect(panel.getByRole('list', { name: 'Repeat run statistics' })).toBeVisible();
  // the default metric (correct) is boolean: no per-pass card
  await expect(panel.getByRole('region', { name: /by pass$/ })).toHaveCount(0);
  await chooseOption(page, panel.getByRole('button', { name: /Metric/ }).first(), 'rubric_metric_01');
  const dist = panel.getByRole('region', { name: 'rubric_metric_01 by pass' });
  await expect(dist).toBeVisible();
  const rows = dist.locator('button[data-pass]');
  await expect(rows).toHaveCount(10);
  const hs = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of hs) expect(Math.abs(h - 32)).toBeLessThanOrEqual(1);
  await rows.nth(2).click();
  await expect.poll(() => params(page).get('pass')).toBe('3');
});

test('P7-15: Tokens and Cost per item cards need at least two items with trace stats', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await expect(page.getByRole('region', { name: 'Tokens per item' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cost per item' })).toBeVisible();
  await openRun(page, s.slug, plain);
  await expect(page.getByTestId('metric-card').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tokens per item' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Cost per item' })).toHaveCount(0);
});

test('P7-18: under prefers-reduced-motion no box plot mark is animated', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __a: string[] }).__a = seen;
    new MutationObserver((muts) =>
      muts.forEach((m) =>
        m.addedNodes.forEach(
          (n) =>
            n instanceof Element &&
            n
              .querySelectorAll('svg[role=img] rect, svg[role=img] circle')
              .forEach((el) => seen.push(getComputedStyle(el).animationName)),
        ),
      ),
    ).observe(document, { childList: true, subtree: true });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await expect(card(page, 'tokens_used').getByRole('img', { name: /^tokens_used/ })).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { __a: string[] }).__a);
  expect(seen.length).toBeGreaterThan(3);
  expect(new Set(seen)).toEqual(new Set(['none']));
});
