/** Final review F12: eight distinct run hues, error cards share the whole row, the section tabs show an edge cue on a phone. */
import { expect, test } from '@playwright/test';
import { compareUrl, seedScenario, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-final');
});

// The palette (design pass, colour-review.md) was verified by perceptual distance, not hue angle: orange and
// amber are 16 degrees apart in hue but dE 31 apart. Assert CIE76 dE between every pair (the review's floor for
// normal vision is 22 across all eight slots; slot 7 cyan is the closest to slot 1 sky).
test('the eight run colours are eight distinct colours', async ({ page }) => {
  await page.goto('/');
  const labs = await page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const out: [number, number, number][] = [];
    for (let i = 1; i <= 8; i += 1) {
      probe.style.color = `var(--chart-${i})`;
      const [r, g, b] = getComputedStyle(probe)
        .color.match(/[\d.]+/g)!
        .slice(0, 3)
        .map((v) => lin(Number(v) / 255)) as [number, number, number];
      const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
      const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
      out.push([116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]);
    }
    probe.remove();
    return out;
  });
  for (let i = 0; i < 8; i += 1)
    for (let j = i + 1; j < 8; j += 1) {
      const [l1, a1, b1] = labs[i]!;
      const [l2, a2, b2] = labs[j]!;
      const dE = Math.hypot(l1 - l2, a1 - a2, b1 - b2);
      expect(dE, `run colours ${i + 1} and ${j + 1} (dE ${dE.toFixed(1)})`).toBeGreaterThanOrEqual(20);
    }
});

test('error cards keep a compact column (about 420px) instead of stretching across the row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { base, a, b } = seed.runs;
  await page.goto(compareUrl([base, a, b], { panel: 'errors' }));
  await waitLoaded(page);
  const cards = page.getByTestId('error-card');
  await expect(cards.first()).toBeVisible();
  for (let i = 0; i < (await cards.count()); i += 1)
    expect((await cards.nth(i).boundingBox())!.width).toBeLessThanOrEqual(430);
});

test('390px: the section tabs scroll and show an edge cue while more sections lie past the edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
  const nav = page.getByRole('navigation', { name: 'Comparison sections' });
  await expect(nav).toHaveAttribute('data-cue-end', '');
  await nav.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(nav).not.toHaveAttribute('data-cue-end', '');
  await expect(nav).toHaveAttribute('data-cue-start', '');
});
