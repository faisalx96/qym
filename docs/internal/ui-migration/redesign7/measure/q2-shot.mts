/** Q2: the loading frame the reader sees while a group's passes are in flight (the passes and group-metrics requests are held for 2 s). */
import { BASE, r7, launch, newPage, STORAGE_INIT, shotsDir } from './lib7.mts';
import path from 'node:path';
const WIDTH = Number(process.env.WIDTH ?? 1440);
const browser = await launch();
const { page } = await newPage(browser, { width: WIDTH, height: 1000, init: [STORAGE_INIT] });
await page.route(/\/api\/runs\/[^/]+\/(passes|group-metrics)/, async (route) => { await new Promise((r) => setTimeout(r, 2000)); await route.continue(); });
await page.goto(`${BASE}/projects/${r7.slug}`);
await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(shotsDir, `current-q2-loading-${WIDTH}.png`), clip: { x: 200, y: 120, width: WIDTH - 200, height: 520 } });
await browser.close();
