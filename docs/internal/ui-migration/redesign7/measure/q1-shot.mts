/** Q1: the strip of an open group at 2x, where the actions line used to cross "Reliability" (the after-image of current-q1-strip-zoom-1440.png). */
import { BASE, r7, launch, STORAGE_INIT, shotsDir } from './lib7.mts';
import path from 'node:path';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await ctx.addInitScript(STORAGE_INIT);
const page = await ctx.newPage();
await page.goto(`${BASE}/projects/${r7.slug}`);
const sel = '[data-testid="runs-table"]';
await page.locator(`${sel} tbody tr[data-run-id]`).first().waitFor();
await page.waitForTimeout(800);
await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click();
await page.locator(`${sel} tr[data-strip-row] dl[aria-busy="false"]`).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(600);
const strip = (await page.locator(`${sel} tr[data-strip-row]`).first().boundingBox())!;
const header = (await page.locator(`${sel} thead`).first().boundingBox())!;
await page.screenshot({ path: path.join(shotsDir, 'after-q1-strip-zoom-1440.png'), clip: { x: 760, y: strip.y - 60, width: 660, height: 150 } });
void header;
await browser.close();
