import { open, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback/' + ids.long); await page.waitForSelector('[data-testid=chat-log]'); await page.waitForTimeout(900);
console.log('callouts:', await page.evaluate(() => [...document.querySelectorAll('[class*=callout]')].map(e => e.innerText.replace(/\n+/g, ' / ').slice(0, 90))), 'user items in log:', await page.evaluate(() => [...document.querySelectorAll('[data-testid=chat-log] ol > li')].filter(l => /Dev User/.test(l.innerText)).length));
await browser.close();
