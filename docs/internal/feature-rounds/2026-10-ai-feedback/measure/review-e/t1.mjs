import { open, ready, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback/' + ids.corrected); await page.waitForSelector('[data-testid=proposal]'); await page.waitForTimeout(800);
console.log(await page.evaluate(() => document.querySelector('[data-testid=chat-log]').innerText));
console.log(await page.evaluate(() => [...document.querySelectorAll('[data-testid=chat-log] *')].filter(e => /does not exist/.test(e.textContent) && e.children.length === 0).map(e => e.tagName + ' ' + e.className + ' ' + e.getAttribute('role'))));
await browser.close();
