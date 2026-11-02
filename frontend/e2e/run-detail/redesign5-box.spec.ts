/// <reference lib="dom" />
/**
 * Round 5 R2 (docs/internal/ui-migration/redesign5/run-detail.md): coloured box plots, no number row.
 * R2-1 .. R2-15 on `classic` (tokens_used, Tokens per item, response time), `passes19` (per-pass rows of `quality`)
 * and the Steps rows (mocked step-latency payload), at 1440 and 390.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { chooseOption, openRun, seedClassic, seedProject, seedR5, type Seeded } from './support';

let s: Seeded;
let classic: string;
let passes19: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  s = await seedProject('rd-r5-box');
  classic = await seedClassic(s);
  passes19 = (await seedR5(s)).passes19;
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

/** The resolved colour of a token, as `rgb(...)` (a probe element in the page). */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const el = document.createElement('i');
    el.style.color = `var(${n})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, name);
}

const rgb = (c: string): [number, number, number] => {
  const m = c.match(/[\d.]+/g)!.map(Number);
  return [m[0]!, m[1]!, m[2]!];
};
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const bandOf = (v: number) => (v >= 0.9 ? 5 : v >= 0.75 ? 4 : v >= 0.6 ? 3 : v >= 0.4 ? 2 : 1);

async function glyphColours(plot: Locator) {
  return plot.evaluate((el) => {
    const cs = (sel: string, prop: 'stroke' | 'fill') => {
      const n = el.querySelector(sel);
      return n ? getComputedStyle(n)[prop] : null;
    };
    return {
      iqrStroke: cs('rect[class*=iqr]', 'stroke'),
      iqrFill: cs('rect[class*=iqr]', 'fill'),
      whisker: cs('line[class*=whisker]', 'stroke'),
      cap: cs('line[class*=cap]', 'stroke'),
      median: cs('line[class*=median]', 'stroke'),
      mean: cs('path[class*=meanMark]', 'stroke'),
      dots: Array.from(el.querySelectorAll('circle[class*=outlier]')).map((c) => ({
        fill: getComputedStyle(c).fill,
        tail: c.hasAttribute('data-tail'),
      })),
    };
  });
}

async function mockSteps(page: Page) {
  const g = (step: string, over: Record<string, unknown> = {}) => ({
    phase: 'task',
    kind: 'LLM',
    step_type: step,
    n: 40,
    error_count: 0,
    mean_ms: 900,
    median_ms: 800,
    min_ms: 200,
    max_ms: 2600,
    p5_ms: 300,
    p25_ms: 500,
    p75_ms: 1200,
    p95_ms: 2000,
    cv: 0.4,
    tokens_total: 500,
    ...over,
  });
  await page.route(/\/api\/runs\/step-latency\?/, (route) =>
    route.fulfill({
      json: {
        run_ids: ['x'],
        rollup: 'site',
        passes: [1],
        trace_count: 4,
        groups: [
          g('llm:generate'),
          g('tool:search', {
            kind: 'TOOL',
            median_ms: 300,
            mean_ms: 380,
            p25_ms: 200,
            p75_ms: 500,
            p5_ms: 100,
            p95_ms: 900,
          }),
        ],
        phases: [g('task', { n: 4, median_ms: 1500, mean_ms: 1700 })],
      },
    }),
  );
}

for (const width of [1440, 390] as const) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('R2-1, R2-8, R2-9, R2-12: no number row anywhere; Total and the help marker are in the header; the card is short', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      const tokens = card(page, 'tokens_used');
      await expect(tokens.getByRole('img', { name: /^tokens_used/ })).toBeVisible();
      await settle(page);
      // R2-1: no dl, no cell text outside a tooltip
      const cells = await page.evaluate(() => {
        const hit: string[] = [];
        document.querySelectorAll('[data-testid=metric-card] *, [data-testid=trace-card] *').forEach((el) => {
          if (el.closest('[role=tooltip]') || el.children.length) return;
          const t = (el.textContent ?? '').trim();
          if (/^(min|p25|median|med|mean|p75|max)$/i.test(t)) hit.push(t);
        });
        return hit;
      });
      // "Mean" is a label of the response-time KPI, never of an overview box card
      expect(cells).toEqual([]);
      await expect(page.locator('dl[aria-label="Distribution values"]')).toHaveCount(0);
      // R2-8: Total in the header of the tokens card, not under the plot; none for scores
      const total = tokens.getByTestId('box-total');
      await expect(total).toBeVisible();
      expect(await total.evaluate((el) => !!el.closest('[class*=_header_]'))).toBe(true);
      await expect(card(page, 'quality').getByTestId('box-total')).toHaveCount(0);
      // R2-9: height and the 16px rule
      // natural height: a row neighbour (the histograms) may stretch the card, so measure it aligned to the start
      const info = await tokens.evaluate((el) => {
        (el as HTMLElement).style.alignSelf = 'start';
        const r = el.getBoundingClientRect();
        let lowest = 0;
        el.querySelectorAll('*').forEach((n) => {
          const b = n.getBoundingClientRect();
          if (b.height > 0 && b.width > 0 && !n.closest('[class*=_header_]'))
            lowest = Math.max(lowest, b.bottom);
        });
        return { height: r.height, gap: r.bottom - lowest };
      });
      // amended (spec R2-9): 220 at 1440; 232 at 390, where the header wraps and the card carries the 18px error note line
      console.log(`R2-9 tokens_used ${width}px height ${info.height} gap ${info.gap}`);
      expect(info.height).toBeLessThanOrEqual(width === 390 ? 232 : 220);
      expect(info.gap).toBeLessThanOrEqual(16);
      // R2-12: a help marker in the header, no five-entry legend list
      await expect(tokens.getByRole('button', { name: 'How to read the box plot' })).toBeVisible();
      await expect(tokens.locator('ul[aria-label="How to read the box plot"]')).toHaveCount(0);
      await expect(
        page.getByTestId('trace-card').first().getByRole('button', { name: 'How to read the box plot' }),
      ).toBeVisible();
    });

    test('R2-3, R2-4, R2-14: tokens and latency glyphs are series 1 (latency tail --score-2); contrast >= 3:1', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      const plot = card(page, 'tokens_used').locator('svg[role=img]');
      await expect(plot).toBeVisible();
      await settle(page);
      const chart1 = await token(page, '--chart-1');
      const g = await glyphColours(plot);
      for (const k of ['iqrStroke', 'whisker', 'cap', 'median', 'mean'] as const)
        expect(g[k], k).toBe(chart1);
      for (const d of g.dots) expect(d.fill).toBe(chart1);
      // R2-4: stroke against the surface and against the 20% box fill (computed from tokens)
      const surface = rgb(await token(page, '--bg-surface'));
      const mix = (c: [number, number, number]) =>
        c.map((v, i) => Math.round(v * 0.2 + surface[i]! * 0.8)) as [number, number, number];
      for (const t of ['--chart-1', '--score-1', '--score-2', '--score-3', '--score-4', '--score-5']) {
        const c = rgb(await token(page, t));
        expect(contrast(c, surface), `${t} on surface`).toBeGreaterThanOrEqual(3);
        expect(contrast(c, mix(c)), `${t} on its box fill`).toBeGreaterThanOrEqual(3);
      }
      // latency: the strip is series 1, dots above p95 are --score-2
      await openRun(page, s.slug, classic, 'panel=latency');
      const rt = page.getByRole('region', { name: 'Response time' });
      const strip = rt.locator('svg[data-variant=strip]');
      await expect(strip).toBeVisible();
      await settle(page);
      const lg = await glyphColours(strip);
      expect(lg.iqrStroke).toBe(chart1);
      expect(lg.median).toBe(chart1);
      const score2 = await token(page, '--score-2');
      for (const d of lg.dots) expect(d.fill).toBe(d.tail ? score2 : chart1);
      await expect(rt.getByRole('button', { name: 'How to read the box plot' })).toBeVisible();
    });

    test('R2-5, R2-6, R2-7, R2-13: median above the line, min and max under the baseline, six numbers in the tooltip and the aria-label', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      const c = card(page, 'tokens_used');
      const plot = c.locator('svg[role=img]');
      await expect(plot).toBeVisible();
      await settle(page);
      const t = await plot.evaluate((svg) => {
        const box = svg.querySelector('rect[class*=iqr]')!.getBoundingClientRect();
        const line = svg.querySelector('line[class*=axisLine]')!.getBoundingClientRect();
        return {
          boxTop: box.top,
          axisY: line.top,
          texts: Array.from(svg.querySelectorAll('text')).map((x) => ({
            text: x.textContent ?? '',
            top: x.getBoundingClientRect().top,
            bottom: x.getBoundingClientRect().bottom,
            cls: x.getAttribute('class') ?? '',
          })),
        };
      });
      const median = t.texts.filter((x) => /medianLabel/.test(x.cls));
      const ends = t.texts.filter((x) => /endLabel/.test(x.cls));
      expect(median).toHaveLength(1);
      expect(median[0]!.bottom).toBeLessThanOrEqual(t.boxTop + 0.5);
      expect(ends.length === 2 || (ends.length === 1 && / to /.test(ends[0]!.text))).toBe(true);
      for (const e of ends) expect(e.top).toBeGreaterThanOrEqual(t.axisY - 0.5);
      expect(t.texts).toHaveLength(median.length + ends.length);
      // R2-7: the sentence names the six numbers and the total
      const label = (await plot.getAttribute('aria-label'))!;
      for (const w of ['minimum', '25th percentile', 'median', 'mean', '75th percentile', 'maximum', 'total'])
        expect(label, w).toContain(w);
      // R2-6: hover and focus show all six numbers and the IQR
      await settle(page);
      const mark = c.locator('[data-mark-kind=box]').first();
      await mark.focus();
      const tip = page.getByRole('tooltip');
      for (const w of ['Min', 'P25', 'Median', 'Mean', 'P75', 'Max', 'IQR'])
        await expect(tip).toContainText(w);
      await page.keyboard.press('Escape');
      await mark.hover({ position: { x: 3, y: 5 }, force: true });
      for (const w of ['Min', 'P25', 'Median', 'Mean', 'P75', 'Max', 'IQR'])
        await expect(tip).toContainText(w);
    });

    test('R2-2, R2-10, R2-13: per-pass rows: 32px rows, 72px tag, 52px median column, each row coloured by its own median band', async ({
      page,
    }) => {
      await openRun(page, s.slug, passes19, 'panel=repeat');
      const panel = page.getByTestId('repeat-analysis');
      await expect(panel.getByRole('list', { name: 'Repeat run statistics' })).toBeVisible();
      await chooseOption(page, panel.getByRole('button', { name: /Metric/ }).first(), 'quality');
      const dist = panel.getByRole('region', { name: 'quality by pass' });
      await expect(dist).toBeVisible();
      await settle(page);
      const rows = await dist.locator('button[data-pass]').evaluateAll((els) =>
        els.map((e) => {
          const kids = Array.from(e.children) as HTMLElement[];
          const tag = kids[0]!;
          const med = kids[2]!;
          const track = e.querySelector('[data-box-track]') as HTMLElement | null;
          const css = (n: Element, p: string) => getComputedStyle(n).getPropertyValue(p);
          const box = track?.children[1] as HTMLElement | undefined;
          return {
            h: e.getBoundingClientRect().height,
            tagW: tag.getBoundingClientRect().width,
            medW: med.getBoundingClientRect().width,
            medText: med.getAttribute('data-text') ?? '',
            band: track?.getAttribute('data-band') ?? null,
            tagBand: tag.querySelector('[data-band]') !== null || tag.hasAttribute('data-band'),
            border: box ? getComputedStyle(box).borderTopColor : null,
            whisker: track ? getComputedStyle(track.children[0]!).borderTopColor : null,
            median: track ? getComputedStyle(track.children[2]!).backgroundColor : null,
            mean: track ? getComputedStyle(track.children[3]!).borderTopColor : null,
            tag: css(tag, 'color'),
          };
        }),
      );
      expect(rows).toHaveLength(19);
      const tokens: Record<string, string> = {};
      for (const n of [1, 2, 3, 4, 5, 'chart-1'] as const)
        tokens[String(n)] = await token(page, typeof n === 'number' ? `--score-${n}` : `--${n}`);
      const seen = new Set<string>();
      for (const r of rows) {
        expect(Math.abs(r.h - 32)).toBeLessThanOrEqual(1);
        expect(Math.abs(r.tagW - 72)).toBeLessThanOrEqual(1);
        expect(Math.abs(r.medW - 52)).toBeLessThanOrEqual(1);
        expect(r.tagBand).toBe(false);
        const median = parseFloat(r.medText) / 100;
        const expected = String(bandOf(Math.round(median * 1000) / 1000));
        // the median is printed with one decimal; a value on a band edge may round either way
        const near = [0.4, 0.6, 0.75, 0.9].some((e) => Math.abs(median - e) < 0.0006);
        if (!near) expect(r.band, `median ${r.medText}`).toBe(expected);
        const want = tokens[r.band!]!;
        expect(r.border).toBe(want);
        expect(r.whisker).toBe(want);
        expect(r.median).toBe(want);
        expect(r.mean).toBe(want);
        seen.add(r.band!);
      }
      // not every pass has the same verdict colour in this fixture
      expect(seen.size).toBeGreaterThan(1);
      await expect(dist.locator('ul[aria-label="How to read the box plot"]')).toHaveCount(0);
      await expect(dist.getByText(/Box: middle 50%/)).toHaveCount(1); // rows cards keep one key line
    });

    test('R2-3: Steps rows take series 1 and keep one key line', async ({ page }) => {
      await mockSteps(page);
      await openRun(page, s.slug, classic, 'panel=latency');
      const steps = page.getByRole('region', { name: 'Steps' });
      await steps.getByRole('button', { name: 'Expand all steps' }).click();
      await settle(page);
      const tracks = await steps.locator('[data-box-track]').evaluateAll((els) =>
        els.map((e) => ({
          series: e.getAttribute('data-series'),
          band: e.getAttribute('data-band'),
          border: getComputedStyle(e.children[1]!).borderTopColor,
        })),
      );
      expect(tracks.length).toBeGreaterThan(1);
      const chart1 = await token(page, '--chart-1');
      for (const t of tracks) {
        expect(t.series).toBe('1');
        expect(t.band).toBeNull();
        expect(t.border).toBe(chart1);
      }
      await expect(steps.getByText(/Box: middle 50%/)).toHaveCount(1);
    });
  });
}

test('R2-11: the response-time strip keeps the histogram x scale and the Mean / pins', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic, 'panel=latency');
  const rt = page.getByRole('region', { name: 'Response time' });
  await expect(rt.locator('svg[data-variant=strip]')).toBeVisible();
  await settle(page);
  await expect(rt.getByText('Mean', { exact: true })).toBeVisible();
  for (const pin of ['p50', 'p90', 'p95'])
    await expect(rt.getByRole('button', { name: new RegExp(`^${pin} `) })).toBeVisible();
  const geo = await rt.evaluate((el) => {
    const hist = el.querySelector('[role=group][aria-label^="Latency histogram"]')!.getBoundingClientRect();
    const svg = el.querySelector('svg[data-variant=strip]')!.getBoundingClientRect();
    return { dl: Math.abs(hist.left - svg.left), dr: Math.abs(hist.right - svg.right) };
  });
  expect(geo.dl).toBeLessThanOrEqual(1);
  expect(geo.dr).toBeLessThanOrEqual(1);
});

test('R2-15: under prefers-reduced-motion no box mark animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  const plot = card(page, 'tokens_used').locator('svg[role=img]');
  await expect(plot).toBeVisible();
  const names = await plot.evaluate((svg) =>
    Array.from(svg.querySelectorAll('rect, circle, line, path')).map(
      (n) => getComputedStyle(n).animationName,
    ),
  );
  expect(names.length).toBeGreaterThan(3);
  expect(new Set(names)).toEqual(new Set(['none']));
});
