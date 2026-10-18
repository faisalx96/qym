/** Before/after reference screenshots: runs list scrolled sideways with two frozen metric columns, and the items table with its sticky header. */
import path from 'node:path';
import { BASE, seed, launch, newPage, shotsDir } from './lib.mts';

const tag = process.env.TAG ?? 'before';
const pins = `localStorage.setItem('qym:data-table:v2:runs.v2', JSON.stringify({widths:{},hidden:null,pins:{'metric-${seed.metrics[0]}':'start','metric-${seed.metrics[1]}':'start'},order:null,density:null,collapsed:[]}));localStorage.setItem('qym:runs:page-size','50');localStorage.setItem('qym:run-page-size','500');`;
const browser = await launch();
const { page } = await newPage(browser, { width: 1440, height: 800, init: [pins] });
await page.goto(`${BASE}/projects/${seed.slug}`);
await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
await page.evaluate(() => ((document.querySelector('[data-testid="runs-table"] [data-dt-scroller]') as HTMLElement).scrollLeft = 1400));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shotsDir, `${tag}-A-runs-frozen-scrolled.jpg`), type: 'jpeg', quality: 70 });
await page.goto(`${BASE}/projects/${seed.slug}/runs/${seed.big}`);
await page.getByTestId('items-count').waitFor();
await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
await page.getByRole('button', { name: /^Open item #\d+$/ }).first().waitFor();
await page.getByRole('button', { name: 'Open item #2', exact: true }).click();
await page.waitForTimeout(500);
await page.evaluate(() => { const sc = document.getElementById('shell-content')!; sc.scrollTop += 700; });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(shotsDir, `${tag}-A-items-sticky-expanded.jpg`), type: 'jpeg', quality: 70 });
await browser.close();
