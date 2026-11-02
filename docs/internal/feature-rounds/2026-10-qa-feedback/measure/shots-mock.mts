/** Screenshots of the QA-A gallery mocks: one PNG per case and width (dark). usage: node shots-mock.mts [case-prefix ...]
 *  Gallery: http://127.0.0.1:5981/__ui#qa-datasets; every case has data-case="qa-...". */
import { launch, newPage, shotsDir, VITE, WIDTHS } from './lib-qa.mts';
import path from 'node:path';
const only = process.argv.slice(2);
const browser = await launch();
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(browser, w, 900);
  await page.goto(`${VITE}/__ui#qa-datasets`);
  await page.waitForSelector('[data-case^="qa-"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const cases: string[] = await page.evaluate(`[...document.querySelectorAll('[data-case^="qa-"]')].map(e => e.getAttribute('data-case'))`);
  for (const label of cases) {
    const id = label.split(' ')[0];
    if (only.length && !only.some((o) => id.startsWith(o))) continue;
    const el = page.locator(`[data-case^="${id} "]`).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await el.screenshot({ path: path.join(shotsDir, `mock-${id.replace(/^qa-/, '')}-${w}.png`) });
  }
  await ctx.close();
}
await browser.close();
