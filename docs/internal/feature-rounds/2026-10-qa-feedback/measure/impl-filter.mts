/** Implemented metadata filter: popover for a list key (tags), mixed key, scalar key and chips; numbers + after-qa-* shots.
 *  QYM_A_VITE=http://127.0.0.1:5983 node impl-filter.mts */
import { launch, newPage, datasetUrl, save, shotsDir, WIDTHS, boxes } from './lib-qa.mts';
import path from 'node:path';
const b = await launch();
const result: Record<string, unknown> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pickKey(page: any, name: string) {
  await page.click('[data-testid=meta-popover] button[aria-haspopup]');
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(150);
}
const popBox = (p: unknown) => boxes(p, ['[data-testid=meta-popover]', '[data-testid=facet-values]', '[data-testid=meta-match]', '[data-testid=meta-match-help]', '[data-testid=meta-popover] [role=option]', '[data-testid=meta-popover] [role=radiogroup]']);
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(b, w);
  await page.goto(datasetUrl('support-faq', 'items'));
  await page.waitForSelector('[data-testid=metadata-filter]');
  await page.waitForTimeout(500);
  const m: Record<string, unknown> = {};
  await page.click('[data-testid=metadata-filter]');
  await page.waitForSelector('[data-testid=facet-values]');
  await page.click('[data-testid=meta-popover] button[aria-haspopup]');
  await page.waitForTimeout(200);
  m.keyOptions = await page.evaluate(() => [...document.querySelectorAll('[role=listbox] [role=option]')].map((o) => o.textContent));
  await page.keyboard.press('Escape');
  await pickKey(page, 'tags');
  m.tagsEmpty = await popBox(page);
  const vals = page.locator('[data-testid=facet-values]');
  await vals.getByRole('option', { name: /billing/ }).click();
  await vals.getByRole('option', { name: /refund/ }).click();
  await page.waitForTimeout(150);
  m.tagsPartial = await popBox(page);
  await page.screenshot({ path: path.join(shotsDir, `after-qa-filter-popover-${w}.png`) });
  await page.locator('[data-testid=meta-match] label', { hasText: 'Full match' }).click();
  await page.waitForTimeout(150);
  m.tagsFull = await popBox(page);
  await pickKey(page, 'channels');
  await vals.getByRole('option', { name: /chat/ }).click();
  await vals.getByRole('option', { name: /phone/ }).click();
  await page.waitForTimeout(150);
  m.mixed = await popBox(page);
  await pickKey(page, 'domain');
  await page.waitForTimeout(150);
  m.scalar = await popBox(page);
  await page.screenshot({ path: path.join(shotsDir, `after-qa-filter-scalar-${w}.png`) });
  await ctx.close();
  const c = await newPage(b, w);
  await c.page.goto(datasetUrl('support-faq', 'items', '&meta=domain:finance&meta=tags:billing&meta=tags:refund&meta_mode=tags:all&meta=channels:chat&meta=channels:phone&meta_mode=channels:any'));
  await c.page.waitForSelector('[data-testid=metadata-filter]');
  await c.page.waitForTimeout(900);
  m.chips = await c.page.evaluate(() => [...document.querySelectorAll('[data-testid=filter-chips] > *')].map((e) => { const r = e.getBoundingClientRect(); return `${e.textContent} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`; }));
  m.chipRow = await boxes(c.page, ['[data-testid=filter-chips]']);
  m.total = await c.page.evaluate(() => document.body.innerText.match(/(\d+) items?/g));
  await c.page.screenshot({ path: path.join(shotsDir, `after-qa-filter-chips-${w}.png`) });
  const long = await newPage(b, w);
  await long.page.goto(datasetUrl('support-faq', 'items', '&meta=domain:finance&meta=tags:billing&meta=tags:refund&meta_mode=tags:all&meta=source.labels:gold&meta=source.labels:silver&meta=source.labels:reviewed&meta=source.labels:needs-review&meta=source.labels:synthetic&meta_mode=source.labels:all&meta=channels:chat&meta=source.region.code:sa'));
  await long.page.waitForSelector('[data-testid=metadata-filter]');
  await long.page.waitForTimeout(900);
  m.fiveChips = await long.page.evaluate(() => [...document.querySelectorAll('[data-testid=filter-chips] > *')].map((e) => { const r = e.getBoundingClientRect(); return `${e.textContent} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`; }));
  m.fiveRow = await boxes(long.page, ['[data-testid=filter-chips]']);
  m.overflow = await long.page.evaluate(() => { const r = document.querySelector('[data-testid=filter-chips]') as HTMLElement; return [r.scrollWidth, r.clientWidth]; });
  await long.page.screenshot({ path: path.join(shotsDir, `after-qa-filter-fivechips-${w}.png`) });
  result[String(w)] = m;
  await c.ctx.close(); await long.ctx.close();
}
save('impl-filter', result);
console.log(JSON.stringify(result, null, 1));
await b.close();
