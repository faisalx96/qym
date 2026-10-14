/** Charts are drawn at the measured column width: axis text and dots keep their size on wide screens. */
import { test, expect } from '@playwright/test';
import { openRun, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-charts');
  classic = await seedClassic(s);
});

for (const width of [1440, 1920]) {
  test(`${width}px: scatter axis text stays at the tick size and the latency pair share one height`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openRun(page, s.slug, classic);
    await page
      .getByRole('navigation', { name: 'Run sections' })
      .getByRole('link', { name: 'Latency' })
      .click();
    const scatter = page.getByRole('img', { name: /versus latency/ });
    await expect(scatter).toBeVisible();
    const sizes = await scatter.evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      // min(w, h): the rotated y-axis title is as wide as it is long
      const texts = Array.from(svg.querySelectorAll('text')).map((t) => {
        const r = t.getBoundingClientRect();
        return Math.min(r.width, r.height);
      });
      const dot = svg.querySelector('circle')!.getBoundingClientRect();
      return { texts, dot: dot.width, width: box.width, viewW: Number(svg.getAttribute('width')) };
    });
    // 11px tick text is about 13px tall; the old viewBox scaling gave 20-30px at these widths
    for (const h of sizes.texts) expect(h).toBeLessThan(16);
    expect(sizes.dot).toBeLessThan(10);
    // drawn at the measured width, not a scaled viewBox
    expect(Math.abs(sizes.viewW - sizes.width)).toBeLessThan(2);
    const a = (await page.getByRole('region', { name: 'Response time' }).boundingBox())!;
    const b = (await page.getByRole('region', { name: 'Quality versus latency' }).boundingBox())!;
    expect(Math.abs(a.height - b.height)).toBeLessThan(3);
  });
}

test('the metric relationship scatter colours its dots pass / fail like the latency scatter', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRun(page, s.slug, classic, 'panel=deep');
  const scatter = page
    .getByRole('region', { name: 'Metric relationship' })
    .getByRole('img', { name: /versus/ });
  await expect(scatter).toBeVisible();
  const outcomes = await scatter.evaluate((svg) =>
    Array.from(
      new Set(
        Array.from(svg.querySelectorAll('circle[data-outcome]')).map((c) => c.getAttribute('data-outcome')),
      ),
    ),
  );
  expect(outcomes).toEqual(expect.arrayContaining(['pass', 'fail']));
  await expect(page.getByRole('region', { name: 'Metric relationship' })).toContainText('Pass');
});
