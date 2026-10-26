/** React: expanded item (output grid), Filters builder, Display popover, count-button filter, 8-run page. */
import { launch, newPage, reactUrl, sleep, shots, reactFull } from './lib8.mts';
import path from 'node:path';
const b = await launch();
let p = await newPage(b, 1440);
await p.goto(reactUrl(['base', 'a', 'b', 'c'])); await sleep(5000);
for (let i = 0; i < 6; i++) { await p.evaluate(() => { const m = document.getElementById('shell-content')!; m.scrollTop = m.scrollHeight; }); await sleep(700); }
const rect = async (sel: string) => p.evaluate((s: string) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }, sel);
await p.locator('[data-testid="item-row"]').first().click(); await sleep(1200);
const d = p.locator('[data-testid="item-detail"]').first();
await d.scrollIntoViewIfNeeded(); await d.screenshot({ path: path.join(shots, 'current-item-expanded.png') });
console.log('detail', await rect('[data-testid="item-detail"]'), 'grid', await rect('[data-testid="output-grid"]'), 'cards', await p.locator('[data-testid="output-card"]').count(), await rect('[data-testid="output-card"]'));
console.log(await p.evaluate(() => [...document.querySelectorAll('[data-testid="output-card"]')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); })));
// open a metric chip
const chip = p.locator('[data-testid="output-card"]').first().getByRole('button').filter({ hasText: /correct|quality/ }).first();
if (await chip.count()) { await chip.click(); await sleep(600); await d.screenshot({ path: path.join(shots, 'current-item-expanded-details.png') }); }
// toolbar
const tb = p.locator('[data-compare-toolbar]'); await tb.scrollIntoViewIfNeeded(); await tb.screenshot({ path: path.join(shots, 'current-items-toolbar.png') });
await p.getByRole('button', { name: /^Filters/ }).first().click(); await sleep(600);
await p.locator('#compare-items').screenshot({ path: path.join(shots, 'current-items-filters-open.png') });
console.log('builder', await rect('[data-testid="filter-builder"]'));
await p.keyboard.press('Escape');
// 8 runs
p = await newPage(b, 1440);
await p.goto(reactUrl(['base', 'a', 'b', 'c', 'e1', 'e2', 'e3', 'e4'])); await sleep(5000);
console.log('8 runs h', await reactFull(p, 'current-page-8runs-1440.png'));
console.log('sticky 8', await rect('[data-compare-sticky]'), 'cards', await rect('[data-testid="run-card"]'), 'avg', await rect('[data-testid="average-row"]'), 'item-row', await rect('[data-testid="item-row"]'));
await b.close();
