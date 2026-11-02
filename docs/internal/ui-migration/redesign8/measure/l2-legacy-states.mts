/** Legacy interaction states: expanded item (+metric details), Filters builder, Display popover, count-button filter, category chip, hover. */
import { launch, newPage, legacyUrl, sleep, shots } from './lib8.mts';
import path from 'node:path';
const b = await launch();
const p = await newPage(b, 1440);
await p.goto(legacyUrl(['base', 'a', 'b', 'c'])); await sleep(4000);
const rect = async (sel: string) => p.evaluate((s: string) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }, sel);
const shot = async (sel: string, name: string) => { const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: path.join(shots, name) }); };
// Filters builder
await p.locator('#btn-item-filters').click(); await sleep(500);
console.log('builder', await rect('#item-filter-builder'));
await shot('.qym-item-control-center', 'legacy-items-filters-open.png');
console.log(await p.evaluate(() => (document.querySelector('#item-filter-builder') as HTMLElement).innerText.slice(0, 400)));
await p.locator('#btn-item-filters').click();
// Display popover
await p.locator('#btn-item-display').click(); await sleep(400);
console.log('display pop', await rect('#item-display-pop'));
await shot('.qym-item-control-center', 'legacy-items-display-open.png');
const pop = p.locator('#item-display-pop'); await pop.screenshot({ path: path.join(shots, 'legacy-items-display-popover.png') });
await p.locator('#btn-item-display').click();
// count button filter: first down count
const down = p.locator('.metric-delta-count--regressed').first();
await down.scrollIntoViewIfNeeded(); await down.click(); await sleep(800);
console.log('after down click count:', await p.locator('#filter-count').innerText(), 'items rows', await p.locator('.item-comparison-row').count(), 'url', p.url().slice(-120));
await shot('.items-comparison', 'legacy-after-down-click.png');
await p.evaluate(() => document.getElementById('clear-all-btn')?.click()); await sleep(500);
// expand item 1 and open metric details on every run (click correct on run 1)
await p.locator('.item-comparison-row').first().locator('.item-header').click(); await sleep(600);
await p.locator('.item-run-output').first().locator('.det-toggle').first().click(); await sleep(600);
console.log('rows open det', await p.locator('.metric-det-open, .det-toggle[aria-expanded="true"]').count());
await shot('.item-comparison-row >> nth=0', 'legacy-item-expanded-details.png');
await p.locator('.qym-output-toggle').first().click(); await sleep(400);
await shot('.item-comparison-row >> nth=0', 'legacy-item-run-toggled-off.png');
await b.close();
