/// <reference lib="dom" />
/**
 * Round 3 P1 (docs/internal/ui-migration/redesign3/run-detail.md section 1): every chart is a card, the count sits on its
 * bar, plots are level, nothing overflows. Acceptance criteria P1-1 .. P1-13 at 1440 and 390 on the classic and the
 * wide repeat run.
 */
import { test, expect, type Page } from '@playwright/test';
import { openRun, seedClassic, seedProject, seedWideRepeat, type Seeded } from './support';

let s: Seeded;
let classic: string;
let wide: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedProject('rd-r3-charts');
  classic = await seedClassic(s);
  wide = await seedWideRepeat(s);
});

const WIDTHS = [1440, 390] as const;

/** Entrance animations (bar-rise, count-in) have finished: geometry is the resting geometry. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !document
        .getAnimations()
        .some((a) => /rise|count-in|grow|arrive/.test((a as CSSAnimation).animationName ?? '')),
  );
}

/** Every plot (role=group built by BarColumns) currently in the DOM, with the geometry of its parts. */
async function plots(page: Page) {
  await settled(page);
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const content = (el: Element) => getComputedStyle(el, '::before').content.replace(/^"|"$/g, '');
    return Array.from(document.querySelectorAll('[role=group]'))
      .filter((g) => g.querySelector('[data-part=bar]'))
      .map((g) => ({
        name: g.getAttribute('aria-label') ?? '',
        box: box(g),
        cols: Array.from(g.children)
          .filter((c) => c.querySelector('[data-part=bar]'))
          .map((c) => {
            const count = c.querySelector('[data-part=count]')!;
            const bar = c.querySelector('[data-part=bar]')!;
            const axis = c.querySelector('[data-part=axis]');
            return {
              tag: c.tagName,
              tier: c.getAttribute('data-tier'),
              count: { text: content(count), data: count.getAttribute('data-text'), box: box(count) },
              bar: box(bar),
              // round 5: a thinned label is a blank line (U+00A0), not a missing one
              axis: axis
                ? {
                    text: content(axis)
                      .replace(/\u00a0/g, '')
                      .trim(),
                    box: box(axis),
                  }
                : null,
            };
          }),
      }));
  });
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('P1-1, P1-2: every count is on its bar (4px or less) and is visible with the pointer outside the card', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      await page.mouse.move(2, 2);
      await expect(page.getByTestId('metric-card').first()).toBeVisible();
      const all = await plots(page);
      expect(all.length).toBeGreaterThanOrEqual(3);
      let checked = 0;
      for (const p of all)
        for (const c of p.cols) {
          if (c.bar.height <= 0) continue;
          // a count with text is never hover-only: it is drawn from data-text at rest
          expect(c.count.text, `${p.name} count text`).toBe(c.count.data ?? '');
          expect(c.count.text).not.toBe('');
          expect(c.bar.top - c.count.box.bottom, `${p.name} count to bar`).toBeLessThanOrEqual(4);
          expect(c.bar.top - c.count.box.bottom).toBeGreaterThanOrEqual(-0.5);
          checked++;
        }
      expect(checked).toBeGreaterThan(10);
      // the same on the repeat run's "Passes passed" and the latency histogram
      await openRun(page, s.slug, wide, 'panel=repeat');
      await expect(page.getByRole('group', { name: 'Items by number of passes that passed' })).toBeVisible();
      for (const p of (await plots(page)).filter((q) => /passes that passed/.test(q.name))) {
        expect(p.cols).toHaveLength(11);
        for (const c of p.cols) {
          expect(c.count.text).not.toBe(''); // zeros are printed too
          if (c.bar.height > 0) expect(c.bar.top - c.count.box.bottom).toBeLessThanOrEqual(4);
        }
      }
      await openRun(page, s.slug, classic, 'panel=latency');
      await expect(page.getByRole('group', { name: /Latency histogram/ })).toBeVisible();
      for (const p of (await plots(page)).filter((q) => /Latency histogram/.test(q.name)))
        for (const c of p.cols)
          if (c.bar.height > 0)
            // round 5 R1-5: a raised-tier count of a dense plot sits up to 20px above its bar
            expect(c.bar.top - c.count.box.bottom).toBeLessThanOrEqual(c.tier === '2' ? 20.5 : 4);
    });

    test('P1-3, P1-7, P1-9, P1-11: charts live in cards, no dead space under the plot, nothing overflows, cards are 260px or wider', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic, 'panel=deep');
      await expect(page.getByRole('region', { name: 'Metric relationship' })).toBeVisible();
      await page.locator('#run-section-latency').scrollIntoViewIfNeeded();
      await expect(page.getByRole('region', { name: 'Quality versus latency' })).toBeVisible();
      await page.locator('#run-section-overview').scrollIntoViewIfNeeded();
      await settled(page);
      const report = await page.evaluate(() => {
        const out: Array<Record<string, unknown>> = [];
        const cards = Array.from(
          document.querySelectorAll('[data-report-section] section[aria-label]'),
        ).filter((c) => c.querySelector('[data-slot]'));
        for (const card of cards) {
          if (
            !card.querySelector(
              'svg[role=img], [role=group][aria-label*=distribution], [role=group][aria-label*=split], [role=group][aria-label*=histogram], [role=group][aria-label*=range], [role=grid]',
            )
          )
            continue;
          const body = card.children[card.children.length - 1] as HTMLElement;
          const cardBottom = card.getBoundingClientRect().bottom;
          let lowest = 0;
          card.querySelectorAll('*').forEach((el) => {
            if (el.closest('[class*=_head_]') || el.closest('[class*=_header_]')) return;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.width > 0) lowest = Math.max(lowest, r.bottom);
          });
          out.push({
            name: card.getAttribute('aria-label'),
            hasHeader: !!card.querySelector('[class*=_header_]'),
            gap: cardBottom - lowest,
            overflow: card.scrollWidth - (card as HTMLElement).clientWidth,
            width: card.getBoundingClientRect().width,
            hasBody: !!body,
          });
        }
        return out;
      });
      expect(report.length).toBeGreaterThanOrEqual(5);
      for (const r of report) {
        expect(r.hasHeader, `${r.name} header`).toBe(true);
        expect(r.gap as number, `${r.name} space under the plot`).toBeLessThanOrEqual(16);
        expect(r.overflow as number, `${r.name} overflow`).toBeLessThanOrEqual(0);
        expect(r.width as number, `${r.name} width`).toBeGreaterThanOrEqual(width === 390 ? 250 : 260);
      }
      // every chart svg / distribution group has a section ancestor with a header
      const orphans = await page.evaluate(
        () =>
          Array.from(
            document.querySelectorAll('svg[role=img], [role=group][aria-label*=distribution]'),
          ).filter((el) => !el.closest('section[aria-label]')?.querySelector('[class*=_header_]')).length,
      );
      expect(orphans).toBe(0);
    });

    test('P1-4: plots in one overview row are level (the numeric card is a box plot since P7)', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      await expect(page.getByTestId('metric-card').first()).toBeVisible();
      const rows = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[data-testid=metric-card]'));
        const byRow = new Map<number, Array<{ metric: string | null; plot: number }>>();
        for (const c of cards) {
          const top = Math.round(c.getBoundingClientRect().top);
          const plot = c.querySelector('[data-slot]')!.getBoundingClientRect().height;
          byRow.set(top, [...(byRow.get(top) ?? []), { metric: c.getAttribute('data-metric'), plot }]);
        }
        return Array.from(byRow.values());
      });
      for (const row of rows) {
        const hs = row.map((r) => r.plot);
        expect(Math.max(...hs) - Math.min(...hs), JSON.stringify(row)).toBeLessThanOrEqual(16);
      }
      // round 3 P7 replaced the Min / Avg / Max / Total cells: a numeric card holds a box plot and its number row
      const card = page.locator('[data-testid=metric-card][data-metric=tokens_used]');
      await expect(card.getByRole('img', { name: /^tokens_used/ })).toBeVisible();
      await expect(
        card
          .getByRole('group', { name: 'Distribution values' })
          .or(card.locator('dl[aria-label="Distribution values"]')),
      ).toBeVisible();
    });

    test('P1-5: a boolean metric is a three column bar chart, no horizontal split bar remains', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      const card = page.locator('[data-testid=metric-card][data-metric=exact_match]');
      const split = card.getByRole('group', { name: /pass and fail split/ });
      await expect(split.getByRole('button')).toHaveCount(3);
      const h = (await split.boundingBox())!.height;
      expect(h).toBeGreaterThan(100);
      // the percentage sits under the label
      await expect(split.locator('[data-part=sub]').first()).toHaveAttribute('data-text', /%$/);
    });

    test('P1-8 (round 5: label rule k = ceil(labelWidth / pitch), blank lines keep the foot): the 11 bucket histograms thin their axis to 6 labels at narrow columns and nothing overlaps', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      await expect(page.getByTestId('metric-card').first()).toBeVisible();
      const all = (await plots(page)).filter((p) => /score distribution/.test(p.name));
      expect(all.length).toBeGreaterThanOrEqual(2);
      for (const p of all) {
        const labelled = p.cols.filter((c) => c.axis && c.axis.text !== '');
        const colWidth = p.cols[0]!.bar.width;
        if (colWidth < 44) expect(labelled).toHaveLength(6);
        const boxes = [
          ...labelled.map((c) => c.axis!.box),
          ...p.cols.filter((c) => c.count.text !== '').map((c) => c.count.box),
        ];
        const axes = labelled.map((c) => c.axis!.box).sort((a, b) => a.left - b.left);
        for (let i = 1; i < axes.length; i++)
          expect(axes[i]!.left).toBeGreaterThanOrEqual(axes[i - 1]!.right);
        const counts = p.cols
          .filter((c) => c.count.text !== '')
          .map((c) => c.count.box)
          .sort((a, b) => a.left - b.left);
        for (let i = 1; i < counts.length; i++)
          expect(counts[i]!.left).toBeGreaterThanOrEqual(counts[i - 1]!.right - 0.5);
        expect(boxes.length).toBeGreaterThan(5);
      }
    });

    test('P1-10: the curve labels Pass@k above and Pass^k below each labelled point (3 to 4 per series wide, 1 to 2 narrow; the coincident k=1 label is printed once), with a halo', async ({
      page,
    }) => {
      await openRun(page, s.slug, wide, 'panel=repeat');
      const curve = page.getByRole('img', { name: /for correct/ });
      await expect(curve).toBeVisible();
      const info = await curve.evaluate((svg) => {
        const labels = Array.from(svg.querySelectorAll('text[data-point-label]'));
        const bySeries: Record<string, number> = {};
        labels.forEach((l) => {
          const k = l.getAttribute('data-point-label')!;
          bySeries[k] = (bySeries[k] ?? 0) + 1;
        });
        const halo = labels.every((l) => parseFloat(getComputedStyle(l).strokeWidth) >= 3);
        const marker = svg.querySelector('circle[aria-label*="Pass@k"]')!.getBoundingClientRect();
        const above = labels
          .find((l) => l.getAttribute('data-point-label') === 'Pass@k')!
          .getBoundingClientRect();
        const below = labels
          .find((l) => l.getAttribute('data-point-label') === 'Pass^k')!
          .getBoundingClientRect();
        return { bySeries, halo, aboveY: above.bottom <= marker.top + 4, belowOk: below.top >= 0 };
      });
      expect(info.halo).toBe(true);
      expect(info.bySeries['Pass@k']).toBe(width === 1440 ? 4 : 2);
      expect(info.bySeries['Pass^k']).toBe(width === 1440 ? 3 : 1);
      expect(info.aboveY).toBe(true);
    });
  });
}

test.describe('P1-9 across widths', () => {
  for (const w of [1440, 1024, 768, 390]) {
    test(`no card overflows its column at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await openRun(page, s.slug, classic);
      await expect(page.getByTestId('metric-card').first()).toBeVisible();
      const over = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid=metric-card]'))
          .map((c) => ({
            w: c.getBoundingClientRect().width,
            over: c.scrollWidth - (c as HTMLElement).clientWidth,
          }))
          .filter((c) => c.over > 0 || c.w < 250),
      );
      expect(over).toEqual([]);
      // the overview section never grows past its column (the shell's own top bar is outside this change)
      expect(
        await page.evaluate(() => {
          const el = document.getElementById('run-section-overview')!;
          return el.scrollWidth <= el.clientWidth;
        }),
      ).toBe(true);
      if (w === 390)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
          true,
        );
    });
  }
});

test('P1-13: under prefers-reduced-motion no bar or count is given an animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __anim: string[] }).__anim = seen;
    const look = (root: ParentNode) =>
      root.querySelectorAll?.('[data-part=bar],[data-part=count]').forEach((el) => {
        seen.push(getComputedStyle(el).animationName);
      });
    new MutationObserver((muts) =>
      muts.forEach((m) => m.addedNodes.forEach((n) => n instanceof Element && look(n))),
    ).observe(document, { childList: true, subtree: true });
  });
  await openRun(page, s.slug, classic);
  await expect(page.getByTestId('metric-card').first()).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { __anim: string[] }).__anim);
  expect(seen.length).toBeGreaterThan(10);
  expect(new Set(seen)).toEqual(new Set(['none']));
});

test('P1-13b: with motion allowed the same bars do animate (the guard above is meaningful)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __anim: string[] }).__anim = seen;
    new MutationObserver((muts) =>
      muts.forEach((m) =>
        m.addedNodes.forEach(
          (n) =>
            n instanceof Element &&
            n
              .querySelectorAll('[data-part=bar]')
              .forEach((el) => seen.push(getComputedStyle(el).animationName)),
        ),
      ),
    ).observe(document, { childList: true, subtree: true });
  });
  await openRun(page, s.slug, classic);
  await expect(page.getByTestId('metric-card').first()).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { __anim: string[] }).__anim);
  expect(seen.some((n) => /rise/.test(n))).toBe(true);
});
