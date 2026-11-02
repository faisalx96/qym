/** Composed page mocks (case ids qa-page-*): shots/mock-page-<surface>-<1440|390>.png, cropped to the shell. */
import { launch, newPage, shotsDir, VITE } from './lib-qa.mts';
import path from 'node:path';
const b = await launch();
for (const [w, vw] of [[1440, 1800], [390, 480]] as const) {
  const { ctx, page } = await newPage(b, vw, 1000);
  await page.goto(`${VITE}/__ui#qa-datasets`);
  await page.waitForSelector('[data-case^="qa-page-"]');
  await page.waitForTimeout(1200);
  const cases: string[] = await page.evaluate(`[...document.querySelectorAll('[data-case^="qa-page-"]')].map(e => e.getAttribute('data-case').split(' ')[0])`);
  for (const id of cases) {
    const el = page.locator(`[data-case^="${id} "] [data-testid=page-shell]`).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await el.boundingBox();
    console.log(id, w, box && `${box.width}x${box.height}`);
    await el.screenshot({ path: path.join(shotsDir, `mock-${id.replace('qa-', '')}-${w}.png`) });
  }
  await ctx.close();
}
await b.close();
