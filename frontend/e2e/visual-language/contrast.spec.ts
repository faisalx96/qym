/** Contrast of the tinted primitives (Badge, Tag, Chip, ScoreValue pill, StatStrip, DeltaCell, Card) in the gallery. */
import { expect, test } from '@playwright/test';
import { axeSeriousViolations, describeViolations } from '../shell/support';

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
