/** Contrast of the tinted primitives (Badge, Tag, Chip, ScoreValue pill, StatStrip, DeltaCell, Card) in the gallery. */
import { expect, test } from '@playwright/test';
import { compareUrl } from '../compare/support';
import { gotoApp } from '../helpers';
import { runUrl } from '../run-detail/support';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { createLaunchAreas, seedTour, settled, type AreasWorld, type Tour } from './support';

for (const width of [1280, 390]) {
  test(`gallery visual-language section has no serious axe violations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/__ui');
    const section = page.locator('[data-gallery-section="visual-language"]');
    await expect(section).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    const violations = await axeSeriousViolations(page, '[data-gallery-section="visual-language"]');
    expect(violations, describeViolations(violations)).toEqual([]);
  });
}

test('tinted text keeps 4.5:1 on its own tint (badge, tag, chip, pill, stat value)', async ({ page }) => {
  await page.goto('/__ui');
  const section = page.locator('[data-gallery-section="visual-language"]');
  await expect(section).toBeVisible();
  const ratios = await section.evaluate((root) => {
    // getComputedStyle serialises color-mix as `color(srgb r g b / a)` with 0..1 channels.
    const parse = (c: string): number[] => {
      const n = c.match(/[\d.]+/g)!.map(Number);
      return c.startsWith('color(')
        ? [n[0]! * 255, n[1]! * 255, n[2]! * 255, ...(n[3] === undefined ? [] : [n[3]])]
        : n;
    };
    const lum = ([r = 0, g = 0, b = 0]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const over = (fg: number[], bg: number[], a: number) => fg.map((v, i) => v * a + bg[i]! * (1 - a));
    const surface = parse(getComputedStyle(document.body).backgroundColor);
    const out: { what: string; ratio: number }[] = [];
    const sels = [
      '[class*="badge"]',
      '[class*="tag"]',
      '[class*="score"][data-variant="pill"]',
      '[class*="trend"]',
    ];
    for (const sel of sels) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
        const cs = getComputedStyle(el);
        const bg = parse(cs.backgroundColor);
        const fg = parse(cs.color);
        const base = [
          ...(root.querySelector('[data-case]')
            ? parse(getComputedStyle(root.querySelector('[data-case]')!).backgroundColor)
            : surface),
        ];
        const solid = bg[3] === undefined ? bg : over(bg.slice(0, 3), base, bg[3]);
        const l1 = lum(fg);
        const l2 = lum(solid);
        out.push({
          what: `${sel} ${el.textContent}`,
          ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
        });
      }
    }
    return out;
  });
  expect(ratios.length).toBeGreaterThan(10);
  expect(ratios.filter((r) => r.ratio < 4.5)).toEqual([]);
});

/**
 * Real pages, not just the gallery: axe (including color-contrast) on the pages that carry the palette, at the two
 * viewports the app is designed for. The app has one theme (`color-scheme: dark`); the guard below fails the day a
 * light variant ships, so this sampling is extended to it instead of silently skipping it.
 */
test.describe('real pages', () => {
  test.setTimeout(240_000);
  let tour: Tour;
  let areas: AreasWorld;
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    tour = await seedTour();
    areas = await createLaunchAreas(request);
  });

  for (const width of [1280, 390]) {
    test(`runs list, run detail, compare, experiments and analysis have no serious axe violations at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const pages: { name: string; path: string; ready: () => Promise<void> }[] = [
        {
          name: 'runs list',
          path: `/projects/${tour.slug}`,
          ready: () => expect(page.getByRole('main')).toBeVisible(),
        },
        {
          name: 'run detail',
          path: runUrl(tour.slug, tour.runId),
          ready: () => expect(page.getByTestId('items-count')).toBeVisible(),
        },
        {
          name: 'compare',
          path: compareUrl(tour.compareIds),
          ready: () => expect(page.getByTestId('item-list')).toBeVisible({ timeout: 20_000 }),
        },
        {
          name: 'experiments',
          path: `/projects/${areas.slug}/experiments`,
          ready: () => expect(page.locator('[data-experiments-list]')).toBeVisible(),
        },
        {
          name: 'analysis',
          path: `/projects/${areas.analysisSlug}/analysis?run=${areas.runId}`,
          ready: () => expect(page.getByRole('region', { name: 'Analysis actions' })).toBeVisible(),
        },
      ];
      for (const p of pages) {
        await gotoApp(page, p.path);
        await p.ready();
        await settled(page);
        const violations = await axeSeriousViolations(page);
        expect(violations, `${p.name} at ${width}px\n${describeViolations(violations)}`).toEqual([]);
      }
    });
  }

  test('the app ships one (dark) theme: a light variant must come with its own contrast sampling', async ({
    page,
  }) => {
    await gotoApp(page, `/projects/${tour.slug}`);
    const light = await page.evaluate(() => {
      const hits: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        const walk = (list: CSSRuleList) => {
          for (const r of Array.from(list)) {
            if (r instanceof CSSMediaRule && /prefers-color-scheme:\s*light/.test(r.conditionText))
              hits.push(r.conditionText);
            if (r instanceof CSSStyleRule && /data-theme=["']?light/.test(r.selectorText))
              hits.push(r.selectorText);
            if ('cssRules' in r) walk((r as CSSGroupingRule).cssRules);
          }
        };
        walk(rules);
      }
      return hits;
    });
    expect(light, 'a light theme exists: sample the real pages in it too').toEqual([]);
  });
});
