import { open, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback?q=zzzzz'); await page.waitForTimeout(1200);
console.log(await page.evaluate(() => { const t = document.querySelector('[aria-label="Feedback requests"]'); return [t?.innerText.replace(/\n+/g, ' | '), [...document.querySelectorAll('[data-testid=feedback-list-page] button, [data-testid=feedback-list-page] a')].map(b => b.textContent.trim()).filter(x => /clear|reset/i.test(x))]; }));
await browser.close();
