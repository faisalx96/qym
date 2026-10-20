import { BASE, r7, launch, newPage, STORAGE_INIT } from '../lib7.mts';
const browser = await launch();
const { page } = await newPage(browser, { width: 1440, height: 1000, init: [STORAGE_INIT] });
await page.goto(`${BASE}/projects/${r7.slug}`);
const sel = '[data-testid="runs-table"]';
await page.locator(`${sel} tbody tr[data-run-id]`).first().waitFor();
await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click();
await page.locator(`${sel} tr[data-strip-row] dl[aria-busy="false"]`).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(700);
const count = () => page.evaluate(() => {
  const strip = document.querySelector('[data-testid="runs-table"] tr[data-strip-row]') as HTMLElement;
  const rs = Array.from(strip.querySelectorAll('dd, dt')).map((e) => { const rc = e.getBoundingClientRect(); const top = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2); const own = !!top && (top === e || e.contains(top) || top.contains(e)); return { t: (e.textContent || '').trim().slice(0, 12), y: Math.round(rc.top), own }; });
  const sr = strip.getBoundingClientRect();
  return { stats: rs.length, notOwn: rs.filter((x) => !x.own).map((x) => x.t + '@y' + x.y), stripRect: [Math.round(sr.left), Math.round(sr.top), Math.round(sr.width), Math.round(sr.height)] };
});
const out: Record<string, unknown> = {};
for (const [name, left] of [['rest', 0], ['scrolled-600', 600], ['end', 99999]] as const) {
  await page.evaluate((l) => { const sc = document.querySelector('[data-testid="runs-table"] [data-dt-scroller]') as HTMLElement; sc.scrollLeft = l; }, left);
  await page.waitForTimeout(400);
  out[name] = await count();
}
console.log(JSON.stringify(out));
await browser.close();
