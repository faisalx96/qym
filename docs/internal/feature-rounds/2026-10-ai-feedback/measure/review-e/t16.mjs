import { open, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback/' + ids.live); await page.waitForSelector('[data-testid=proposal]', { timeout: 20000 }); await page.waitForTimeout(1500);
console.log((await page.locator('[data-testid=chat-log]').innerText()).replace(/\n+/g, ' | '));
console.log('event line role/class:', await page.evaluate(() => [...document.querySelectorAll('[data-testid=chat-log] ol > li')].filter(l => /does not exist/.test(l.innerText)).map(l => [l.className.toString().slice(0, 30), +l.getBoundingClientRect().height.toFixed(1), getComputedStyle(l).color])));
await browser.close();
