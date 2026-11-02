/** Baseline of today's experiment detail (a sweep-less experiment) at 1440 / 1024 / 390. Output shots/current-detail-<w>.png. */
import { chromium, APP, WIDTHS, open, shot, save, seed } from './lib.mts';
const s = seed();
const browser = await chromium.launch();
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width);
  await page.goto(`${APP}/projects/${s.slug}/experiments/${s.experiments.baseline}`);
  await page.waitForSelector('[data-exp-detail]');
  await page.waitForTimeout(1500);
  const out = await page.evaluate(() => {
    const r = (sel: string) => Array.from(document.querySelectorAll(sel)).slice(0, 3).map((e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, y: Math.round(b.y + scrollY) }; });
    return { page: r('[data-exp-detail]'), header: r('[data-page-header]'), matrix: r('[data-exp-matrix]'), jobs: r('[data-exp-jobs]'), strip: r('[aria-label="Job totals"]'), rows: r('[data-exp-jobs] tbody tr') };
  });
  save(`current-detail-${width}`, out);
  await shot(page, `current-detail-${width}`, undefined, true);
  await ctx.close();
}
await browser.close();
console.log('ok');
