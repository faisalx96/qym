/** Review screenshots (round 7): the item bar stuck while an open item scrolls; the loading frame of a not-prefetched group on Fast 3G; the strip at rest. Output: shots/review-*.png */
import { BASE, r7, launch, newPage, STORAGE_INIT, FAST3G, shotsDir } from '../lib7.mts';
import path from 'node:path';
const browser = await launch();
{
  const { page } = await newPage(browser, { width: 1440, height: 900, init: [STORAGE_INIT] });
  await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=j-01`);
  const card = page.locator('[data-testid=item-card][data-item-id="j-01"]');
  await card.waitFor();
  await card.getByRole('button', { name: 'Expand all output keys' }).click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { const sc = document.getElementById('shell-content')!; const bar = document.querySelector('[data-item-bar]') as HTMLElement; sc.scrollTop += bar.getBoundingClientRect().top - 150 + 700; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shotsDir, 'review-d1-item-bar-stuck-1440.png') });
  const bar = await page.evaluate(() => { const b = document.querySelector('[data-item-bar]') as HTMLElement; const r = b.getBoundingClientRect(); return { top: r.top, h: r.height, shift: b.style.getPropertyValue('--head-shift'), willChange: getComputedStyle(b).willChange, articleHasShift: (document.querySelector('[data-item-bar]')!.closest('article') as HTMLElement).style.getPropertyValue('--head-shift') }; });
  console.log('bar', JSON.stringify(bar));
  await page.close();
}
{
  const { page, cdp } = await newPage(browser, { width: 1440, height: 1000, init: [STORAGE_INIT] });
  await page.goto(`${BASE}/projects/${r7.slug}`);
  const sel = '[data-testid="runs-table"]';
  await page.locator(`${sel} tbody tr[data-run-id]`).first().waitFor();
  await page.waitForTimeout(2500);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', FAST3G);
  // a run the prefetch has not reached (it is cached after the settle, so open one that was never prefetched: the 1,200-item run after clearing the cache is not possible; use saveData via a fresh page instead)
  await page.close();
}
{
  const { ctx, page, cdp } = await (async () => { const c = await newPage(browser, { width: 1440, height: 1000, init: [STORAGE_INIT, `Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: true }) });`] }); return { ctx: c.ctx, page: c.page, cdp: c.cdp }; })();
  void ctx;
  await page.goto(`${BASE}/projects/${r7.slug}`);
  const sel = '[data-testid="runs-table"]';
  await page.locator(`${sel} tbody tr[data-run-id]`).first().waitFor();
  await page.waitForTimeout(1500);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', FAST3G);
  await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(shotsDir, 'review-q2-loading-fast3g-1440.png'), clip: { x: 200, y: 110, width: 1220, height: 560 } });
  await page.locator(`${sel} tr[data-strip-row] dl[aria-busy="false"]`).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shotsDir, 'review-q2-loaded-fast3g-1440.png'), clip: { x: 200, y: 110, width: 1220, height: 560 } });
  await page.close();
}
await browser.close();
