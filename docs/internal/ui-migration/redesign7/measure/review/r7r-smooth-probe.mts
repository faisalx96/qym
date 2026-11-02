/** Does a programmatic smooth scroll of #shell-content animate (and for how long) in this browser? scrollTop per rAF after scrollTo({behavior:'smooth'}). */
import { BASE, r7, launch, newPage, STORAGE_INIT } from '../lib7.mts';
const browser = await launch();
const { page } = await newPage(browser, { width: 1440, height: 900, init: [STORAGE_INIT] });
await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=j-01`);
await page.locator('[data-testid=item-card][data-item-id="j-01"]').waitFor();
await page.waitForTimeout(1200);
const r = await page.evaluate(() => new Promise<number[][]>((res) => {
  const sc = document.getElementById('shell-content')!;
  const out: number[][] = [];
  const t0 = performance.now();
  sc.scrollTo({ top: sc.scrollTop + 1500, behavior: 'smooth' });
  const tick = () => { out.push([Math.round(performance.now() - t0), Math.round(sc.scrollTop)]); if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(out); };
  requestAnimationFrame(tick);
}));
console.log(JSON.stringify(r.filter((_, i) => i % 4 === 0)));
await browser.close();
