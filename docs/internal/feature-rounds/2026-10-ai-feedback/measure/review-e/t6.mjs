import { open, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback'); await page.waitForTimeout(1500);
await page.locator('[data-nav=docs]').click(); await page.waitForTimeout(800);
await page.route(/\/v1\/feedback\?/, r => r.abort());
await page.locator('[data-nav=feedback]').click(); await page.waitForTimeout(12000);
console.log((await page.locator('[data-testid=feedback-list-page]').innerText()).replace(/\n+/g, ' | ').slice(0, 300), '| rows', await page.locator('[aria-label="Feedback requests"] [role=row]').count());
console.log(await page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert]')].map(e => e.innerText.replace(/\n/g, ' '))));
await browser.close();
