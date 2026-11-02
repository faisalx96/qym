import { open, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
let { browser, page } = await open(1440);
await page.goto(BASE + '/feedback/' + ids.ui2); await page.waitForSelector('[data-testid=proposal]'); await page.waitForTimeout(700);
// no proposal case: asking draft -> send via Enter, check focus after answer
await page.goto(BASE + '/feedback/' + ids.fresh); await page.waitForSelector('[data-testid=chat]'); await page.waitForTimeout(700);
const ta = page.getByLabel('Your reply'); await ta.click(); await ta.type('A short answer, nothing special'); await page.keyboard.press('Enter');
await page.waitForTimeout(300); const during = await page.evaluate(() => document.activeElement?.tagName);
await page.waitForFunction(() => !document.querySelector('[data-testid=chat] textarea')?.disabled, null, { timeout: 20000 }); await page.waitForTimeout(400);
console.log('QE-140 focus during:', during, '| after turn:', await page.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.getAttribute('aria-label')), '| proposal?', await page.locator('[data-testid=proposal]').count());
// proposal case: focus must go to heading, not composer
await page.goto(BASE + '/feedback/' + ids.fresh); await page.waitForTimeout(700);
const ta2 = page.getByLabel('Your reply'); await ta2.click(); await ta2.type('Five analysts weekly'); await page.keyboard.press('Enter');
await page.waitForSelector('[data-testid=proposal]', { timeout: 20000 }); await page.waitForFunction(() => !document.querySelector('[data-testid=chat] textarea')?.disabled, null, { timeout: 20000 }); await page.waitForTimeout(600);
console.log('proposal case focus after turn:', await page.evaluate(() => document.activeElement?.id + ' ' + document.activeElement?.textContent?.slice(0, 20)));
await browser.close();
