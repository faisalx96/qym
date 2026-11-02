/** Current Metadata filter: button, popover (key select, values, footer) and applied chips at 1440 / 1024 / 390. */
import { launch, newPage, datasetUrl, save, shotsDir, WIDTHS, boxes } from './lib-qa.mts';
import path from 'node:path';
const b = await launch();
const result: Record<string, unknown> = {};
const SELS = ['[data-testid=metadata-filter]', '[data-testid=meta-popover]', '[data-testid=meta-popover] h3', '[data-testid=facet-values]', '[data-testid=meta-popover] [role=option]', '[data-testid=filter-chips]', '[data-testid=filter-chips] button', '[data-testid=items-toolbar]'];
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(b, w);
  await page.goto(datasetUrl('support-faq', 'items'));
  await page.waitForSelector('[data-testid=metadata-filter]');
  await page.waitForTimeout(500);
  const m: Record<string, unknown> = {};
  m.button = await boxes(page, SELS.slice(0, 1));
  await page.click('[data-testid=metadata-filter]');
  await page.waitForSelector('[data-testid=facet-values]');
  await page.waitForTimeout(400);
  m.popover = await boxes(page, SELS);
  m.keys = await page.evaluate(() => (document.querySelector('[data-testid=meta-popover] button') as HTMLElement | null)?.textContent);
  await page.screenshot({ path: path.join(shotsDir, `current-meta-popover-${w}.png`) });
  // open the key select and list the keys
  await page.click('[data-testid=meta-popover] button[aria-haspopup]');
  await page.waitForTimeout(300);
  m.keyOptions = await page.evaluate(() => [...document.querySelectorAll('[role=listbox] [role=option]')].map((o) => o.textContent));
  await page.screenshot({ path: path.join(shotsDir, `current-meta-keys-${w}.png`) });
  await page.keyboard.press('Escape');
  await ctx.close();
  const c = await newPage(b, w);
  await c.page.goto(datasetUrl('support-faq', 'items', '&meta=domain:finance&meta=source.channel:chat&meta=source.region.code:sa'));
  await c.page.waitForSelector('[data-testid=metadata-filter]');
  await c.page.waitForTimeout(800);
  m.chips = await boxes(c.page, SELS);
  await c.page.screenshot({ path: path.join(shotsDir, `current-meta-chips-${w}.png`) });
  m.chipTexts = await c.page.evaluate(() => [...document.querySelectorAll('[data-testid=filter-chips] > *')].map((e) => { const r = e.getBoundingClientRect(); return `${e.textContent} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`; }));
  result[String(w)] = m;
  await c.ctx.close();
}
save('current-filter', result);
console.log(JSON.stringify(result, null, 1));
await b.close();
