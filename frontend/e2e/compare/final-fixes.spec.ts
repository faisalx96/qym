/** Final review F12: eight distinct run hues, error cards share the whole row, the section tabs show an edge cue on a phone. */
import { expect, test } from '@playwright/test';
import { compareUrl, seedScenario, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-final');
});

test('the eight run colours are eight distinct hues', async ({ page }) => {
  await page.goto('/');
  const hues = await page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const out: number[] = [];
    for (let i = 1; i <= 8; i += 1) {
      probe.style.color = `var(--chart-${i})`;
      const [r, g, b] = getComputedStyle(probe)
        .color.match(/[\d.]+/g)!
        .slice(0, 3)
        .map((v) => Number(v) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      let h = 0;
      if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      out.push(((h * 60 + 360) % 360) | 0);
    }
    probe.remove();
    return out;
  });
  for (let i = 0; i < 8; i += 1)
    for (let j = i + 1; j < 8; j += 1) {
      const gap = Math.min(Math.abs(hues[i]! - hues[j]!), 360 - Math.abs(hues[i]! - hues[j]!));
      expect(
        gap,
        `run colours ${i + 1} and ${j + 1} (${hues[i]} and ${hues[j]} degrees)`,
      ).toBeGreaterThanOrEqual(20);
    }
});

test('error cards fill the row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { base, a, b } = seed.runs;
  await page.goto(compareUrl([base, a, b], { panel: 'errors' }));
  await waitLoaded(page);
  const cards = page.getByTestId('error-card');
  await expect(cards.first()).toBeVisible();
  const list = (await cards.first().locator('xpath=ancestor::ul[1]').boundingBox())!;
  const n = await cards.count();
  const last = (await cards.nth(n - 1).boundingBox())!;
  // the last card reaches the right edge of the list: no empty third of the row
  expect(last.x + last.width).toBeGreaterThan(list.x + list.width - 4);
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
