/**
 * Screenshots of the gallery mocks (/__ui#ai-feedback): composed pages at 1440 / 1024 / 390 (the shell element, real size),
 * state sheets at 1440 and 390. Output shots/mock-e-<case>-<w>.png.   VITE_BASE=http://127.0.0.1:6012 node mock-shots.mts
 */
import { chromium, APP, open, shot } from './lib.mts';
const browser = await chromium.launch();
const pages = ['list', 'new', 'chat', 'proposal', 'request', 'conversation', 'triage', 'admin', 'unconfigured'];
const sheets = ['list', 'chat', 'proposal', 'request', 'admin', 'new-product', 'unconfigured-admin', 'nav'];
for (const width of [1440, 1024, 390]) {
  const { page, ctx } = await open(browser, width, 900);
  await page.goto(`${APP}/__ui#ai-feedback`);
  await page.waitForSelector('[data-gallery-section="ai-feedback"]');
  await page.waitForTimeout(1500);
  for (const c of pages) {
    const sel = `[data-case^="ae-page-${c} "] [data-testid="page-shell"]`;
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await shot(page, `mock-e-page-${c}-${width}`, sel);
  }
  if (width !== 1024) {
    for (const c of sheets) {
      const sel = `[data-case^="ae-s-${c} "]`;
      await page.locator(sel).scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await shot(page, `mock-e-s-${c}-${width}`, sel);
    }
  }
  await ctx.close();
}
await browser.close();
console.log('ok');
