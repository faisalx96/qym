/**
 * Screenshots of the WP-B gallery mocks (/__ui#eval-flags) at 1440, 1024 and 390 px: one PNG per case,
 * shots/mock-<case>-<width>.png, dark scheme. Needs only Vite (the gallery reads no API).
 *   VITE_BASE=http://127.0.0.1:5982 node mock-shots.mts
 */
import { chromium, APP, WIDTHS, open, shotsDir } from './lib-b.mts';
import path from 'node:path';

const browser = await chromium.launch();
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width, 1000);
  await page.goto(`${APP}/__ui`);
  await page.waitForSelector('[data-gallery-section="eval-flags"]');
  await page.waitForTimeout(1200);
  const labels: string[] = await page.$$eval('[data-gallery-section="eval-flags"] [data-case]', (els: Element[]) => els.map((e) => e.getAttribute('data-case') ?? ''));
  for (const label of labels) {
    const id = label.split(' ')[0];
    const loc = page.locator(`[data-gallery-section="eval-flags"] [data-case^="${id} "]`).first();
    await loc.scrollIntoViewIfNeeded();
    await loc.screenshot({ path: path.join(shotsDir, `mock-${id}-${width}.png`) });
  }
  await ctx.close();
}
await browser.close();
console.log('ok');
