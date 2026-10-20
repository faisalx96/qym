/** Review Q2-10: change the strip's metric on an open group and time (in page, rAF) the new statistics painting; the requests the change causes. REPS=5 */
import { BASE, r7, launch, newPage, STORAGE_INIT, median, save } from '../lib7.mts';
const browser = await launch();
const rows: Array<Record<string, unknown>> = [];
for (let rep = 0; rep < Number(process.env.REPS ?? 5); rep++) {
  const { page } = await newPage(browser, { width: 1440, height: 1000, init: [STORAGE_INIT] });
  const reqs: string[] = [];
  await page.goto(`${BASE}/projects/${r7.slug}`);
  const sel = '[data-testid="runs-table"]';
  await page.locator(`${sel} tbody tr[data-run-id]`).first().waitFor();
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click();
  await page.locator(`${sel} tr[data-strip-row] dl[aria-busy="false"]`).first().waitFor();
  await page.waitForTimeout(600);
  page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(r.url().replace(BASE, '')); });
  const before = await page.locator(`${sel} tr[data-strip-row] dd`).first().textContent();
  await page.evaluate(() => { (window as any).__t0 = performance.now(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const select = page.locator(`${sel} tr[data-strip-row] select`).first();
  const opts = await select.locator('option').allTextContents();
  const label = opts.includes('quality') ? 'quality' : opts[opts.length - 1]!;
  await page.evaluate(() => { (window as any).__t0 = performance.now(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await select.selectOption({ label });
  const ms = await page.evaluate(() => new Promise<number>((res) => {
    const t0 = (window as any).__t0 as number; // eslint-disable-line @typescript-eslint/no-explicit-any
    const strip = document.querySelector('[data-testid="runs-table"] tr[data-strip-row]')!;
    const tick = () => { const busy = strip.querySelector('dl[aria-busy="true"]') || strip.querySelector('[data-dim],[aria-busy="true"]'); const dd = strip.querySelector('dl dd')?.textContent ?? ''; if (!busy && /\d/.test(dd) && performance.now() - t0 > 30) res(performance.now() - t0); else if (performance.now() - t0 > 5000) res(-1); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  await page.waitForTimeout(300);
  rows.push({ rep, before, target: label, opts, ms: Math.round(ms), requests: reqs.filter((u) => /group-metrics|passes/.test(u)) });
  await page.close();
}
await browser.close();
save('r7r-q2-select', { medianMs: median(rows.map((r) => r.ms as number)), rows });
