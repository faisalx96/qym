import { open, ready, rect, BASE } from './lib.mjs';
import fs from 'node:fs'; import path from 'node:path';
const dl = process.cwd() + '/dl'; 
const { browser, page, ctx } = await open(1440);
await page.goto(BASE + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(900);
// drafts strip labels + discard rules
console.log('draft buttons:', await page.evaluate(() => [...document.querySelectorAll('[data-testid=drafts-strip] button, [data-testid=drafts-strip] a')].map(b => b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 8)));
console.log('strip title:', (await page.locator('[data-testid=drafts-strip]').innerText()).split('\n')[0]);
// '/' focuses search
await page.locator('body').click({ position: { x: 700, y: 20 } }); await page.keyboard.press('/'); console.log('"/" focuses:', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.placeholder));
await page.keyboard.press('Escape');
// grid keyboard
await page.locator('[aria-label="Feedback requests"] [role=row] [role=gridcell] a').first().focus(); await page.keyboard.press('ArrowDown'); console.log('ArrowDown focus ->', await page.evaluate(() => document.activeElement?.textContent.slice(0, 30) + ' | ' + document.activeElement?.tagName));
// filters in url
await page.getByRole('button', { name: /^Status/ }).first().click(); await page.getByRole('option', { name: /^New/ }).first().click().catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(500); console.log('url after status filter:', page.url().replace(BASE, ''));
await page.goto(BASE + '/feedback?status=accepted&priority=high&q=pdf'); await page.waitForTimeout(900); console.log('filtered counts text:', (await page.locator('[data-testid=feedback-list-page]').innerText()).match(/\d+ requests?/g));
console.log('rows:', await page.locator('[aria-label="Feedback requests"] [role=row]').count());
// export menu keyboard
const m = page.locator('[data-testid=export-menu]'); await m.focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); const items = await page.getByRole('menuitem').allInnerTexts(); console.log('menu via ArrowDown:', items); await page.keyboard.press('Escape');
await m.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300); console.log('menu via Enter:', (await page.getByRole('menuitem').count())); await page.keyboard.press('Escape');
await m.focus(); await page.keyboard.press('Space'); await page.waitForTimeout(300); console.log('menu via Space:', (await page.getByRole('menuitem').count())); await page.keyboard.press('Escape');
for (const [label, ext] of [['CSV', 'csv'], ['Excel', 'xlsx'], ['JSON', 'json'], ['JSON Lines', 'jsonl']]) {
  await m.click(); const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: new RegExp('^' + label) }).first().click()]);
  const f = `${dl}/ui-export-filtered.${ext}`; await d.saveAs(f); console.log('download', label, d.suggestedFilename(), fs.statSync(f).size);
}
// zero rows -> disabled
await page.goto(BASE + '/feedback?q=zzzznothing'); await page.waitForTimeout(900); console.log('zero rows export disabled:', await page.locator('[data-testid=export-menu], [data-testid=export-disabled]').evaluateAll(es => es.map(e => [e.tagName, e.disabled ?? e.getAttribute('aria-disabled'), e.title || e.getAttribute('aria-label')])), 'text:', (await page.locator('[data-testid=feedback-list-page]').innerText()).match(/No requests match[^\n]*/)?.[0]);
// discard rules
await page.goto(BASE + '/feedback'); await page.waitForTimeout(900);
const strip = page.locator('[data-testid=drafts-strip]'); const lines = await strip.locator('li').allInnerTexts(); console.log('strip lines', lines.length);
await browser.close();
