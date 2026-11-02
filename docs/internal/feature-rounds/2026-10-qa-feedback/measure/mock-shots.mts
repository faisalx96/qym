/** Screenshots of the QA-B gallery mocks (/__ui#qa-experiments): shots/mock-<case>-<width>.png, dark. Usage: node mock-shots.mts [case-prefix ...] */
import { chromium, APP, WIDTHS, open, shotsDir } from './lib.mts';
import path from 'node:path';
const only = process.argv.slice(2);
const browser = await chromium.launch();
for (const w of WIDTHS) {
  const { ctx, page } = await open(browser, w, 900);
  await page.goto(`${APP}/__ui#qa-experiments`);
  await page.waitForSelector('[data-case^="qb-"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const cases: string[] = await page.evaluate(`[...document.querySelectorAll('[data-case^="qb-"]')].map(e => e.getAttribute('data-case'))`);
  for (const label of cases) {
    const id = label.split(' ')[0];
    if (only.length && !only.some((o) => id.startsWith(o))) continue;
    const el = page.locator(`[data-case^="${id} "]`).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await el.screenshot({ path: path.join(shotsDir, `mock-${id}-${w}.png`) });
  }
  await ctx.close();
}
await browser.close();
console.log('ok');
