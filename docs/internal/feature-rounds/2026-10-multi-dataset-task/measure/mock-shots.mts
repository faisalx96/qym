/**
 * Screenshots of the gallery mocks (/__ui#multi-launch): composed pages at 1440 / 1024 / 390 (the shell element, real size),
 * state sheets at 1440 and 390. Output shots/mock-d-<case>-<w>.png.
 *   VITE_BASE=http://127.0.0.1:5996 node mock-shots.mts
 */
import { chromium, APP, open, shot } from './lib.mts';
const browser = await chromium.launch();
const pages = ['page-home', 'page-step1', 'page-review', 'page-detail'];
const sheets = ['s-single', 's-picker', 's-shape', 's-task', 's-env', 's-problems', 's-raw'];
for (const width of [1440, 1024, 390]) {
  const { page, ctx } = await open(browser, width, 900);
  await page.goto(`${APP}/__ui#multi-launch`);
  await page.waitForSelector('[data-gallery-section="multi-launch"]');
  await page.waitForTimeout(1200);
  for (const c of pages) {
    const sel = `[data-case^="md-${c}"] [data-testid="page-shell"]`;
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await shot(page, `mock-d-${c}-${width}`, sel);
  }
  if (width !== 1024) {
    for (const c of sheets) {
      const sel = c === 's-single' ? `[data-case^="md-${c}"] [data-testid="real-col"]` : `[data-case^="md-${c}"]`;
      await page.locator(sel).scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await shot(page, `mock-d-${c}-${width}`, sel);
    }
  }
  await ctx.close();
}
await browser.close();
console.log('ok');
