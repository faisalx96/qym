import { BASE, r7, launch, newPage, STORAGE_INIT } from '../lib7.mts';
const browser = await launch();
for (const w of [1440, 1024]) {
  const { page } = await newPage(browser, { width: w, height: 1000, init: [STORAGE_INIT] });
  await page.goto(`${BASE}/projects/${r7.slug}`);
  await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid=table-scroll-rail]') as HTMLElement;
    const sc = document.querySelector('[data-testid="runs-table"] [data-dt-scroller]') as HTMLElement;
    const cs = getComputedStyle(rail); const rr = rail.getBoundingClientRect(); const sr = sc.getBoundingClientRect();
    return { railRect: [Math.round(rr.top), Math.round(rr.height * 10) / 10], css: { height: cs.height, boxSizing: cs.boxSizing, position: cs.position, overflowX: cs.overflowX }, scrollerBottom: Math.round(sr.bottom), scrollerH: Math.round(sr.height), scrollW: sc.scrollWidth, clientW: sc.clientWidth, railScrollW: rail.scrollWidth, railClientW: rail.clientWidth, railClientH: rail.clientHeight, railOffsetH: rail.offsetHeight };
  });
  console.log(w, JSON.stringify(r));
  await page.close();
}
await browser.close();
