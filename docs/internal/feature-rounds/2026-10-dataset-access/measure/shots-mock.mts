/** Screenshots of the WP-A gallery mocks (one PNG per case and width, dark). Usage: node shots-mock.mts [case-prefix ...]
 *  The gallery is http://127.0.0.1:5981/__ui#dataset-access; every case has data-case="da-...". */
import { launch, newPage, shotsDir, VITE, WIDTHS } from './lib-a.mts';
import path from 'node:path';

const only = process.argv.slice(2);
const browser = await launch();
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(browser, w, 900);
  await page.goto(`${VITE}/__ui#dataset-access`);
  await page.waitForSelector('[data-case^="da-"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const cases: string[] = await page.evaluate(`[...document.querySelectorAll('[data-case^="da-"]')].map(e => e.getAttribute('data-case'))`);
  for (const label of cases) {
    const id = label.split(' ')[0];
    if (only.length && !only.some((o) => id.startsWith(o))) continue;
    const el = page.locator(`[data-case^="${id} "]`).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await el.screenshot({ path: path.join(shotsDir, `mock-${id.replace(/^da-/, '')}-${w}.png`) });
  }
  await ctx.close();
}
await browser.close();
