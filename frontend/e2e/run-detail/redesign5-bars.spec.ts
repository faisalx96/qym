/// <reference lib="dom" />
/**
 * Round 5 R1 (docs/internal/ui-migration/redesign5/run-detail.md): bars never drop below the x axis.
 * Criteria R1-1 .. R1-12 on run `details` (11 columns), `passes19` (20 columns), the classic latency histogram and the
 * gallery sweep (R1-3), at 1440 and 390.
 */
import { test, expect, type Page } from '@playwright/test';
import { openRun, seedClassic, seedProject, seedR5, type Seeded } from './support';

let s: Seeded;
let details: string;
let passes19: string;
let classic: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  s = await seedProject('rd-r5-bars');
  const r5 = await seedR5(s);
  details = r5.details;
  passes19 = r5.passes19;
  classic = await seedClassic(s);
});

const WIDTHS = [1440, 390] as const;

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !document
        .getAnimations()
        .some((a) => /rise|count-in|grow|arrive/.test((a as CSSAnimation).animationName ?? '')),
  );
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}
interface ColInfo {
  well: Rect;
  bar: Rect;
  foot: Rect;
  count: Rect & { text: string; tier: string | null };
  axis: (Rect & { text: string }) | null;
  barHeight: number;
  wellBorder: string;
  wellBorderColor: string;
  zero: boolean;
}
interface PlotInfo {
  name: string;
  box: Rect;
  dense: boolean;
  cols: ColInfo[];
  card: { bottom: number; lowest: number; scrollH: number; clientH: number } | null;
}

/** Geometry of every bar plot (role=group built by BarColumns) currently in the DOM. */
async function plots(page: Page, nameRe: string): Promise<PlotInfo[]> {
  await settled(page);
  return page.evaluate((re) => {
    const rect = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const text = (el: Element) =>
      getComputedStyle(el, '::before')
        .content.replace(/^"|"$/g, '')
        .replace(/\u00a0/g, '')
        .trim();
    return Array.from(document.querySelectorAll('[role=group]'))
      .filter(
        (g) => g.querySelector('[data-part=bar]') && new RegExp(re).test(g.getAttribute('aria-label') ?? ''),
      )
      .map((g) => {
        const card = g.closest('section[aria-label]');
        let lowest = 0;
        card?.querySelectorAll('*').forEach((el) => {
          if (el.closest('[class*=_head_]') || el.closest('[class*=_header_]')) return;
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.width > 0) lowest = Math.max(lowest, r.bottom);
        });
        return {
          name: g.getAttribute('aria-label') ?? '',
          box: rect(g),
          dense: g.hasAttribute('data-dense'),
          card: card
            ? {
                bottom: card.getBoundingClientRect().bottom,
                lowest,
                scrollH: card.scrollHeight,
                clientH: card.clientHeight,
              }
            : null,
          cols: Array.from(g.children)
            .filter((c) => c.querySelector('[data-part=bar]'))
            .map((c) => {
              const well = c.querySelector('[data-part=well]')!;
              const count = c.querySelector('[data-part=count]')!;
              const axis = c.querySelector('[data-part=axis]');
              const cs = getComputedStyle(well);
              return {
                well: rect(well),
                bar: rect(c.querySelector('[data-part=bar]')!),
                foot: rect(c.querySelector('[data-part=foot]')!),
                count: {
                  ...rect(count),
                  text: count.getAttribute('data-text') ?? '',
                  tier: c.getAttribute('data-tier'),
                },
                axis: axis ? { ...rect(axis), text: text(axis) } : null,
                barHeight: c.querySelector('[data-part=bar]')!.getBoundingClientRect().height,
                wellBorder: cs.borderBlockEndWidth,
                wellBorderColor: cs.borderBlockEndColor,
                zero: c.hasAttribute('data-zero'),
              };
            }),
        };
      });
  }, nameRe);
}

/** R1-8: no two printed counts intersect. */
function expectCountsApart(p: PlotInfo): void {
  const shown = p.cols.filter((c) => c.count.text !== '');
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i]!.count;
      const b = shown[j]!.count;
      const hit = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(hit, `${p.name}: counts ${i} and ${j} intersect`).toBe(false);
    }
}

/** R1-1 shape: every bar bottom equals the top of its well's axis line. */
function expectLevel(p: PlotInfo): void {
  expect(p.cols.length, `${p.name} has columns`).toBeGreaterThan(0);
  for (const c of p.cols) {
    expect(
      Math.abs(c.bar.bottom - (c.well.bottom - 1)),
      `${p.name} bar bottom to axis line`,
    ).toBeLessThanOrEqual(0.5);
  }
  const bottoms = new Set(p.cols.map((c) => Math.round(c.bar.bottom * 2) / 2));
  expect(bottoms.size, `${p.name} distinct bar bottoms`).toBe(1);
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('R1-1, R1-4, R1-9, R1-11: the 11-column histograms stand on one axis line, equal feet, a continuous 1px line, 16px under the plot', async ({
      page,
    }) => {
      await openRun(page, s.slug, details);
      await expect(page.getByTestId('metric-card').first()).toBeVisible();
      const all = await plots(page, 'score distribution');
      expect(all.length).toBeGreaterThanOrEqual(4);
      for (const p of all) {
        expect(p.cols).toHaveLength(11);
        expectLevel(p);
        // R1-4: one foot height, labelled or thinned
        expect(new Set(p.cols.map((c) => Math.round(c.foot.height))).size).toBe(1);
        // R1-9: the 1px --border-default line under every well, continuous across the gaps
        for (const c of p.cols) expect(c.wellBorder).toBe('1px');
        const lefts = p.cols.map((c) => c.well.left).sort((a, b) => a - b);
        const rights = p.cols.map((c) => c.well.right).sort((a, b) => a - b);
        for (let i = 1; i < p.cols.length; i++)
          expect(
            p.cols[i]!.well.left - p.cols[i - 1]!.well.right,
            `${p.name} gap in the axis line`,
          ).toBeLessThanOrEqual(1);
        expect(lefts[0]! - p.box.left).toBeLessThanOrEqual(3);
        expect(p.box.right - rights[rights.length - 1]!).toBeLessThanOrEqual(3);
        // R1-11
        expect(p.card!.bottom - p.card!.lowest, `${p.name} space under the plot`).toBeLessThanOrEqual(16);
      }
    });

    test('R1-2: "Passes passed" with 20 columns stands on one axis line', async ({ page }) => {
      await openRun(page, s.slug, passes19, 'panel=repeat');
      await expect(page.getByRole('group', { name: /^Items by number of passes/ })).toBeVisible();
      const [p] = await plots(page, '^Items by number of passes');
      expect(p!.cols).toHaveLength(20);
      expectLevel(p!);
      expect(new Set(p!.cols.map((c) => Math.round(c.foot.height))).size).toBe(1);
    });

    test('R1-5, R1-6, R1-8: counts sit on their bar, nothing is clipped, dense counts alternate tiers without overlap', async ({
      page,
    }) => {
      await openRun(page, s.slug, passes19, 'panel=repeat');
      await expect(page.getByRole('group', { name: /^Items by number of passes/ })).toBeVisible();
      const [p] = await plots(page, '^Items by number of passes');
      for (const c of p!.cols) {
        if (c.barHeight <= 0 || c.count.text === '') continue;
        const gap = c.bar.top - c.count.bottom;
        if (c.count.tier === '2') {
          expect(gap).toBeLessThanOrEqual(20.5);
          expect(gap).toBeGreaterThanOrEqual(-0.5);
        } else {
          expect(gap).toBeLessThanOrEqual(4);
          expect(gap).toBeGreaterThanOrEqual(-0.5);
        }
      }
      // R1-6: the tallest count is inside the plot
      const tallest = p!.cols
        .filter((c) => c.count.text !== '')
        .reduce((a, b) => (a.count.top < b.count.top ? a : b));
      expect(tallest.count.top).toBeGreaterThanOrEqual(p!.box.top - 0.5);
      expect(p!.box.height).toBeGreaterThanOrEqual(146);
      expect(p!.card!.scrollH).toBeLessThanOrEqual(p!.card!.clientH + 1);
      // the fixture has 6 items per pass, so its counts are one digit and the plot is not dense (the dense case is the sweep)
      expect(p!.dense).toBe(false);
      expectCountsApart(p!);
    });

    test('R1-7: shown axis labels never touch (gap >= 4px) and column 0 is labelled, 11 and 20 columns', async ({
      page,
    }) => {
      for (const [id, panel, re] of [
        [details, '', 'score distribution'],
        [passes19, 'panel=repeat', '^Items by number of passes'],
      ] as const) {
        await openRun(page, s.slug, id, panel);
        await expect(
          page
            .getByTestId('metric-card')
            .or(page.getByRole('group', { name: new RegExp(re) }))
            .first(),
        ).toBeVisible();
        for (const p of await plots(page, re)) {
          expect(p.cols[0]!.axis!.text, `${p.name} column 0`).not.toBe('');
          const shown = p.cols.filter((c) => c.axis && c.axis.text !== '');
          expect(shown.length).toBeLessThan(p.cols.length);
          // the axis span is shrink-to-fit in the foot: its box is the text
          const widths = await page.evaluate((r) => {
            const g = Array.from(document.querySelectorAll('[role=group]')).find((x) =>
              new RegExp(r).test(x.getAttribute('aria-label') ?? ''),
            )!;
            return Array.from(g.querySelectorAll('[data-part=axis]')).map((el) => {
              const content = getComputedStyle(el, '::before')
                .content.replace(/^"|"$/g, '')
                .replace(/\u00a0/g, '')
                .trim();
              if (!content) return null;
              const r2 = el.getBoundingClientRect(); // shrink-to-fit in the foot, so the box is the text
              return { left: r2.left, right: r2.right };
            });
          }, re);
          const boxes = widths.filter((w): w is { left: number; right: number } => w !== null);
          for (let i = 1; i < boxes.length; i++)
            expect(boxes[i]!.left - boxes[i - 1]!.right, `${p.name} label gap`).toBeGreaterThanOrEqual(4);
        }
      }
    });

    test('R1-10: bars are at most 44px wide; an empty bucket draws no bar', async ({ page }) => {
      await openRun(page, s.slug, classic);
      await expect(page.getByTestId('metric-card').first()).toBeVisible();
      for (const p of await plots(page, '.')) {
        for (const c of p.cols) {
          expect(c.bar.width).toBeLessThanOrEqual(44.5);
          if (c.zero) expect(c.barHeight).toBe(0);
        }
      }
    });

    test('R1-4: the latency histogram and the pass/fail split keep equal feet and stand on the baseline', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic, 'panel=latency');
      await expect(page.getByRole('group', { name: /Latency histogram/ })).toBeVisible();
      for (const p of await plots(page, 'Latency histogram|pass and fail split')) {
        expectLevel(p);
        expect(new Set(p.cols.map((c) => Math.round(c.foot.height))).size).toBe(1);
      }
    });
  });
}

test('R1-3: the real BarColumns with 1 to 20 columns (counts 0..120) stands on its axis line at 1440 and 390', async ({
  page,
}) => {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/__ui#round5');
    await expect(page.locator('[data-r5=bars-sweep]')).toBeVisible();
    const all = await plots(page, '^sweep \\d+ columns$');
    expect(all).toHaveLength(20);
    all.forEach((p, i) => {
      expect(p.cols).toHaveLength(i + 1);
      expectLevel(p);
      const feet = new Set(p.cols.map((c) => Math.round(c.foot.height)));
      expect(feet.size).toBe(1);
      expect([18, 32]).toContain([...feet][0]);
      expectCountsApart(p);
      // R1-8 / R1-5: when the plot is dense, tiers alternate by column parity and every count is within 20px above its bar
      if (p.dense) {
        p.cols.forEach((c, k) => expect(c.count.tier).toBe(k % 2 === 1 ? '2' : null));
        for (const c of p.cols) {
          if (c.barHeight <= 0 || c.count.text === '') continue;
          const gap = c.bar.top - c.count.bottom;
          expect(gap).toBeGreaterThanOrEqual(-0.5);
          expect(gap).toBeLessThanOrEqual(c.count.tier === '2' ? 20.5 : 4);
        }
      }
    });
    // a 20 column plot with two and three digit counts is dense at 390 (pitch 12 < 3 digits x 7 + 2)
    if (w === 390) expect(all[19]!.dense).toBe(true);
  }
});

test('R1-12: under prefers-reduced-motion no bar or count animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRun(page, s.slug, details);
  await expect(page.getByTestId('metric-card').first()).toBeVisible();
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-part=bar],[data-part=count]')).map(
      (el) => getComputedStyle(el).animationName,
    ),
  );
  expect(names.length).toBeGreaterThan(10);
  expect(new Set(names)).toEqual(new Set(['none']));
});
